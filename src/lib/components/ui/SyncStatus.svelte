<script lang="ts">
	import { syncStore } from '$lib/stores/sync.svelte';
	import { formatRelativeTime } from '$lib/utils/dateUtils';

	const statusConfig = {
		synced: {
			icon: '✓',
			text: '同期済み',
			color: 'fg:black'
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
	<span
		class={config.color + ' ' + syncStore.status === 'syncing'
			? 'animation:spin|2s|linear|infinite'
			: ''}
	>
		{config.icon}
	</span>
	<span class={config.color}>
		{config.text}
	</span>
	{#if syncStore.lastSyncTime}
		<span class="fg:gray-500">
			• {formatRelativeTime(syncStore.lastSyncTime)}
		</span>
	{/if}
	{#if syncStore.error}
		<span class="fg:red-600 font:12" title={syncStore.error}>
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
</style>
