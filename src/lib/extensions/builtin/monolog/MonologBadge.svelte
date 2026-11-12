<script lang="ts">
	// エディタのステータス領域に出す、Monolog. 計測中の小さな表示。計測中でなければ何も描画しない
	import { monologState } from './service.svelte';
</script>

{#if monologState.sessionActive}
	<span class="monolog-badge" role="status" title="Monolog. に執筆時間を記録しています">
		<span class="dot" aria-hidden="true"></span>Monolog. 計測中
	</span>
{/if}

<style>
	.monolog-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		white-space: nowrap;
		color: var(--color-text-secondary);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-primary);
	}
</style>
