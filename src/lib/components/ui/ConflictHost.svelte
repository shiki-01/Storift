<script lang="ts">
	import ConflictResolver from './ConflictResolver.svelte';
	import { conflictStore } from '$lib/stores/conflicts.svelte';
	import { resolveManualConflict } from '$lib/services/sync.service';
	import { toast } from '$lib/stores/toast.svelte';
	import type { EntityType } from '$lib/firebase/sync';

	const typeLabels: Record<string, string> = {
		projects: 'プロジェクト',
		chapters: '章',
		scenes: 'シーン',
		characters: 'キャラクター',
		plots: 'プロット',
		worldbuilding: '設定資料'
	};

	const current = $derived(conflictStore.items[0]);

	async function handleResolve(resolution: 'local' | 'remote') {
		if (!current) return;
		try {
			await resolveManualConflict(current.id, resolution, current.type as EntityType);
			toast.success(
				resolution === 'local' ? 'この端末の変更を採用しました' : '他の端末の変更を採用しました'
			);
		} catch (error) {
			console.error('Failed to resolve conflict:', error);
			toast.error('競合の解決に失敗しました');
		}
	}
</script>

{#if current}
	<ConflictResolver
		bind:isOpen={conflictStore.isOpen}
		conflictData={current.conflictData}
		label={current.label}
		typeLabel={typeLabels[current.type] ?? ''}
		position={conflictStore.count > 1 ? `残り ${conflictStore.count} 件` : ''}
		closeOnResolve={false}
		onResolve={handleResolve}
	/>
{/if}
