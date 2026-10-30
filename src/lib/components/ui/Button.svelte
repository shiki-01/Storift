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
</script>

<button class="btn btn--{variant} btn--{size} {className}" {type} {disabled} {onclick}>
	{#if children}
		{@render children()}
	{/if}
</button>

<style>
	/* :where で詳細度を 0 にし、呼び出し側のユーティリティクラスで上書きできるようにする */
	:where(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 36px;
		padding: 0 14px;
		border: 1px solid transparent;
		border-radius: 8px;
		font: inherit;
		font-size: 14px;
		line-height: 1;
		letter-spacing: 0.02em;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	:where(.btn--sm) {
		height: 30px;
		padding: 0 10px;
		font-size: 13px;
	}

	:where(.btn--lg) {
		height: 44px;
		padding: 0 20px;
		font-size: 15px;
	}

	:where(.btn--primary) {
		background: var(--color-primary);
		color: var(--color-background);
	}

	:where(.btn--primary:hover:not(:disabled)) {
		background: color-mix(in srgb, var(--color-primary) 88%, var(--color-text));
	}

	:where(.btn--secondary) {
		background: var(--color-background);
		border-color: var(--color-border);
		color: var(--color-text);
	}

	:where(.btn--secondary:hover:not(:disabled)) {
		background: var(--hover);
	}

	:where(.btn--danger) {
		background: var(--color-error);
		color: var(--color-background);
	}

	:where(.btn--danger:hover:not(:disabled)) {
		background: color-mix(in srgb, var(--color-error) 88%, var(--color-text));
	}

	:where(.btn--ghost) {
		background: transparent;
		color: var(--color-text-secondary);
	}

	:where(.btn--ghost:hover:not(:disabled)) {
		background: var(--hover);
		color: var(--color-text);
	}

	:where(.btn:disabled) {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
