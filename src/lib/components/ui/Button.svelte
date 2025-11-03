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
		primary: 'fg:black',
		secondary: 'bg:gray-200 bg:gray-300:hover fg:gray-900',
		danger: 'bg:red-600 bg:red-700:hover fg:white',
		ghost: 'bg:transparent bg:gray-100:hover fg:gray-900'
	};

	const sizeClasses = {
		sm: 'font:14',
		md: 'font:16',
		lg: 'font:18'
	};
</script>

<button
	class="r:6 border:none cursor:pointer transition:all|.2s|ease {variantClasses[variant]} {sizeClasses[
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
