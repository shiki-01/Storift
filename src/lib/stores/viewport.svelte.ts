/**
 * ビューポート状態ストア
 * - isMobile: スマホ向けレイアウトを使う幅か
 * - keyboardHeight: ソフトウェアキーボードの高さ(visualViewport から算出)
 */
export const MOBILE_MAX_WIDTH = 768;

let isMobile = $state(false);
let keyboardHeight = $state(0);
let viewportHeight = $state(0);
let viewportOffsetTop = $state(0);
let initialized = false;

/** キーボードが出ているとみなす最小の高さ(アドレスバーの伸縮と区別する) */
const KEYBOARD_THRESHOLD = 120;

export function computeKeyboardHeight(
	layoutHeight: number,
	visualHeight: number,
	visualOffsetTop: number
): number {
	const diff = layoutHeight - visualHeight - visualOffsetTop;
	return diff > KEYBOARD_THRESHOLD ? Math.round(diff) : 0;
}

export function initViewport(): () => void {
	if (typeof window === 'undefined') return () => {};

	const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
	const updateMobile = () => {
		isMobile = mq.matches;
	};
	updateMobile();
	mq.addEventListener('change', updateMobile);

	const vv = window.visualViewport;
	const updateViewport = () => {
		if (!vv) return;
		viewportHeight = vv.height;
		viewportOffsetTop = vv.offsetTop;
		keyboardHeight = computeKeyboardHeight(window.innerHeight, vv.height, vv.offsetTop);
	};
	updateViewport();
	vv?.addEventListener('resize', updateViewport);
	vv?.addEventListener('scroll', updateViewport);

	initialized = true;

	return () => {
		mq.removeEventListener('change', updateMobile);
		vv?.removeEventListener('resize', updateViewport);
		vv?.removeEventListener('scroll', updateViewport);
		initialized = false;
	};
}

export const viewport = {
	get isMobile() {
		return isMobile;
	},
	get keyboardHeight() {
		return keyboardHeight;
	},
	get isKeyboardOpen() {
		return keyboardHeight > 0;
	},
	get height() {
		return viewportHeight;
	},
	get offsetTop() {
		return viewportOffsetTop;
	},
	get initialized() {
		return initialized;
	}
};
