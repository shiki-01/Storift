<script lang="ts">
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';

	let {
		data,
		selected,
		onResizeEnd
	}: NodeProps & {
		data: { label: string; color: string; onResizeEnd?: () => void };
		onResizeEnd?: () => void;
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
	<span class="label">{data.label || 'グループ'}</span>
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

	.group.selected {
		border-style: solid;
	}

	.label {
		position: absolute;
		top: 8px;
		left: 14px;
		max-width: calc(100% - 28px);
		font-size: 13px;
		font-weight: 600;
		color: var(--group-color);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
