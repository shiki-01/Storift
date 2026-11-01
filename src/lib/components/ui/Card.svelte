<script lang="ts">
	interface CardProps {
		padding?: 'none' | 'sm' | 'md' | 'lg';
		hoverable?: boolean;
		onclick?: () => void;
		oncontextmenu?: (e: MouseEvent) => void;
		class?: string;
		children?: import('svelte').Snippet;
		/** data-tour などの data-* 属性は、そのまま外側の要素に渡す */
		[key: `data-${string}`]: string | undefined;
	}

	let {
		padding = 'md',
		hoverable = false,
		onclick,
		oncontextmenu,
		class: className = '',
		children,
		...rest
	}: CardProps = $props();

	const paddingClasses = {
		none: '',
		sm: 'p:16',
		md: 'p:24',
		lg: 'p:32'
	};

	const baseClass =
		'bg:theme-background b:1px|solid|theme-border fg:theme-text transition:border-color|.15s';
</script>

{#if onclick}
	<button
		class="r:10 {paddingClasses[padding]} {hoverable
			? 'cursor:pointer'
			: ''} {baseClass} {className}"
		type="button"
		{onclick}
		{oncontextmenu}
		{...rest}
	>
		{#if children}
			{@render children()}
		{/if}
	</button>
{:else}
	<div class="r:10 {paddingClasses[padding]} {baseClass} {className}" {oncontextmenu} {...rest}>
		{#if children}
			{@render children()}
		{/if}
	</div>
{/if}
