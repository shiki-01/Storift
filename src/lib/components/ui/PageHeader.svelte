<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		actions?: Snippet;
	}

	let { title, description, actions }: Props = $props();
</script>

<header class="bg:theme-background border-bottom:1|solid|theme-border">
	<div
		class="max-w:1280 mx:auto w:100% px:24 py:20 flex flex-wrap:wrap justify-content:space-between align-items:center gap:16"
	>
		<div>
			<h1 class="font:24 font-weight:600 m:0 fg:theme-text">{title}</h1>
			{#if description}
				<p class="font:14 fg:theme-text-secondary mt:4 mb:0">{description}</p>
			{/if}
		</div>
		{#if actions}
			<div class="flex flex-wrap:wrap align-items:center gap:12">
				{@render actions()}
			</div>
		{/if}
	</div>
</header>
