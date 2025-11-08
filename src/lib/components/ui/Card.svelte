<script lang="ts">
	interface CardProps {
		padding?: 'none' | 'sm' | 'md' | 'lg';
		hoverable?: boolean;
		onclick?: () => void;
		oncontextmenu?: (e: MouseEvent) => void;
		class?: string;
		children?: import('svelte').Snippet;
	}

	let {
		padding = 'md',
		hoverable = false,
		onclick,
		oncontextmenu,
		class: className = '',
		children
	}: CardProps = $props();

	const paddingClasses = {
		none: '',
		sm: 'p:16',
		md: 'p:24',
		lg: 'p:32'
	};

	const baseClass =
		'bg:theme-surface b:2px|solid|theme-border fg:theme-text shadow:sm transition:all|.2s';
</script>

{#if onclick}
	<button
		class="r:8 {paddingClasses[padding]} {hoverable
			? 'cursor:pointer'
			: ''} {baseClass} {className}"
		type="button"
		{onclick}
		{oncontextmenu}
	>
		{#if children}
			{@render children()}
		{/if}
	</button>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="r:8 {paddingClasses[padding]} {baseClass} {className}" {oncontextmenu}>
		{#if children}
			{@render children()}
		{/if}
	</div>
{/if}
