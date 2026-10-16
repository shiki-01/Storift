<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data, selected }: NodeProps & { data: { name: string; role: string; imageUrl?: string } } =
		$props();

	let initial = $derived((data.name || '?').charAt(0));
	const sides = [Position.Top, Position.Right, Position.Bottom, Position.Left];
</script>

<div class="node" class:selected>
	<div class="avatar">
		{#if data.imageUrl}
			<img src={data.imageUrl} alt="" draggable="false" />
		{:else}
			<span>{initial}</span>
		{/if}
	</div>
	<div class="name">{data.name}</div>
	{#if data.role}<div class="role">{data.role}</div>{/if}
	{#each sides as side (side)}
		<Handle type="source" position={side} id={side} class="handle" />
	{/each}
</div>

<style>
	.node {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		width: 96px;
		position: relative;
		color: var(--color-text);
	}

	.avatar {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border: 2px solid var(--color-border);
		background: color-mix(in srgb, var(--color-primary) 16%, var(--color-background));
		color: var(--color-primary);
		font-size: 22px;
		font-weight: 600;
		transition: border-color 0.15s;
	}

	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.node.selected .avatar {
		border-color: var(--color-primary);
	}

	.name {
		max-width: 100%;
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.role {
		max-width: 100%;
		font-size: 11px;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 接続用ハンドル: タッチでも掴みやすい大きさにする */
	.node :global(.handle) {
		width: 14px;
		height: 14px;
		background: var(--color-primary);
		border: 2px solid var(--color-background);
		opacity: 0;
		transition: opacity 0.15s;
	}

	.node:hover :global(.handle),
	.node.selected :global(.handle) {
		opacity: 1;
	}

	@media (hover: none) {
		.node :global(.handle) {
			opacity: 0.55;
		}
	}
</style>
