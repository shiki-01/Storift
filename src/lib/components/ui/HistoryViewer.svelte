<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import { historyDB } from '$lib/db';
	import { formatDate } from '$lib/utils/dateUtils';
	import type { History } from '$lib/types';

	interface HistoryViewerProps {
		isOpen?: boolean;
		entityId: string;
		onRestore?: (snapshot: any) => void;
		onClose?: () => void;
	}

	let {
		isOpen = $bindable(false),
		entityId,
		onRestore,
		onClose
	}: HistoryViewerProps = $props();

	let histories = $state<History[]>([]);
	let isLoading = $state(false);
	let selectedHistory = $state<History | null>(null);

	$effect(() => {
		if (isOpen && entityId) {
			loadHistory();
		}
	});

	async function loadHistory() {
		isLoading = true;
		try {
			histories = await historyDB.getByEntity(entityId);
		} catch (error) {
			console.error('Failed to load history:', error);
		} finally {
			isLoading = false;
		}
	}

	async function handleRestore(history: History) {
		if (confirm('このバージョンに復元しますか?')) {
			const snapshot = await historyDB.restore(history.id);
			onRestore?.(snapshot);
			isOpen = false;
		}
	}

	const changeTypeLabels = {
		create: '作成',
		update: '更新',
		delete: '削除'
	};
</script>

<Modal bind:isOpen title="変更履歴" onClose={onClose}>
	{#if isLoading}
		<div class="text-align:center p:32">
			<p class="fg:gray-600">読み込み中...</p>
		</div>
	{:else if histories.length === 0}
		<div class="text-align:center p:32">
			<p class="fg:gray-600">変更履歴がありません</p>
		</div>
	{:else}
		<div class="max-h:500 overflow-y:auto">
			{#each histories as history (history.id)}
				<div class="border:1|solid|gray-200 r:8 p:16 mb:12 bg:white">
					<div class="flex justify-content:space-between align-items:start mb:12">
						<div>
							<div class="font:14 font-weight:600 mb:4">
								{changeTypeLabels[history.changeType]}
							</div>
							<div class="font:12 fg:gray-600">
								{formatDate(history.createdAt)}
							</div>
						</div>
						<Button size="sm" variant="secondary" onclick={() => handleRestore(history)}>
							復元
						</Button>
					</div>
					
					{#if selectedHistory?.id === history.id}
						<div class="bg:gray-50 p:12 r:6 font:12 white-space:pre-wrap overflow-x:auto">
							{JSON.stringify(history.snapshot, null, 2)}
						</div>
					{:else}
						<button
							class="bg:transparent border:none cursor:pointer fg:blue-600 font:12 p:0"
							onclick={() => (selectedHistory = history)}
						>
							詳細を表示
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</Modal>
