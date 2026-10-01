/**
 * ショートカットキーの文字列表現（例: "Ctrl+Shift+N"）の生成・照合
 *
 * - "Ctrl" は Ctrl キーまたは Cmd キー（Mac）のどちらでも成立する
 * - 修飾キーの順序は Ctrl, Alt, Shift で固定
 * - 英字キーは大文字、空白は "Space"、それ以外は KeyboardEvent.key のまま（例: "F2", "Enter"）
 */

import type { AppSettings } from '$lib/types/settings';

export type ShortcutAction = keyof AppSettings['shortcuts'];

export const DEFAULT_SHORTCUTS: AppSettings['shortcuts'] = {
	save: 'Ctrl+S',
	undo: 'Ctrl+Z',
	redo: 'Ctrl+Y',
	find: 'Ctrl+F',
	replace: 'Ctrl+H',
	newChapter: 'Ctrl+Shift+N',
	newScene: 'Ctrl+Alt+N'
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
	save: '保存',
	undo: '元に戻す',
	redo: 'やり直し',
	find: '検索',
	replace: '置換',
	newChapter: '新しい章',
	newScene: '新しいシーン'
};

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/** KeyboardEvent のうちショートカット判定に使う部分（テストで素のオブジェクトを渡せるようにする） */
export type ShortcutEventLike = Pick<
	KeyboardEvent,
	'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

function normalizeKey(e: ShortcutEventLike): string {
	// Alt（Mac の Option）を併用すると key が別の文字になるため、物理キー(code)を優先する
	if (e.altKey) {
		const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code ?? '');
		if (m) return m[1] ?? m[2];
	}
	if (e.key === ' ') return 'Space';
	return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

/**
 * キーイベントからショートカット文字列を作る。
 * 修飾キーだけが押された場合は null を返す。
 */
export function formatShortcut(e: ShortcutEventLike): string | null {
	if (MODIFIER_KEYS.has(e.key)) return null;
	const parts: string[] = [];
	if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
	if (e.altKey) parts.push('Alt');
	if (e.shiftKey) parts.push('Shift');
	parts.push(normalizeKey(e));
	return parts.join('+');
}

/**
 * 登録できるショートカットか。
 * 通常の文字入力と区別するため、Ctrl / Alt を伴うか、ファンクションキーである必要がある。
 */
export function isValidShortcut(shortcut: string): boolean {
	const parts = shortcut.split('+');
	const key = parts[parts.length - 1];
	if (!key) return false;
	return parts.includes('Ctrl') || parts.includes('Alt') || /^F\d{1,2}$/.test(key);
}

/** キーイベントが指定のショートカットに一致するか */
export function matchesShortcut(e: ShortcutEventLike, shortcut: string | undefined): boolean {
	if (!shortcut) return false;
	return formatShortcut(e) === shortcut;
}
