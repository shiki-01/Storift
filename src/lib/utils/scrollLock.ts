/**
 * スクロールしないはずの入れ物(ウィンドウ・アプリの外枠)が、ブラウザの自動スクロールで動いたときに戻す。
 *
 * overflow: hidden の要素も、フォーカスやカーソルを見せるための自動スクロール(scrollIntoView 相当)では
 * 動いてしまう。いったん動くと利用者には戻す手段がなく、画面が大きく下にずれたままになる。
 * このアプリは各ページの縦スクロールのコンテナがスクロールするので、ウィンドウと
 * data-scroll-lock の付いた要素は常に先頭に戻してよい。
 */
export function installScrollLock(): () => void {
	if (typeof window === 'undefined') return () => {};

	const resetWindow = () => {
		if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
	};
	const onScroll = (e: Event) => {
		const target = e.target;
		if (target === document || target === document.documentElement || target === document.body) {
			resetWindow();
			return;
		}
		if (target instanceof HTMLElement && target.hasAttribute('data-scroll-lock')) {
			if (target.scrollTop !== 0) target.scrollTop = 0;
			if (target.scrollLeft !== 0) target.scrollLeft = 0;
		}
	};
	document.addEventListener('scroll', onScroll, { capture: true, passive: true });
	window.addEventListener('scroll', resetWindow, { passive: true });
	return () => {
		document.removeEventListener('scroll', onScroll, { capture: true });
		window.removeEventListener('scroll', resetWindow);
	};
}
