<script lang="ts">
	import { tick } from 'svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		title?: string;
		/** half: 画面の約55% / full: ほぼ全画面 / auto: 内容に合わせる */
		size?: 'half' | 'full' | 'auto';
		onClose?: () => void;
		headerRight?: Snippet;
		children?: Snippet;
	}

	let {
		open = $bindable(false),
		title = '',
		size = 'half',
		onClose,
		headerRight,
		children
	}: Props = $props();

	let sheetEl = $state<HTMLDivElement | null>(null);
	let expanded = $state(false);
	let dragOffset = $state(0);
	let dragging = $state(false);
	let startY = 0;
	let startViewportH = 0;
	let returnFocusTo: HTMLElement | null = null;

	const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;

	function close() {
		open = false;
		dragOffset = 0;
		expanded = false;
		onClose?.();
	}

	$effect(() => {
		if (open) {
			returnFocusTo = document.activeElement as HTMLElement | null;
			void tick().then(() => sheetEl?.focus({ preventScroll: true }));
		} else if (returnFocusTo) {
			// エディタのキーボードを不用意に再表示しないよう、input/textarea/contenteditable以外のみ復帰
			if (!returnFocusTo.isContentEditable) returnFocusTo.focus?.({ preventScroll: true });
			returnFocusTo = null;
		}
	});

	// フォーカスがシート外に出ても(ボタンが無効化された直後など) Esc で閉じられるようにする
	$effect(() => {
		if (!open) return;
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	// 上へ引いて全画面にする判定(half のときだけ)。EXPAND_AT を超えて離すと全画面になる
	const EXPAND_AT = 50;
	const canExpand = $derived(size === 'half' && !expanded);
	/** 上へ引いた量(px, 0 以上) */
	const pullUp = $derived(canExpand && dragOffset < 0 ? -dragOffset : 0);
	/** 全画面への判定の進み具合 0〜1 */
	const progress = $derived(Math.min(1, pullUp / EXPAND_AT));
	/** しきい値に届いている(離すと全画面になる) */
	const armed = $derived(pullUp >= EXPAND_AT);

	/** 背景の影が画面上端(ステータスバー部分)まで届くよう、body の直下へ移す */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		startY = e.clientY;
		startViewportH = window.innerHeight;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const dy = e.clientY - startY;
		// 半分 → 全画面の高さの差まで、指に追従して伸びる。それ以外の上向きは動かさない
		const maxUp = canExpand ? startViewportH * (0.92 - 0.55) : 0;
		dragOffset = Math.max(-maxUp, dy);
	}

	function onPointerUp() {
		if (!dragging) return;
		dragging = false;
		if (dragOffset > 90) {
			close();
			return;
		}
		if (armed) expanded = true;
		else if (dragOffset > 40 && expanded) expanded = false;
		dragOffset = 0;
	}

	let heightStyle = $derived.by(() => {
		if (size === 'auto') return 'auto';
		const base = size === 'full' || expanded ? '92dvh' : '55dvh';
		// 引いている間は、指の動きの分だけ高さを足す(全画面の高さを超えない)
		return pullUp > 0 ? `min(92dvh, calc(${base} + ${pullUp}px))` : base;
	});
</script>

{#if open}
	<div class="sheet-root" role="presentation" use:portal>
		<button
			class="sheet-backdrop"
			class:dragging
			aria-label="閉じる"
			tabindex="-1"
			style:--dim={0.4 + 0.2 * progress}
			onclick={close}
		></button>
		<div
			bind:this={sheetEl}
			class="sheet"
			class:dragging
			class:armed
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			tabindex="-1"
			style:height={heightStyle}
			style:max-height="92dvh"
			style:--pull={progress}
			style:transform={dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined}
		>
			<div
				class="sheet-grabber"
				class:armed
				role="presentation"
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
			>
				<span class="sheet-handle"></span>
			</div>
			{#if title || headerRight}
				<div class="sheet-header">
					<h2 id={titleId} class="sheet-title">{title}</h2>
					<div class="sheet-header-right">
						{#if headerRight}{@render headerRight()}{/if}
						<button class="sheet-close" onclick={close} aria-label="閉じる">
							<svg
								viewBox="0 0 24 24"
								width="20"
								height="20"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg
							>
						</button>
					</div>
				</div>
			{/if}
			<div class="sheet-body">
				{#if children}{@render children()}{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.sheet-root {
		position: fixed;
		inset: 0;
		z-index: 900;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}

	.sheet-backdrop {
		position: absolute;
		inset: 0;
		border: none;
		background: rgba(0, 0, 0, var(--dim, 0.4));
		animation: sheet-fade 0.18s ease-out;
		transition: background-color 0.2s ease;
	}

	.sheet-backdrop.dragging {
		transition: none;
	}

	.sheet {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--color-background);
		color: var(--color-text);
		/* 引き上げるほど角丸が大きくなり、全画面に近づく感じを出す */
		border-radius: calc(16px + 12px * var(--pull, 0)) calc(16px + 12px * var(--pull, 0)) 0 0;
		border-top: 1px solid var(--color-border);
		box-shadow: var(--shadow-float);
		padding-bottom: var(--safe-bottom);
		animation: sheet-up 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
		transition:
			height 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
			transform 0.2s ease,
			border-radius 0.2s ease;
		outline: none;
	}

	.sheet.dragging {
		transition: none;
	}

	.sheet.armed {
		border-top-color: var(--color-primary);
	}

	.sheet-grabber {
		flex: none;
		display: flex;
		justify-content: center;
		padding: 10px 0 6px;
		touch-action: none;
		cursor: grab;
	}

	.sheet-handle {
		width: calc(36px + 20px * var(--pull, 0));
		height: 4px;
		border-radius: 2px;
		background: color-mix(
			in srgb,
			var(--color-primary) calc(var(--pull, 0) * 60%),
			var(--color-border)
		);
		transition:
			width 0.15s ease,
			background-color 0.15s ease,
			transform 0.15s ease;
	}

	/* しきい値に届いた: 離すと全画面になることが分かるよう、ハンドルをはっきり変える */
	.sheet-grabber.armed .sheet-handle {
		width: 64px;
		height: 5px;
		background: var(--color-primary);
		transform: scaleY(1.2);
	}

	.sheet-header {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 8px 8px 16px;
	}

	.sheet-title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.sheet-header-right {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.sheet-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 8px;
		cursor: pointer;
	}

	.sheet-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
	}

	@keyframes sheet-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes sheet-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet,
		.sheet-backdrop,
		.sheet-handle {
			animation: none;
			transition: none;
		}
	}

	/* 広い画面ではシートを中央に寄せたカードとして表示 */
	@media (min-width: 769px) {
		.sheet-root {
			align-items: center;
			justify-content: center;
		}

		.sheet {
			width: min(560px, 92vw);
			border-radius: 16px;
			border: 1px solid var(--color-border);
		}
	}
</style>
