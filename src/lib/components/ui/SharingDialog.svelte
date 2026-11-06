<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Input from './Input.svelte';
	import { toast, confirmDialog } from '$lib/stores/toast.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { projectsStore } from '$lib/stores/projects.svelte';
	import {
		SHARING_NEEDS_OWNER_MESSAGE,
		changeVisibility,
		getMembers,
		getShareAvailability,
		regenerateSecret,
		removeMember,
		startSharing,
		stopSharing
	} from '$lib/services/sharing.service';
	import { isUnguessableProjectId } from '$lib/firebase/syncTarget';
	import type { SecretSpec, SharedMember } from '$lib/firebase/sharing';

	interface Props {
		isOpen?: boolean;
		projectId: string;
	}

	let { isOpen = $bindable(false), projectId }: Props = $props();

	const project = $derived(projectsStore.projects.find((p) => p.id === projectId));
	const sharing = $derived(project?.sharing);
	// アクセスモードが変わったら判定し直す(owner 以外は開始できない)
	const availability = $derived.by(() => {
		void authStore.accessMode;
		return getShareAvailability();
	});
	const isOwnerSharing = $derived(!!sharing && sharing.role === 'owner' && !sharing.connectionId);

	// 開始フォーム
	let visibility = $state<'private' | 'link'>('private');
	let viewerUsePassword = $state(false);
	let viewerPassword = $state('');
	let editorUsePassword = $state(false);
	let editorPassword = $state('');

	// 秘密の再生成
	let regenRole = $state<'viewer' | 'editor'>('viewer');
	let regenUsePassword = $state(false);
	let regenPassword = $state('');

	let busy = $state(false);
	let error = $state('');
	let members = $state<SharedMember[]>([]);
	let membersLoading = $state(false);

	const specOf = (use: boolean, value: string): SecretSpec | undefined =>
		use ? { type: 'password', value } : undefined;

	const startDisabled = $derived(
		busy ||
			(viewerUsePassword && !viewerPassword.trim()) ||
			(editorUsePassword && !editorPassword.trim())
	);

	// 開いたとき・共有が有効になったときにメンバーを読み込む
	$effect(() => {
		if (!isOpen || sharing?.status !== 'active' || !isOwnerSharing) {
			members = [];
			return;
		}
		void loadMembers();
	});

	async function loadMembers() {
		membersLoading = true;
		try {
			members = await getMembers(projectId);
		} catch (e) {
			error = messageOf(e, 'メンバーの取得に失敗しました');
		} finally {
			membersLoading = false;
		}
	}

	function messageOf(e: unknown, fallback: string): string {
		return e instanceof Error && e.message ? e.message : fallback;
	}

	/** 操作を実行し、失敗はダイアログ内に表示する */
	async function run(task: () => Promise<void>, failure: string) {
		error = '';
		busy = true;
		try {
			await task();
		} catch (e) {
			console.error(failure, e);
			error = messageOf(e, failure);
		} finally {
			busy = false;
		}
	}

	const handleStart = () =>
		run(async () => {
			await startSharing(projectId, {
				visibility,
				viewerSecret: specOf(viewerUsePassword, viewerPassword),
				editorSecret: specOf(editorUsePassword, editorPassword)
			});
			viewerPassword = '';
			editorPassword = '';
			toast.success('共有を開始しました');
		}, '共有の開始に失敗しました');

	/** 途中で止まった移行を続きから実行する */
	const handleResume = () =>
		run(async () => {
			if (sharing?.migration === 'stop') await stopSharing(projectId);
			else await startSharing(projectId, { visibility: sharing?.visibility ?? 'private' });
			toast.success('共有の移行を完了しました');
		}, '共有の移行に失敗しました');

	const handleVisibility = (next: 'private' | 'link') =>
		run(async () => {
			await changeVisibility(projectId, next);
			toast.success('公開範囲を変更しました');
		}, '公開範囲の変更に失敗しました');

	const handleRegenerate = () =>
		run(async () => {
			if (
				!(await confirmDialog({
					message: `${regenRole === 'viewer' ? '閲覧用' : '編集用'}の秘密を再生成しますか?\n以前の秘密を使った招待は使えなくなります。参加済みのメンバーはそのまま残るので、必要なら下の一覧から削除してください。`,
					danger: true
				}))
			)
				return;
			await regenerateSecret(projectId, regenRole, specOf(regenUsePassword, regenPassword));
			regenPassword = '';
			toast.success('秘密を再生成しました');
		}, '秘密の再生成に失敗しました');

	const handleRemoveMember = (member: SharedMember) =>
		run(async () => {
			if (
				!(await confirmDialog({
					message: `${member.name ?? '参加者'}(${member.role === 'editor' ? '編集' : '閲覧'})を削除しますか?\n同じ秘密で再参加できるので、再参加させたくない場合は秘密も再生成してください。`,
					danger: true
				}))
			)
				return;
			await removeMember(projectId, member.uid);
			await loadMembers();
			toast.success('メンバーを削除しました');
		}, 'メンバーの削除に失敗しました');

	const handleStop = () =>
		run(async () => {
			if (
				!(await confirmDialog({
					message:
						'共有を停止しますか?\n共有側のデータをこの端末の通常の保存先に書き戻したあと、共有側のデータ・参加者・秘密をすべて削除します(コピーと削除を伴うため、時間がかかることがあります)。参加者はアクセスできなくなりますが、参加者の端末に保存済みのデータは残ります。',
					danger: true
				}))
			)
				return;
			await stopSharing(projectId);
			toast.success('共有を停止しました');
		}, '共有の停止に失敗しました');

	const formatDate = (ms?: number) => (ms ? new Date(ms).toLocaleString('ja-JP') : '-');
</script>

<Modal bind:isOpen title="共有" size="medium">
	{#if !project}
		<p class="fg:theme-text-secondary font:.875rem">プロジェクトが見つかりません。</p>
	{:else}
		<div class="flex flex:column gap:16">
			{#if error}
				<p class="fg:theme-error font:.875rem" role="alert">{error}</p>
			{/if}

			{#if !sharing}
				<!-- 共有していない -->
				{#if !availability.ok}
					<div class="px:1rem py:.75rem r:6px b:1px|solid|theme-warning">
						<p class="font:.875rem fg:theme-warning">
							{authStore.accessMode === 'owner'
								? availability.message
								: SHARING_NEEDS_OWNER_MESSAGE}
						</p>
						<p class="font:.875rem fg:theme-text-secondary mt:4">
							設定画面の「Firebase ルール」で新ルールの適用とオーナー登録を行ってください。
						</p>
					</div>
				{:else if !isUnguessableProjectId(projectId)}
					<p class="fg:theme-warning font:.875rem">
						このプロジェクトの ID は推測しやすいため、共有できません(複製した作品なら共有できます)。
					</p>
				{:else}
					<p class="font:.875rem">
						共有を開始すると、このプロジェクトのデータを共有用の保存先に移します(コピーしてから、元の場所のデータを削除します)。
					</p>

					<fieldset class="flex flex:column gap:8 b:0 p:0 m:0">
						<legend class="font-weight:500 m:0|0|8|0">公開範囲</legend>
						<label class="flex ai:center gap:8">
							<input type="radio" bind:group={visibility} value="private" />
							<span>非公開(招待された人だけ)</span>
						</label>
						<label class="flex ai:center gap:8">
							<input type="radio" bind:group={visibility} value="link" />
							<span>リンクを知っている人が閲覧可能</span>
						</label>
					</fieldset>

					<div class="flex flex:column gap:8">
						<span class="font-weight:500">閲覧用の秘密</span>
						<label class="flex ai:center gap:8">
							<input type="checkbox" bind:checked={viewerUsePassword} />
							<span>パスワードを設定する(未設定ならランダムなトークン)</span>
						</label>
						{#if viewerUsePassword}
							<Input type="password" bind:value={viewerPassword} ariaLabel="閲覧用パスワード" />
						{/if}
					</div>

					<div class="flex flex:column gap:8">
						<span class="font-weight:500">編集用の秘密</span>
						<label class="flex ai:center gap:8">
							<input type="checkbox" bind:checked={editorUsePassword} />
							<span>パスワードを設定する(未設定ならランダムなトークン)</span>
						</label>
						{#if editorUsePassword}
							<Input type="password" bind:value={editorPassword} ariaLabel="編集用パスワード" />
						{/if}
					</div>

					<div class="flex jc:flex-end">
						<Button onclick={handleStart} disabled={startDisabled}>
							{busy ? '共有を開始しています...' : '共有を開始'}
						</Button>
					</div>
				{/if}
			{:else if !isOwnerSharing}
				<p class="font:.875rem">
					このプロジェクトは他の人から共有されています(役割: {sharing.role === 'editor'
						? '編集'
						: '閲覧'})。
				</p>
			{:else if sharing.status === 'migrating'}
				<!-- 移行中 -->
				<p class="font:.875rem">
					状態: <strong>移行中</strong>({sharing.migration === 'stop'
						? '共有の停止'
						: '共有の開始'})
				</p>
				<p class="fg:theme-text-secondary font:.875rem">
					データを移しています。途中で止まった場合は、次回の起動時に自動で再開するほか、下のボタンからも続きを実行できます。
				</p>
				{#if availability.ok}
					<div class="flex jc:flex-end">
						<Button onclick={handleResume} disabled={busy}>
							{busy ? '実行中...' : '続きを実行'}
						</Button>
					</div>
				{:else}
					<p class="fg:theme-warning font:.875rem">{availability.message}</p>
				{/if}
			{:else if sharing.status === 'error'}
				<p class="fg:theme-error font:.875rem">共有の状態に問題があります。</p>
			{:else}
				<!-- 共有中 -->
				<p class="font:.875rem">
					状態: <strong>共有中</strong>(開始: {formatDate(sharing.startedAt)})
				</p>

				<div class="flex flex:column gap:8">
					<span class="font-weight:500">公開範囲</span>
					<div class="flex gap:8">
						<Button
							variant={sharing.visibility === 'private' ? 'primary' : 'secondary'}
							size="sm"
							disabled={busy || !availability.ok}
							onclick={() => handleVisibility('private')}>非公開</Button
						>
						<Button
							variant={sharing.visibility === 'link' ? 'primary' : 'secondary'}
							size="sm"
							disabled={busy || !availability.ok}
							onclick={() => handleVisibility('link')}>リンクで閲覧可能</Button
						>
					</div>
				</div>

				<div class="flex flex:column gap:8">
					<span class="font-weight:500">秘密の再生成</span>
					<div class="flex gap:8">
						<label class="flex ai:center gap:4">
							<input type="radio" bind:group={regenRole} value="viewer" />閲覧用
						</label>
						<label class="flex ai:center gap:4">
							<input type="radio" bind:group={regenRole} value="editor" />編集用
						</label>
					</div>
					<label class="flex ai:center gap:8">
						<input type="checkbox" bind:checked={regenUsePassword} />
						<span>パスワードを設定する(未設定ならランダムなトークン)</span>
					</label>
					{#if regenUsePassword}
						<Input type="password" bind:value={regenPassword} ariaLabel="新しいパスワード" />
					{/if}
					<div>
						<Button
							variant="secondary"
							size="sm"
							disabled={busy || !availability.ok || (regenUsePassword && !regenPassword.trim())}
							onclick={handleRegenerate}>再生成</Button
						>
					</div>
				</div>

				<div class="flex flex:column gap:8">
					<span class="font-weight:500">メンバー</span>
					{#if membersLoading}
						<p class="fg:theme-text-secondary font:.875rem">読み込み中...</p>
					{:else if members.length === 0}
						<p class="fg:theme-text-secondary font:.875rem">参加者はいません。</p>
					{:else}
						<ul class="flex flex:column gap:8 list-style:none p:0 m:0">
							{#each members as member (member.uid)}
								<li
									class="flex ai:center jc:space-between gap:8 b:1px|solid|theme-border r:6 p:8|12"
								>
									<span class="font:.875rem">
										{member.name ?? '名前なし'}
										<span class="fg:theme-text-secondary">
											({member.role === 'editor' ? '編集' : '閲覧'} / {formatDate(member.joinedAt)})
										</span>
									</span>
									<Button
										variant="danger"
										size="sm"
										disabled={busy}
										onclick={() => handleRemoveMember(member)}>削除</Button
									>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div class="flex flex:column gap:8 pt:8 bt:1px|solid|theme-border">
					<span class="font-weight:500">共有の停止</span>
					<p class="fg:theme-text-secondary font:.875rem">
						共有側のデータを元の保存先に書き戻し、共有側のデータ・参加者・秘密をすべて削除します。
					</p>
					<div>
						<Button
							variant="danger"
							size="sm"
							disabled={busy || !availability.ok}
							onclick={handleStop}>共有を停止</Button
						>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<div class="flex jc:flex-end">
			<Button variant="secondary" onclick={() => (isOpen = false)}>閉じる</Button>
		</div>
	{/snippet}
</Modal>
