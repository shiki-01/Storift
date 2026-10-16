<script lang="ts">
	import { untrack } from 'svelte';
	import ConflictResolver from './ConflictResolver.svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { getPendingConflicts, resolveManualConflict } from '$lib/services/sync.service';

	// conflictCount を読むことで、保留中の競合が増減したら再計算される
	let current = $derived.by(() => {
		void syncStore.conflictCount;
		return getPendingConflicts()[0] ?? null;
	});

	let lastCount = 0;

	// 競合が新しく見つかったときに知らせる(自動で開いて編集を妨げない)
	$effect(() => {
		const count = syncStore.conflictCount;
		if (count > untrack(() => lastCount)) {
			toast.info(`他の端末との競合が${count}件あります`, {
				duration: 10000,
				action: { label: '確認', onClick: () => (syncStore.conflictDialogOpen = true) }
			});
		}
		lastCount = count;
		if (count === 0) syncStore.conflictDialogOpen = false;
	});

	async function onResolve(resolution: 'local' | 'remote') {
		if (!current) return;
		try {
			await resolveManualConflict(current.id, resolution);
			toast.success(
				resolution === 'remote' ? '他の端末の変更を採用しました' : 'この端末の変更を残しました'
			);
		} catch (error) {
			console.error('Failed to resolve conflict:', error);
			toast.error('競合の解決に失敗しました');
		}
	}
</script>

{#if current}
	<ConflictResolver
		isOpen={syncStore.conflictDialogOpen}
		conflictData={current.conflictData}
		{onResolve}
		onClose={() => (syncStore.conflictDialogOpen = false)}
	/>
{/if}
