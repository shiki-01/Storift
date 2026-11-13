<script lang="ts">
	// エディタのステータス領域(スマホの上部バーのシーン名の下)に出す、Monolog. 計測中の小さな表示。
	// 狭い画面でも右のボタンに重ならないよう、短く「計測中」だけを出す。計測中でなければ何も描画しない
	import { monologState } from './service.svelte';
</script>

{#if monologState.sessionActive}
	<span
		class="monolog-badge"
		role="status"
		aria-label="Monolog. に執筆時間を記録しています"
		title="Monolog. に執筆時間を記録しています"
	>
		<span class="dot" aria-hidden="true"></span>計測中
	</span>
{/if}

<style>
	.monolog-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 16px;
		padding: 0 6px;
		border-radius: 999px;
		font-size: 11px;
		line-height: 1;
		white-space: nowrap;
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 12%, var(--color-background));
	}

	:root[data-scheme='dark'] .monolog-badge {
		color: color-mix(in srgb, var(--color-primary) 60%, var(--color-text));
	}

	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
	}
</style>
