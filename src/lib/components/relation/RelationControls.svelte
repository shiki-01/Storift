<script lang="ts">
	/**
	 * 相関図のズーム操作(拡大・縮小・全体表示)。@xyflow/svelte 既定の Controls の代わり。
	 * SvelteFlow の子として置く(useSvelteFlow を使うため)。
	 */
	import { useSvelteFlow } from '@xyflow/svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		zoom: number;
		minZoom: number;
		maxZoom: number;
	}

	let { zoom, minZoom, maxZoom }: Props = $props();

	const { zoomIn, zoomOut, fitView } = useSvelteFlow();
	const EPS = 0.001;
</script>

<div class="controls" role="group" aria-label="表示の操作">
	<button
		type="button"
		aria-label="拡大"
		title="拡大"
		disabled={zoom >= maxZoom - EPS}
		onclick={() => void zoomIn({ duration: 150 })}
	>
		<Icon name="plus" class="ico" />
	</button>
	<button
		type="button"
		aria-label="縮小"
		title="縮小"
		disabled={zoom <= minZoom + EPS}
		onclick={() => void zoomOut({ duration: 150 })}
	>
		<Icon name="minus" class="ico" />
	</button>
	<button
		type="button"
		aria-label="全体を表示"
		title="全体を表示"
		onclick={() => void fitView({ padding: 0.25, duration: 200 })}
	>
		<Icon name="focus-centered" class="ico" />
	</button>
</div>

<style>
	.controls {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
		transition: background-color 0.15s;
	}

	button + button {
		border-top: 1px solid var(--color-border);
	}

	button:hover:not(:disabled) {
		background: var(--hover);
	}

	button:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary) 55%, transparent);
	}

	button:disabled {
		opacity: 0.35;
		cursor: default;
	}

	button :global(.ico) {
		display: inline-flex;
		width: 18px;
		height: 18px;
	}

	button :global(.ico svg) {
		width: 100%;
		height: 100%;
	}
</style>
