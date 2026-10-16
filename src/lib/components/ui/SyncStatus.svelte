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
			color: 'fg:blue-600'
		},
		offline: {
			icon: '⚠',
			text: 'オフライン',
			color: 'fg:orange-600'
		},
		conflict: {
			icon: '⚠',
			text: '競合発生',
			color: 'fg:red-600'
		},
		error: {
			icon: '✕',
			text: 'エラー',
			color: 'fg:red-600'
		}
	};

	const config = $derived(statusConfig[syncStore.status]);
</script>

<div class="flex align-items:center gap:8 font:13">
	<span class="{config.color} {syncStore.status === 'syncing' ? 'spinning' : ''}">
		{config.icon}
	</span>
	<span class={config.color + ' white-space:nowrap'}>
		{config.text}
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
</div>

<style>
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
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
