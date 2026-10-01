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
			color: 'fg:theme-info'
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

	const config = $derived(statusConfig[syncStore.status]);
</script>

<div class="flex align-items:center gap:8 font:13">
	<span
		class="{config.color} {syncStore.status === 'syncing' ? 'sync-spin' : ''}"
	>
		{config.icon}
	</span>
	<span class="{config.color} white-space:nowrap">
		{config.text}
	</span>
	{#if syncStore.lastSyncTime}
		<span class="fg:theme-text-secondary white-space:nowrap">
			• {formatRelativeTime(syncStore.lastSyncTime)}
		</span>
	{/if}
	{#if syncStore.error}
		<span class="fg:theme-error font:12 white-space:nowrap" title={syncStore.error}>
			({syncStore.error})
		</span>
	{/if}
</div>

<style>
	.sync-spin {
		display: inline-block;
		animation: spin 2s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
