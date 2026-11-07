<script lang="ts" generics="T">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import type { ConflictData } from '$lib/firebase/conflict';
	import { describeConflict } from '$lib/firebase/conflictView';
	import { formatDate } from '$lib/utils/dateUtils';

	interface ConflictResolverProps<T> {
		isOpen?: boolean;
		/** 競合したデータの種類(projects / chapters / scenes / characters / plots / worldbuilding) */
		entityType?: string;
		conflictData?: ConflictData<T>;
		onResolve?: (resolution: 'local' | 'remote') => void;
		onClose?: () => void;
	}

	let {
		isOpen = $bindable(false),
		entityType = '',
		conflictData,
		onResolve,
		onClose
	}: ConflictResolverProps<T> = $props();

	function handleResolve(resolution: 'local' | 'remote') {
		onResolve?.(resolution);
		isOpen = false;
	}

	// 競合の対象は呼び出し側のエンティティ型のため、表示に使うキーだけをここで読む
	function updatedAtOf(entity: T): number | undefined {
		return (entity as { updatedAt?: number }).updatedAt;
	}

	function syncedAtOf(entity: T): number | undefined {
		return (entity as { syncedAt?: number }).syncedAt;
	}

	const dateTime = (timestamp: number | undefined) =>
		timestamp ? formatDate(timestamp, 'yyyy/MM/dd HH:mm:ss') : '不明';
</script>

{#if conflictData}
	{@const localUpdatedAt = updatedAtOf(conflictData.local)}
	{@const remoteUpdatedAt = updatedAtOf(conflictData.remote)}
	{@const summary = describeConflict(
		entityType,
		conflictData.local as object,
		conflictData.remote as object
	)}
	<Modal bind:isOpen title="変更の競合" {onClose}>
		<div class="mb:24">
			<p class="fg:theme-text mb:4 font-weight:600">
				{summary.kindLabel}{summary.title ? `「${summary.title}」` : ''}
			</p>
			<p class="fg:theme-text-secondary mb:16">
				このデータが複数の端末で変更されています。どちらの内容を残しますか?
			</p>

			{#if summary.diffs.length === 0}
				<p class="font:13 fg:theme-text-secondary mb:16">
					内容に違いはありません(更新日時だけが異なります)。どちらを選んでも内容は変わりません。
				</p>
			{/if}

			<div class="display:grid grid-template-columns:1fr|1fr gap:16">
				<!-- ローカル版 -->
				<div class="border:1|solid|theme-border r:8 p:16">
					<h3 class="font:16 font-weight:600 mb:4 fg:theme-primary">この端末の変更</h3>
					<p class="font:12 fg:theme-text-secondary mb:12">
						更新日時: {dateTime(localUpdatedAt)}
					</p>
					{#if summary.diffs.length > 0}
						<div class="bg:theme-surface p:12 r:6 max-h:300 overflow-y:auto selectable">
							{#each summary.diffs as diff (diff.key)}
								<div class="mb:12">
									<div class="font:12 font-weight:600 fg:theme-text-secondary mb:4">
										{diff.label}
									</div>
									<div class="font:13 fg:theme-text white-space:pre-wrap word-break:break-all">
										{diff.local}
									</div>
								</div>
							{/each}
						</div>
					{/if}
					<Button onclick={() => handleResolve('local')} variant="primary" class="w:full mt:12">
						この端末の内容を残す
					</Button>
					<p class="font:11 fg:theme-text-secondary mt:4">他の端末の変更は上書きされます</p>
				</div>

				<!-- リモート版 -->
				<div class="border:1|solid|theme-border r:8 p:16">
					<h3 class="font:16 font-weight:600 mb:4 fg:theme-success">他の端末の変更</h3>
					<p class="font:12 fg:theme-text-secondary mb:12">
						更新日時: {dateTime(remoteUpdatedAt)}
					</p>
					{#if summary.diffs.length > 0}
						<div class="bg:theme-surface p:12 r:6 max-h:300 overflow-y:auto selectable">
							{#each summary.diffs as diff (diff.key)}
								<div class="mb:12">
									<div class="font:12 font-weight:600 fg:theme-text-secondary mb:4">
										{diff.label}
									</div>
									<div class="font:13 fg:theme-text white-space:pre-wrap word-break:break-all">
										{diff.remote}
									</div>
									{#if diff.note}
										<div class="font:11 fg:theme-text-secondary mt:2">{diff.note}</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					<Button onclick={() => handleResolve('remote')} variant="secondary" class="w:full mt:12">
						他の端末の内容に置き換える
					</Button>
					<p class="font:11 fg:theme-text-secondary mt:4">この端末の変更は置き換えられます</p>
				</div>
			</div>

			<div class="mt:16 p:12 bg:theme-surface border:1|solid|theme-warning r:6">
				<p class="font:12 fg:theme-warning">
					採用しなかった側の内容は、設定の「同期バックアップ」に自動で保存されます(90日間)。
				</p>
			</div>

			<details class="mt:12 font:11 fg:theme-text-secondary">
				<summary class="cursor:pointer">詳細(開発者向け)</summary>
				<p class="mt:4 selectable">
					ID: {(conflictData.local as { id?: string }).id ?? ''} / この端末 syncedAt: {syncedAtOf(
						conflictData.local
					) ?? '-'} updatedAt: {localUpdatedAt ?? '-'}
				</p>
				<p class="selectable">
					他の端末 syncedAt: {syncedAtOf(conflictData.remote) ?? '-'} updatedAt: {remoteUpdatedAt ??
						'-'}
				</p>
			</details>
		</div>
	</Modal>
{/if}
