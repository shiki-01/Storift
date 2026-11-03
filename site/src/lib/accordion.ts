import type { Action } from 'svelte/action';

/**
 * <details> の開閉を高さのアニメーションで滑らかにする。
 * 動きを減らす設定のときは、ブラウザ標準の即時開閉のままにする。
 */
export const accordion: Action<HTMLDetailsElement> = (details) => {
	const summary = details.querySelector('summary');
	let animation: Animation | null = null;
	let closing = false;

	function run(from: number, to: number, onDone: () => void) {
		animation?.cancel();
		details.style.overflow = 'hidden';
		const a = details.animate(
			{ height: [`${from}px`, `${to}px`] },
			{ duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
		);
		animation = a;
		const done = () => {
			if (animation !== a) return;
			animation = null;
			details.style.overflow = '';
			onDone();
		};
		a.onfinish = done;
		a.oncancel = () => {
			if (animation === a) {
				animation = null;
				details.style.overflow = '';
			}
		};
	}

	function onClick(e: MouseEvent) {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		e.preventDefault();
		const closedHeight = summary?.offsetHeight ?? 0;
		const current = details.offsetHeight;
		if (closing || (!details.open && !animation)) {
			// 開く(閉じている途中で押されたときも、いまの高さから開き直す)
			closing = false;
			details.open = true;
			run(
				Math.min(current, closedHeight) === current && !animation ? closedHeight : current,
				details.scrollHeight,
				() => {}
			);
		} else {
			closing = true;
			run(current, closedHeight, () => {
				closing = false;
				details.open = false;
			});
		}
	}

	summary?.addEventListener('click', onClick);
	return {
		destroy() {
			summary?.removeEventListener('click', onClick);
			animation?.cancel();
		}
	};
};
