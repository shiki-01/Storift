<script lang="ts">
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';

	let {
		data,
		selected
	}: NodeProps & {
		data: { label: string; color: string; onResizeEnd?: () => void };
	} = $props();
</script>

<NodeResizer
	isVisible={selected}
	minWidth={120}
	minHeight={90}
	color={data.color}
	onResizeEnd={() => data.onResizeEnd?.()}
/>
<div class="group" style:--group-color={data.color} class:selected>
	<span class="label"><i class="dot"></i>{data.label || 'グループ'}</span>
</div>

<style>
	.group {
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		border-radius: 18px;
		border: 2px dashed color-mix(in srgb, var(--group-color) 70%, transparent);
		background: color-mix(in srgb, var(--group-color) 10%, transparent);
	}

	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--group-color);
	}

	/* リサイズのつまみ: ライブラリ既定の小さな四角を、丸いつまみにする */
	:global(.svelte-flow__resize-control.handle) {
		width: 12px;
		height: 12px;
		border: 2px solid var(--color-background);
		border-radius: 50%;
		box-shadow: 0 0 0 1px var(--color-border);
	}

	:global(.svelte-flow__resize-control.line) {
		border-width: 1.5px;
	}

	.group.selected {
		border-style: solid;
	}

	.label {
		position: absolute;
		top: 8px;
		left: 14px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: calc(100% - 28px);
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
