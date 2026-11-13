<script lang="ts">
	// オン/オフのスイッチ(有効/無効の切り替え用)。チェックボックスと同じく、押すたびに onchange を呼ぶ
	interface SwitchProps {
		checked: boolean;
		disabled?: boolean;
		id?: string;
		/** 見えるラベルがないときのアクセシブルな名前 */
		'aria-label'?: string;
		'aria-labelledby'?: string;
		'aria-describedby'?: string;
		onchange?: (checked: boolean) => void;
		[key: `data-${string}`]: string | undefined;
	}

	let {
		checked,
		disabled = false,
		id,
		onchange,
		'aria-label': ariaLabel,
		'aria-labelledby': labelledBy,
		'aria-describedby': describedBy,
		...rest
	}: SwitchProps = $props();
</script>

<button
	{id}
	type="button"
	role="switch"
	class="switch"
	aria-checked={checked}
	aria-label={ariaLabel}
	aria-labelledby={labelledBy}
	aria-describedby={describedBy}
	{disabled}
	onclick={() => onchange?.(!checked)}
	{...rest}
>
	<span class="thumb" aria-hidden="true"></span>
</button>

<style>
	.switch {
		position: relative;
		flex: none;
		width: 44px;
		height: 26px;
		padding: 0;
		border: 1px solid color-mix(in srgb, var(--color-text) 28%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text) 12%, var(--color-background));
		cursor: pointer;
		transition:
			background-color 0.15s,
			border-color 0.15s;
	}

	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--color-background);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text) 30%, transparent);
		transition: transform 0.15s;
	}

	.switch[aria-checked='true'] {
		border-color: var(--color-primary);
		background: var(--color-primary);
	}

	.switch[aria-checked='true'] .thumb {
		transform: translateX(18px);
	}

	.switch:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	@media (prefers-reduced-motion: reduce) {
		.switch,
		.thumb {
			transition: none;
		}
	}
</style>
