<script lang="ts">
	interface ButtonProps {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		class?: string;
		onclick?: () => void;
		children?: import('svelte').Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		disabled = false,
		type = 'button',
		class: className = '',
		onclick,
		children
	}: ButtonProps = $props();

	const variantClasses = {
		primary: 'fg:theme-text',
		secondary: 'bg:theme-text fg:theme-background',
		danger: 'bg:theme-error fg:theme-background',
		ghost: 'bg:transparent fg:theme-text-secondary'
	};

	const sizeClasses = {
		sm: 'font:14',
		md: 'font:16',
		lg: 'font:18'
	};
</script>

<button
	class="r:6 cursor:pointer transition:all|.2s|ease {variantClasses[variant]} {sizeClasses[
		size
	]} opacity:.5:disabled cursor:not-allowed:disabled {className}"
	{type}
	{disabled}
	{onclick}
>
	{#if children}
		{@render children()}
	{/if}
</button>
