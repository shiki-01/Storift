<script lang="ts">
	import { syncStore } from '$lib/stores/sync.svelte';
	import { formatRelativeTime } from '$lib/utils/dateUtils';

	const statusConfig = {
		synced: {
			icon: '✓',
			text: '同期済み',
			color: 'fg:theme-text'
		},
		syncing: {
			icon: '⟳',
			text: '同期中...',
			color: 'fg:theme-primary'
		},
		offline: {
			icon: '⚠',
			text: 'オフライン',
			color: 'fg:theme-warning'
		},
		conflict: {
			icon: '⚠',
			text: '競合発生',
			color: 'fg:theme-error'
		},
		error: {
			icon: '✕',
			text: 'エラー',
			color: 'fg:theme-error'
		}
	};

	// Firebase 未設定(同期なし)のときは「オフライン」ではなく、この端末に保存していることを示す
	const localConfig = {
		icon: '○',
		text: '同期なし',
		color: 'fg:theme-text-secondary'
	};

	const config = $derived(syncStore.isConfigured ? statusConfig[syncStore.status] : localConfig);

	// 同期中は進捗(件数が分かっているとき)を表示する
	const progress = $derived(syncStore.progress);
	const statusText = $derived(
		syncStore.isConfigured && syncStore.status === 'syncing' && progress.phase && progress.total > 0
			? `同期中 ${progress.done}/${progress.total}`
			: config.text
	);
	const progressTitle = $derived(
		syncStore.status === 'syncing' && progress.phase
			? progress.phase === 'upload'
				? '変更をクラウドへ送信中'
				: 'クラウドから取得中'
			: undefined
	);
</script>

<svelte:element
	this={syncStore.status === 'conflict' ? 'button' : 'div'}
	class="sync-root flex ai:center gap:8 font:13"
	role={syncStore.status === 'conflict' ? 'button' : undefined}
	title={!syncStore.isConfigured
		? '同期は行わず、作品はこの端末に保存されます'
		: syncStore.status === 'conflict'
			? 'クリックして競合を解決'
			: progressTitle}
	onclick={syncStore.status === 'conflict'
		? () => (syncStore.conflictDialogOpen = true)
		: undefined}
>
	<span class="{config.color} {syncStore.status === 'syncing' ? 'spinning' : ''}">
		{config.icon}
	</span>
	<span class={config.color + ' white-space:nowrap'}>
		{statusText}
	</span>
	{#if syncStore.lastSyncTime}
		<span class="sync-time fg:theme-text-secondary white-space:nowrap">
			• {formatRelativeTime(syncStore.lastSyncTime)}
		</span>
	{/if}
	{#if syncStore.error}
		<span class="sync-error fg:theme-error font:12 white-space:nowrap" title={syncStore.error}>
			({syncStore.error})
		</span>
	{/if}
</svelte:element>

<style>
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	button.sync-root {
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.spinning {
		display: inline-block;
		animation: spin 2s linear infinite;
	}

	/* スマホでは幅を節約するため、最終同期時刻とエラー詳細は隠す(詳細は title で確認) */
	@media (max-width: 768px) {
		.sync-time,
		.sync-error {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinning {
			animation: none;
		}
	}
</style>
