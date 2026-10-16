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

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		startY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		dragOffset = Math.max(-120, e.clientY - startY);
	}

	function onPointerUp() {
		if (!dragging) return;
		dragging = false;
		if (dragOffset > 90) {
			close();
			return;
		}
		if (dragOffset < -50 && size === 'half') expanded = true;
		else if (dragOffset > 40 && expanded) expanded = false;
		dragOffset = 0;
	}

	let heightStyle = $derived(
		size === 'auto' ? 'auto' : size === 'full' || expanded ? '92dvh' : '55dvh'
	);
</script>

{#if open}
	<div class="sheet-root" role="presentation">
		<button class="sheet-backdrop" aria-label="閉じる" tabindex="-1" onclick={close}></button>
		<div
			bind:this={sheetEl}
			class="sheet"
			class:dragging
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			tabindex="-1"
			style:height={heightStyle}
			style:max-height="92dvh"
			style:transform={dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined}
		>
			<div
				class="sheet-grabber"
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
		background: rgba(0, 0, 0, 0.4);
		animation: sheet-fade 0.18s ease-out;
	}

	.sheet {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--color-background);
		color: var(--color-text);
		border-radius: 16px 16px 0 0;
		border-top: 1px solid var(--color-border);
		box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.18);
		padding-bottom: var(--safe-bottom);
		animation: sheet-up 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
		transition:
			height 0.2s ease,
			transform 0.2s ease;
		outline: none;
	}

	.sheet.dragging {
		transition: none;
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
		width: 36px;
		height: 4px;
		border-radius: 2px;
		background: var(--color-border);
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
		.sheet-backdrop {
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
