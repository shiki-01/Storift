/**
 * ショートカットキーの表記・判定。
 * 表記は "Ctrl+Shift+F" の形式。Mac の Cmd も Ctrl と同じものとして扱う。
 */
import type { AppSettings } from '$lib/types';

export type ShortcutAction = keyof AppSettings['shortcuts'];

export const DEFAULT_SHORTCUTS: AppSettings['shortcuts'] = {
	save: 'Ctrl+S',
	undo: 'Ctrl+Z',
	redo: 'Ctrl+Y',
	find: 'Ctrl+Shift+F',
	replace: 'Ctrl+Shift+H',
	newChapter: 'Ctrl+Shift+N',
	newScene: 'Ctrl+Alt+N'
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
	save: '今すぐ保存',
	undo: '元に戻す',
	redo: 'やり直す',
	find: '検索',
	replace: '置換',
	newChapter: '新しい章',
	newScene: '新しいシーン'
};

/** ブラウザ(contenteditable)の標準動作に任せるため、変更できないもの */
export const FIXED_SHORTCUTS: ShortcutAction[] = ['undo', 'redo'];

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS']);

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

function normalizeKey(key: string): string {
	if (key === ' ') return 'Space';
	return key.length === 1 ? key.toUpperCase() : key;
}

/** キーイベントを "Ctrl+Shift+F" 形式に変換。修飾キーだけのときや修飾キー無しは null */
export function eventToShortcut(e: KeyLike): string | null {
	if (MODIFIER_KEYS.has(e.key)) return null;
	const ctrl = e.ctrlKey || e.metaKey;
	// 修飾キー無しの単独キーは入力と区別できないので、ショートカットにしない
	if (!ctrl && !e.altKey) return null;
	const parts: string[] = [];
	if (ctrl) parts.push('Ctrl');
	if (e.altKey) parts.push('Alt');
	if (e.shiftKey) parts.push('Shift');
	parts.push(normalizeKey(e.key));
	return parts.join('+');
}

/** 表記ゆれ(大文字小文字・順序・Cmd)を揃える */
export function normalizeShortcut(value: string): string {
	const tokens = value
		.split('+')
		.map((t) => t.trim())
		.filter(Boolean);
	const mods = { ctrl: false, alt: false, shift: false };
	let key = '';
	for (const token of tokens) {
		const lower = token.toLowerCase();
		if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta')
			mods.ctrl = true;
		else if (lower === 'alt' || lower === 'option') mods.alt = true;
		else if (lower === 'shift') mods.shift = true;
		else key = normalizeKey(token);
	}
	return [mods.ctrl && 'Ctrl', mods.alt && 'Alt', mods.shift && 'Shift', key]
		.filter(Boolean)
		.join('+');
}

export function matchesShortcut(e: KeyLike, shortcut: string): boolean {
	const actual = eventToShortcut(e);
	return !!actual && actual === normalizeShortcut(shortcut);
}

/** 同じキーが複数の操作に割り当てられていれば、その操作名の組を返す */
export function findConflicts(shortcuts: AppSettings['shortcuts']): ShortcutAction[][] {
	const byKey = new Map<string, ShortcutAction[]>();
	for (const [action, value] of Object.entries(shortcuts) as [ShortcutAction, string][]) {
		const key = normalizeShortcut(value);
		if (!key) continue;
		byKey.set(key, [...(byKey.get(key) ?? []), action]);
	}
	return [...byKey.values()].filter((actions) => actions.length > 1);
}

/**
 * 旧バージョンの既定値(Ctrl+F / Ctrl+H)はブラウザの検索を奪ってしまうため、
 * 未変更のままなら新しい既定値へ移す。ユーザーが変更した値には触れない。
 */
export function migrateShortcuts(
	saved: Partial<AppSettings['shortcuts']> | undefined
): AppSettings['shortcuts'] {
	const merged = { ...DEFAULT_SHORTCUTS, ...saved };
	if (saved?.find === 'Ctrl+F') merged.find = DEFAULT_SHORTCUTS.find;
	if (saved?.replace === 'Ctrl+H') merged.replace = DEFAULT_SHORTCUTS.replace;
	return merged;
}

/** 自動保存の最大待ち時間(ms)。旧データの「秒」表記(1000未満)も受け付ける */
export function normalizeAutoSaveMs(value: number | undefined): number {
	const v = typeof value === 'number' && Number.isFinite(value) ? value : 30000;
	const ms = v < 1000 ? v * 1000 : v;
	return Math.min(Math.max(ms, 5000), 300000);
}
