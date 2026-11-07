/**
 * Tauri の既定のコンテキストメニュー(戻る・再読み込み・検証など)の扱い。
 *
 * 入力欄と、テキストを選択しているときだけ既定のメニューを残す(切り取り・コピー・貼り付け・綴りの修正に必要)。
 * それ以外の場所では出さない。自前のメニューが preventDefault 済みのイベントには触れない。
 * 開発ビルドでは「検証」が必要なので無効にしない。Web / PWA では何もしない。
 */
import { isDesktop } from './platform';

const NON_TEXT_INPUTS = new Set([
	'button',
	'checkbox',
	'color',
	'file',
	'image',
	'radio',
	'range',
	'reset',
	'submit'
]);

/** 既定のメニューを出すべき場所か(文字を入力・編集できる要素の中) */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	const field = target.closest('input, textarea, [contenteditable]');
	if (!field) return false;
	if (field instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(field.type);
	if (field instanceof HTMLTextAreaElement) return true;
	const attr = field.getAttribute('contenteditable');
	return attr !== null && attr.toLowerCase() !== 'false';
}

/** 既定のメニューを止めるか */
export function shouldBlockNativeMenu(e: {
	target: EventTarget | null;
	defaultPrevented: boolean;
	selectionText: string;
}): boolean {
	if (e.defaultPrevented) return false;
	if (isEditableTarget(e.target)) return false;
	return e.selectionText.trim() === '';
}

/** ルートで 1 回だけ呼ぶ。戻り値で解除する */
export function installNativeContextMenuPolicy(
	options: { desktop?: boolean; dev?: boolean } = {}
): () => void {
	const desktop = options.desktop ?? isDesktop();
	const dev = options.dev ?? import.meta.env.DEV;
	if (!desktop || dev || typeof document === 'undefined') return () => {};
	// 自前のメニュー(要素側のハンドラー)が先に preventDefault できるよう、バブリングで受ける
	const onContextMenu = (e: MouseEvent) => {
		if (
			shouldBlockNativeMenu({
				target: e.target,
				defaultPrevented: e.defaultPrevented,
				selectionText: window.getSelection()?.toString() ?? ''
			})
		) {
			e.preventDefault();
		}
	};
	document.addEventListener('contextmenu', onContextMenu);
	return () => document.removeEventListener('contextmenu', onContextMenu);
}
