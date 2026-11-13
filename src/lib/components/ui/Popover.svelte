<script lang="ts">
	/**
	 * 起点の要素(ボタン)に追従して下に開く、非モーダルなポップオーバー。拡張のツールバー項目などで使う。
	 * - 本体は body の直下に position: fixed で出す(親の overflow や transform で切れない)。画面端では反転・補正する。
	 * - Escape で閉じ、起点にフォーカスを戻す。外側のクリックでも閉じるが、このときはフォーカスを奪わない。
	 * - 起点を押して開閉する処理は呼び出し側が持つ(open を切り替える)。起点には開いている間
	 *   aria-haspopup="dialog" / aria-expanded / aria-controls を付ける。
	 * - リサイズ・スクロール・中身の大きさの変化で位置を取り直す。
	 * - 開いたらポップオーバー本体にフォーカスを移す(Tab で中の操作に進める)。フォーカスは閉じ込めない。
	 */
	import { tick, type Snippet } from 'svelte';
	import { computePopoverPosition, type PopoverPlacement } from './popoverPosition';

	interface Props {
		open?: boolean;
		/** 起点の要素 */
		anchor: HTMLElement | null | undefined;
		/** ダイアログの名前(スクリーンリーダー用) */
		label: string;
		/** 起点のどちら側にそろえて開くか。ツールバーの右側のボタンは 'end' */
		align?: 'start' | 'end';
		/** 閉じたとき(Escape・外側のクリック・close() のどれでも) */
		onclose?: () => void;
		/** 中身。close を呼ぶと閉じて、起点にフォーカスを戻す */
		children: Snippet<[{ close: () => void }]>;
	}

	let {
		open = $bindable(false),
		anchor,
		label,
		align = 'end',
		onclose,
		children
	}: Props = $props();

	const uid = $props.id();
	const dialogId = `${uid}-popover`;

	let popupEl = $state<HTMLDivElement>();
	let placement = $state<PopoverPlacement | null>(null);

	function close(refocus = true) {
		if (!open) return;
		open = false;
		placement = null;
		onclose?.();
		if (refocus) anchor?.focus();
	}

	function place() {
		if (!open || !anchor || !popupEl) return;
		placement = computePopoverPosition(
			anchor.getBoundingClientRect(),
			{ width: popupEl.offsetWidth, height: popupEl.scrollHeight },
			{ width: window.innerWidth, height: window.innerHeight },
			align
		);
	}

	// 開いたら本体にフォーカスを移し、位置を決める
	$effect(() => {
		if (!open || !popupEl) return;
		const el = popupEl;
		void tick().then(() => {
			place();
			el.focus({ preventScroll: true });
		});
	});

	// 起点のアクセシビリティ属性
	$effect(() => {
		const el = anchor;
		if (!el) return;
		el.setAttribute('aria-haspopup', 'dialog');
		el.setAttribute('aria-expanded', String(open));
		if (open) el.setAttribute('aria-controls', dialogId);
		else el.removeAttribute('aria-controls');
		return () => {
			el.removeAttribute('aria-expanded');
			el.removeAttribute('aria-controls');
		};
	});

	// 開いている間だけ、外側の操作・Escape・画面の変化を見る
	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			// 起点の操作は呼び出し側が開閉する(ここで閉じると、直後の click で開き直してしまう)
			if (anchor?.contains(target) || popupEl?.contains(target)) return;
			close(false);
		};
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.isComposing) return;
			e.preventDefault();
			e.stopPropagation();
			close(true);
		};
		const onViewportChange = (e: Event) => {
			// ポップオーバー自身のスクロールでは動かさない
			if (e.target instanceof Node && popupEl?.contains(e.target)) return;
			place();
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKeydown, true);
		window.addEventListener('resize', onViewportChange);
		window.addEventListener('scroll', onViewportChange, true);
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
		if (popupEl) observer?.observe(popupEl);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKeydown, true);
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('scroll', onViewportChange, true);
			observer?.disconnect();
		};
	});

	/** 本体を body の直下へ移す(親の overflow や transform に影響されない) */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

{#if open}
	<div
		bind:this={popupEl}
		use:portal
		id={dialogId}
		class="popover"
		data-side={placement?.side ?? 'down'}
		role="dialog"
		aria-label={label}
		tabindex="-1"
		style={placement
			? `top:${placement.top}px;left:${placement.left}px;max-height:${placement.maxHeight}px`
			: 'top:0;left:0;visibility:hidden'}
	>
		{@render children({ close: () => close(true) })}
	</div>
{/if}

<style>
	/* 本体は body 直下に移されるが、スコープ付きのスタイルはそのまま当たる */
	.popover {
		position: fixed;
		z-index: 1300;
		box-sizing: border-box;
		width: 300px;
		max-width: calc(100vw - 16px);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: var(--shadow-float);
		font-size: 13px;
		outline: none;
		animation: popover-down 0.12s ease-out;
		transform-origin: top right;
	}

	.popover[data-side='up'] {
		animation-name: popover-up;
		transform-origin: bottom right;
	}

	@keyframes popover-down {
		from {
			opacity: 0;
			transform: translateY(-4px) scale(0.98);
		}
	}

	@keyframes popover-up {
		from {
			opacity: 0;
			transform: translateY(4px) scale(0.98);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.popover {
			animation: none;
		}
	}
</style>
