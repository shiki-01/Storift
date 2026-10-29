<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import { historyDB } from '$lib/db';
	import { restoreBackup } from '$lib/services/sync.service';
	import { confirmDialog, toast } from '$lib/stores/toast.svelte';
	import { formatDate } from '$lib/utils/dateUtils';
	import type { History } from '$lib/types';

	interface Props {
		isOpen?: boolean;
	}

	let { isOpen = $bindable(false) }: Props = $props();

	let backups = $state<History[]>([]);
	let isLoading = $state(false);

	const entityLabels: Record<History['entityType'], string> = {
		chapter: '章',
		scene: 'シーン',
		character: 'キャラクター',
		plot: 'プロット',
		worldbuilding: '世界観'
	};

	const reasonLabels: Partial<Record<History['changeType'], string>> = {
		conflict: '同期の競合で上書き',
		'remote-delete': '他端末の削除で消去'
	};

	$effect(() => {
		if (isOpen) load();
	});

	async function load() {
		isLoading = true;
		try {
			backups = await historyDB.getBackups();
		} catch (error) {
			console.error('Failed to load backups:', error);
			toast.error('バックアップの読み込みに失敗しました');
		} finally {
			isLoading = false;
		}
	}

	function nameOf(history: History): string {
		const s = history.snapshot ?? {};
		return s.title || s.name || history.entityId;
	}

	function preview(history: History): string {
		const s = history.snapshot ?? {};
		const text = typeof s.content === 'string' ? s.content : '';
		return text.slice(0, 80);
	}

	async function handleRestore(history: History) {
		const ok = await confirmDialog(
			`「${nameOf(history)}」をこの版に復元しますか?現在の内容もバックアップに残ります。`
		);
		if (!ok) return;
		try {
			await restoreBackup(history.id);
			toast.success('復元しました');
			await load();
		} catch (error) {
			console.error('Failed to restore backup:', error);
			toast.error(error instanceof Error ? error.message : '復元に失敗しました');
		}
	}
</script>

<Modal bind:isOpen title="同期バックアップ">
	{#if isLoading}
		<p class="text-align:center p:32 fg:theme-text-secondary">読み込み中...</p>
	{:else if backups.length === 0}
		<p class="text-align:center p:32 fg:theme-text-secondary">バックアップはありません</p>
	{:else}
		<p class="font:12 fg:theme-text-secondary mb:12">
			競合や他端末の削除で失われた版を90日間保存しています。
		</p>
		<div class="max-h:500 overflow-y:auto">
			{#each backups as history (history.id)}
				<div class="border:1|solid|theme-border r:8 p:16 mb:12 bg:theme-background">
					<div class="flex justify-content:space-between align-items:start gap:12">
						<div class="min-w:0">
							<div class="font:14 font-weight:600 mb:4">
								{entityLabels[history.entityType]}: {nameOf(history)}
							</div>
							<div class="font:12 fg:theme-text-secondary">
								{reasonLabels[history.changeType]} ・ {formatDate(history.createdAt)}
							</div>
							{#if preview(history)}
								<div class="font:12 fg:theme-text-secondary mt:8 white-space:pre-wrap">
									{preview(history)}
								</div>
							{/if}
						</div>
						<Button size="sm" variant="secondary" onclick={() => handleRestore(history)}>
							復元
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</Modal>
