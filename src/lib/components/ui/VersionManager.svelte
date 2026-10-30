<script lang="ts">
	import { toast, confirmDialog } from '$lib/stores/toast.svelte';
	import { onMount } from 'svelte';
	import { versionService, type TextDiff, type RestorePoint } from '$lib/services/version.service';
	import type { History } from '$lib/types';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';

	interface Props {
		entityType: 'scene' | 'chapter' | 'character' | 'plot' | 'worldbuilding';
		entityId: string;
		projectId: string;
	}

	let { entityType, entityId, projectId }: Props = $props();

	let history = $state<History[]>([]);
	let restorePoints = $state<RestorePoint[]>([]);
	let selectedOldVersion = $state<string | null>(null);
	let selectedNewVersion = $state<string | null>(null);
	let showDiffModal = $state(false);
	let diffs = $state<TextDiff[]>([]);
	let diffStats = $state({ additions: 0, deletions: 0, unchanged: 0, totalChanges: 0 });
	let showCreateRestorePoint = $state(false);
	let restorePointName = $state('');
	let restorePointDescription = $state('');
	let selectedHistory = $state<string | null>(null);

	onMount(async () => {
		await loadHistory();
		loadRestorePoints();
	});

	const loadHistory = async () => {
		history = await versionService.getEntityHistory(entityType, entityId);
	};

	const loadRestorePoints = () => {
		restorePoints = versionService.getEntityRestorePoints(entityType, entityId);
	};

	const handleCompareVersions = async () => {
		if (!selectedOldVersion || !selectedNewVersion) {
			return;
		}

		const comparison = await versionService.compareVersions(selectedOldVersion, selectedNewVersion);

		if (comparison) {
			diffs = comparison.diffs;
			diffStats = {
				...comparison.stats,
				totalChanges: comparison.stats.additions + comparison.stats.deletions
			};
			showDiffModal = true;
		}
	};

	const handleCreateRestorePoint = () => {
		if (!selectedHistory) {
			return;
		}

		const historyEntry = history.find((h) => h.id === selectedHistory);
		if (!historyEntry) {
			return;
		}

		versionService.createRestorePoint(historyEntry, restorePointName, restorePointDescription);

		restorePointName = '';
		restorePointDescription = '';
		showCreateRestorePoint = false;
		loadRestorePoints();
	};

	async function handleRestore(restorePointId: string) {
		if (await confirmDialog('この復元ポイントに戻しますか?')) {
			const success = await versionService.restoreFromPoint(restorePointId);
			if (success) {
				toast.success('復元しました');
				await loadHistory();
			} else {
				toast.error('復元に失敗しました');
			}
		}
	}

	async function handleDeleteRestorePoint(restorePointId: string) {
		if (await confirmDialog({ message: 'この復元ポイントを削除しますか?', danger: true })) {
			versionService.deleteRestorePoint(restorePointId);
			loadRestorePoints();
		}
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleString('ja-JP', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getChangeTypeLabel(changeType: string): string {
		const labels: Record<string, string> = {
			create: '作成',
			update: '更新',
			delete: '削除'
		};
		return labels[changeType] || changeType;
	}

	function getDiffHtml(): string {
		return versionService.renderDiffAsHtml(diffs);
	}
</script>

<div class="version-manager space-y:20">
	<!-- 履歴リスト -->
	<div class="bg:theme-background r:12 p:20">
		<h3 class="font:18 font:semibold fg:theme-text mb:16">変更履歴</h3>

		{#if history.length === 0}
			<p class="font:14 fg:theme-text-secondary text-align:center py:20">履歴はありません</p>
		{:else}
			<div class="space-y:8">
				{#each history as entry}
					<div
						class="p:12 border:1|solid|theme-border r:8 hover:bg:theme-surface transition:all|0.2s"
					>
						<div class="flex justify-content:space-between align-items:start">
							<div class="flex-grow">
								<div class="flex align-items:center gap:8 mb:4">
									<span class="px:8 py:2 bg:theme-surface fg:theme-primary font:12 r:4">
										{getChangeTypeLabel(entry.changeType)}
									</span>
									<span class="font:14 fg:theme-text-secondary">
										{formatDate(entry.createdAt)}
									</span>
								</div>
							</div>

							<div class="flex gap:8">
								<label class="font:12 fg:theme-text-secondary cursor:pointer">
									<input
										type="radio"
										name="oldVersion"
										value={entry.id}
										bind:group={selectedOldVersion}
										class="mr:4"
									/>
									旧
								</label>
								<label class="font:12 fg:theme-text-secondary cursor:pointer">
									<input
										type="radio"
										name="newVersion"
										value={entry.id}
										bind:group={selectedNewVersion}
										class="mr:4"
									/>
									新
								</label>
								<button
									class="px:8 py:2 bg:theme-surface fg:theme-text-secondary font:12 r:4 hover:bg:var(--hover) cursor:pointer"
									onclick={() => {
										selectedHistory = entry.id;
										showCreateRestorePoint = true;
									}}
								>
									復元ポイント作成
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>

			<div class="flex justify-content:flex-end mt:16">
				<Button
					variant="primary"
					onclick={handleCompareVersions}
					disabled={!selectedOldVersion || !selectedNewVersion}
				>
					バージョンを比較
				</Button>
			</div>
		{/if}
	</div>

	<!-- 復元ポイント -->
	<div class="bg:theme-background r:12 p:20">
		<h3 class="font:18 font:semibold fg:theme-text mb:16">復元ポイント</h3>

		{#if restorePoints.length === 0}
			<p class="font:14 fg:theme-text-secondary text-align:center py:20">
				復元ポイントはありません
			</p>
		{:else}
			<div class="space-y:8">
				{#each restorePoints as point}
					<div class="p:12 border:1|solid|theme-border r:8">
						<div class="flex justify-content:space-between align-items:start mb:8">
							<div class="flex-grow">
								<h4 class="font:15 font:semibold fg:theme-text mb:4">
									{point.name}
								</h4>
								{#if point.description}
									<p class="font:13 fg:theme-text-secondary mb:4">{point.description}</p>
								{/if}
								<p class="font:12 fg:theme-text-secondary">
									{formatDate(point.createdAt)}
								</p>
							</div>

							<div class="flex gap:8">
								<Button variant="primary" onclick={() => handleRestore(point.id)}>復元</Button>
								<Button variant="danger" onclick={() => handleDeleteRestorePoint(point.id)}>
									削除
								</Button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- 差分表示モーダル -->
{#if showDiffModal}
	<Modal title="バージョン比較" onClose={() => (showDiffModal = false)} size="large">
		<div class="diff-viewer">
			<!-- 統計情報 -->
			<div class="flex gap:16 mb:20 p:16 bg:theme-surface r:8">
				<div class="text-align:center">
					<div class="font:24 font:bold fg:theme-success">{diffStats.additions}</div>
					<div class="font:12 fg:theme-text-secondary">追加</div>
				</div>
				<div class="text-align:center">
					<div class="font:24 font:bold fg:theme-error">{diffStats.deletions}</div>
					<div class="font:12 fg:theme-text-secondary">削除</div>
				</div>
				<div class="text-align:center">
					<div class="font:24 font:bold fg:theme-primary">{diffStats.totalChanges}</div>
					<div class="font:12 fg:theme-text-secondary">変更</div>
				</div>
			</div>

			<!-- 差分表示 -->
			<div class="diff-content p:16 bg:theme-surface r:8 overflow:auto max-h:500">
				{@html getDiffHtml()}
			</div>
		</div>
	</Modal>
{/if}

<!-- 復元ポイント作成モーダル -->
{#if showCreateRestorePoint}
	<Modal title="復元ポイントを作成" onClose={() => (showCreateRestorePoint = false)} size="medium">
		<div class="space-y:16">
			<div>
				<label for="restorePointName" class="font:14 fg:theme-text-secondary mb:6 block">
					名前
				</label>
				<input
					id="restorePointName"
					type="text"
					bind:value={restorePointName}
					placeholder="復元ポイントの名前"
					class="w:full py:8 px:12 r:8 border:1|solid|theme-border font:14"
				/>
			</div>

			<div>
				<label for="restorePointDescription" class="font:14 fg:theme-text-secondary mb:6 block">
					説明(任意)
				</label>
				<textarea
					id="restorePointDescription"
					bind:value={restorePointDescription}
					placeholder="復元ポイントの説明"
					rows="3"
					class="w:full py:8 px:12 r:8 border:1|solid|theme-border font:14 resize:vertical"
				></textarea>
			</div>

			<div class="flex gap:12 justify-content:flex-end">
				<Button variant="secondary" onclick={() => (showCreateRestorePoint = false)}>
					キャンセル
				</Button>
				<Button
					variant="primary"
					onclick={handleCreateRestorePoint}
					disabled={!restorePointName.trim()}
				>
					作成
				</Button>
			</div>
		</div>
	</Modal>
{/if}

<style>
	:global(.diff-line) {
		font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
		font-size: 13px;
		line-height: 1.6;
		padding: 2px 8px;
		white-space: pre-wrap;
		word-break: break-all;
	}

	:global(.diff-add) {
		background-color: color-mix(in srgb, var(--color-success) 20%, transparent);
		color: var(--color-success);
	}

	:global(.diff-remove) {
		background-color: color-mix(in srgb, var(--color-error) 20%, transparent);
		color: var(--color-error);
	}

	:global(.diff-unchanged) {
		color: var(--color-text-secondary);
	}
</style>
