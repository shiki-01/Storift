<script lang="ts">
	interface CardProps {
		padding?: 'none' | 'sm' | 'md' | 'lg';
		hoverable?: boolean;
		onclick?: () => void;
		class?: string;
		children?: import('svelte').Snippet;
	}

	let {
		padding = 'md',
		hoverable = false,
		onclick,
		class: className = '',
		children
	}: CardProps = $props();

	const paddingClasses = {
		none: '',
		sm: 'p:16',
		md: 'p:24',
		lg: 'p:32'
	};
</script>

{#if onclick}
	<button
		class="bg:white r:8 border:1|solid|gray-200 {paddingClasses[
			padding
		]} {hoverable
			? 'cursor:pointer'
			: ''} {className}"
		type="button"
		{onclick}
	>
		{#if children}
			{@render children()}
		{/if}
	</button>
{:else}
	<div class="bg:white r:8 border:1|solid|gray-200 {paddingClasses[padding]} {className}">
		{#if children}
			{@render children()}
		{/if}
	</div>
{/if}
