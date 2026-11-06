<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Button from './Button.svelte';
	import Input from './Input.svelte';
	import { executeJoin, prepareJoin, type PreparedJoin } from '$lib/services/join.service';

	interface Props {
		/** 開いた時点で読み取り済みの招待(/join のフラグメント)。あれば自動で確認を始める */
		initialText?: string;
		/** 参加が完了したとき */
		onJoined?: (projectId: string) => void;
		/** ホームへ戻る/閉じるボタンの動作(省略時はホームへ移動) */
		onClose?: () => void;
	}

	let { initialText = '', onJoined, onClose }: Props = $props();

	type Phase = 'input' | 'checking' | 'password' | 'joining' | 'done' | 'blocked';
	let phase = $state<Phase>('input');
	let text = $state('');
	let password = $state('');
	let message = $state('');
	let prepared = $state<Extract<PreparedJoin, { ok: true }> | null>(null);
	let joinedProjectId = $state('');
	let joinedTitle = $state('');
	let joinedRole = $state<'viewer' | 'editor'>('viewer');
	let rejoined = $state(false);
	let note = $state('');

	const roleLabel = (role: 'viewer' | 'editor') => (role === 'editor' ? '編集' : '閲覧');

	onMount(() => {
		if (initialText) {
			text = initialText;
			void check();
		}
	});

	async function check() {
		message = '';
		phase = 'checking';
		const result = await prepareJoin(text);
		if (!result.ok) {
			message = result.message;
			// 貼り付け直せる失敗(リンクの不備)は入力に戻す。それ以外は案内して止める
			phase = result.kind === 'invalid' ? 'input' : 'blocked';
			return;
		}
		prepared = result;
		// トークン方式は入力不要で、そのまま参加する
		if (result.needsPassword) phase = 'password';
		else await join();
	}

	async function join() {
		if (!prepared) return;
		message = '';
		phase = 'joining';
		const outcome = await executeJoin(prepared, { password });
		if (!outcome.ok) {
			message = outcome.message;
			// パスワード方式は入力し直せる。トークン方式は再試行ボタンを出す
			phase = prepared.needsPassword ? 'password' : 'blocked';
			return;
		}
		joinedProjectId = outcome.projectId;
		joinedTitle = outcome.title;
		joinedRole = outcome.role;
		rejoined = outcome.rejoined;
		note = outcome.note ?? '';
		// 秘密をメモリに残さない
		password = '';
		text = '';
		prepared = null;
		phase = 'done';
		onJoined?.(outcome.projectId);
	}

	function restart() {
		prepared = null;
		password = '';
		message = '';
		phase = 'input';
	}

	const close = () => (onClose ? onClose() : goto(resolve('/home')));
	const openProject = () => goto(resolve('/project/[id]/editor', { id: joinedProjectId }));
</script>

<div class="flex flex:column gap:16">
	{#if message}
		<p class="fg:theme-error font:.875rem" role="alert">{message}</p>
	{/if}

	{#if phase === 'input'}
		<p class="font:.875rem">
			共有された招待リンクを貼り付けてください(リンクの「#」以降だけでも構いません)。
		</p>
		<textarea
			bind:value={text}
			rows="4"
			aria-label="招待リンク"
			placeholder="https://…/join#…"
			class="w:full p:12|16 border:1|solid|theme-border r:6 font:.875rem outline:none focus:border-color:theme-primary resize:vertical"
		></textarea>
		<div class="flex jc:flex-end gap:12">
			<Button variant="secondary" onclick={close}>キャンセル</Button>
			<Button disabled={!text.trim()} onclick={check}>次へ</Button>
		</div>
	{:else if phase === 'checking'}
		<p class="font:.875rem fg:theme-text-secondary">招待を確認しています...</p>
	{:else if phase === 'password' && prepared}
		<p class="font:.875rem">
			{prepared.invite.nameHint ? `「${prepared.invite.nameHint}」に` : 'プロジェクトに'}{roleLabel(
				prepared.invite.role
			)}として参加します。招待した人から伝えられたパスワードを入力してください。
		</p>
		<form
			class="flex flex:column gap:12"
			onsubmit={(e) => {
				e.preventDefault();
				void join();
			}}
		>
			<Input type="password" bind:value={password} ariaLabel="パスワード" />
			<div class="flex jc:flex-end gap:12">
				<Button type="button" variant="secondary" onclick={restart}>戻る</Button>
				<Button type="submit" disabled={!password.trim()}>参加</Button>
			</div>
		</form>
	{:else if phase === 'joining'}
		<p class="font:.875rem fg:theme-text-secondary">参加しています...</p>
	{:else if phase === 'done'}
		<p class="font:.875rem">
			「{joinedTitle}」に{roleLabel(joinedRole)}として{rejoined ? '再参加' : '参加'}しました。
		</p>
		{#if note}
			<p class="fg:theme-warning font:.875rem">{note}</p>
		{/if}
		{#if joinedRole === 'viewer'}
			<p class="fg:theme-text-secondary font:.875rem">閲覧専用です。編集はできません。</p>
		{/if}
		<div class="flex jc:flex-end gap:12">
			<Button variant="secondary" onclick={close}>ホームへ</Button>
			<Button onclick={openProject}>プロジェクトを開く</Button>
		</div>
	{:else}
		<!-- 案内して止める、または再試行 -->
		<div class="flex jc:flex-end gap:12">
			<Button variant="secondary" onclick={close}>ホームへ</Button>
			{#if prepared}
				<Button onclick={join}>もう一度試す</Button>
			{:else}
				<Button onclick={restart}>別のリンクを入力</Button>
			{/if}
		</div>
	{/if}
</div>
