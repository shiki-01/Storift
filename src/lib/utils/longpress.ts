/**
 * 長押しアクション(タッチ・ペン用)。
 * iOS Safari は長押しで contextmenu イベントが発火しないため、自前で検出する。
 */
export interface LongPressOptions {
	onLongPress: (e: PointerEvent) => void;
	/** 長押しとみなすまでの時間(ms) */
	delay?: number;
}

export function longpress(node: HTMLElement, options: LongPressOptions) {
	let opts = options;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let startX = 0;
	let startY = 0;
	let fired = false;

	const cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};

	// 長押しで出したメニュー/オーバーレイが、指を離したときの click で即座に閉じないよう、
	// 直後の click をウィンドウ全体で一度だけ握りつぶす
	const swallowNextClick = () => {
		const swallow = (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopImmediatePropagation();
			cleanup();
		};
		const cleanup = () => {
			window.removeEventListener('click', swallow, true);
			clearTimeout(expire);
		};
		const expire = setTimeout(cleanup, 800);
		window.addEventListener('click', swallow, true);
	};

	const onDown = (e: PointerEvent) => {
		if (e.pointerType === 'mouse') return;
		fired = false;
		startX = e.clientX;
		startY = e.clientY;
		cancel();
		timer = setTimeout(() => {
			fired = true;
			navigator.vibrate?.(10);
			opts.onLongPress(e);
			swallowNextClick();
		}, opts.delay ?? 480);
	};

	const onMove = (e: PointerEvent) => {
		if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 8) cancel();
	};

	// 長押し後に指を離したときの click を無効化する
	const onClick = (e: MouseEvent) => {
		if (fired) {
			e.preventDefault();
			e.stopImmediatePropagation();
			fired = false;
		}
	};

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', cancel);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('pointerleave', cancel);
	node.addEventListener('click', onClick, true);

	return {
		update(next: LongPressOptions) {
			opts = next;
		},
		destroy() {
			cancel();
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('pointerleave', cancel);
			node.removeEventListener('click', onClick, true);
		}
	};
}
