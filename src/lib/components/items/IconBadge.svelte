<script lang="ts">
	/**
	 * 丸い / 角丸の四角のアバター・アイコン枠。人物(円形のイニシャル)と設定資料(角丸の四角のアイコン)で使う。
	 * 幅と高さを同じ値で固定し、aspect-ratio: 1 と flex-shrink: 0 で、並びが窮屈でも楕円にならない。
	 * 角丸は shape で決める(円は 50%、四角は大きさに比例した 8〜12px)。border-radius: 100% を直接指定しないこと。
	 */
	import Icon from '$lib/components/ui/Icon.svelte';

	type Tone = 'primary' | 'accent' | 'secondary' | 'success' | 'warning' | 'info' | 'neutral';

	interface Props {
		/** 一辺の長さ(px) */
		size?: number;
		shape?: 'circle' | 'square';
		tone?: Tone;
		/** アイコン名(editor/icons の SVG) */
		icon?: string;
		/** イニシャルなどの文字(icon が無いとき。先頭の 1〜2 文字を使う) */
		text?: string;
		/** 意味を持つときの名前。装飾なら省略(aria-hidden) */
		label?: string;
		class?: string;
	}

	let {
		size = 40,
		shape = 'circle',
		tone = 'primary',
		icon,
		text,
		label,
		class: className = ''
	}: Props = $props();

	const initial = $derived([...(text ?? '').trim()].slice(0, 2).join(''));
</script>

<span
	class="badge {className}"
	data-shape={shape}
	data-tone={tone}
	style:--size="{size}px"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	{#if icon}
		<Icon name={icon} class="glyph" />
	{:else}
		<span class="text">{initial}</span>
	{/if}
</span>

<style>
	.badge {
		--tone: var(--color-primary);
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: var(--size);
		height: var(--size);
		min-width: var(--size);
		min-height: var(--size);
		aspect-ratio: 1;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--tone) 28%, var(--color-border));
		background: color-mix(in srgb, var(--tone) 12%, var(--color-background));
		color: var(--tone);
		font-weight: 600;
		line-height: 1;
		-webkit-user-select: none;
		user-select: none;
	}

	.badge[data-shape='circle'] {
		border-radius: 50%;
	}

	.badge[data-shape='square'] {
		border-radius: clamp(8px, calc(var(--size) * 0.25), 12px);
	}

	.badge[data-tone='accent'] {
		--tone: var(--color-accent);
	}
	.badge[data-tone='secondary'] {
		--tone: var(--color-secondary);
	}
	.badge[data-tone='success'] {
		--tone: var(--color-success);
	}
	.badge[data-tone='warning'] {
		--tone: var(--color-warning);
	}
	.badge[data-tone='info'] {
		--tone: var(--color-info);
	}
	.badge[data-tone='neutral'] {
		--tone: var(--color-text-secondary);
	}

	.text {
		font-size: calc(var(--size) * 0.4);
		letter-spacing: 0;
	}

	.badge :global(.glyph) {
		display: flex;
		width: calc(var(--size) * 0.52);
		height: calc(var(--size) * 0.52);
	}

	.badge :global(.glyph svg) {
		width: 100%;
		height: 100%;
	}
</style>
