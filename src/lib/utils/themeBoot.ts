/**
 * 起動直後(IndexedDB を読む前)にテーマを適用するための純関数。
 * 確定済みのテーマを localStorage にミラーしておき、src/app.html の先頭のスクリプトが
 * 最初の描画前に同期で読んで適用する。更新後の再起動のように、IndexedDB の読み込みが
 * 遅れる・失敗する場面でも、直前のテーマを保つための仕組み。
 *
 * app.html のスクリプトは同じ判断を ES5 で書き写している(themeBoot.test.ts で食い違いを検出する)。
 */
import { isDarkColor } from '$lib/utils/themeTools';
import type { Theme } from '$lib/stores/theme.svelte';

/** ミラーの保存先(localStorage のキー)。app.html と揃える */
export const THEME_MIRROR_KEY = 'storift:theme-mirror';

export type ThemeScheme = 'light' | 'dark';

/** 適用に必要なものだけを取り出したテーマ */
export interface ThemeSnapshot {
	id: string;
	scheme: ThemeScheme;
	/** CSS 変数名 → 値 */
	vars: Record<string, string>;
}

export interface ThemeMirror {
	v: 1;
	/** システムに追従しているか */
	auto: boolean;
	/** 追従していないときに使うテーマ(追従中は直前に適用したテーマ) */
	fixed: ThemeSnapshot;
	/** 追従中、ライト/ダークのときに使うテーマ */
	light: ThemeSnapshot;
	dark: ThemeSnapshot;
	/** システムが最後にダークと判定できたか。判定できないときの代わりに使う */
	lastSystemDark: boolean;
}

/** テーマを CSS 変数の一覧にする */
export function themeToCssVars(theme: Theme): Record<string, string> {
	const { colors, editor, fonts } = theme;
	return {
		'--color-primary': colors.primary,
		'--color-secondary': colors.secondary,
		'--color-background': colors.background,
		'--color-surface': colors.surface,
		'--color-text': colors.text,
		'--color-text-secondary': colors.textSecondary,
		'--color-border': colors.border,
		'--color-accent': colors.accent,
		'--color-success': colors.success,
		'--color-warning': colors.warning,
		'--color-error': colors.error,
		'--color-info': colors.info,
		'--editor-background': editor.background,
		'--editor-text': editor.text,
		'--editor-selection': editor.selection,
		'--editor-line-highlight': editor.lineHighlight,
		'--editor-cursor': editor.cursor,
		'--font-body': fonts.body,
		'--font-editor': fonts.editor,
		'--font-heading': fonts.heading
	};
}

/** 背景の明暗から、テーマの配色(light/dark)を決める */
export function themeScheme(theme: Theme): ThemeScheme {
	return isDarkColor(theme.colors.background) ? 'dark' : 'light';
}

export function toSnapshot(theme: Theme): ThemeSnapshot {
	return { id: theme.id, scheme: themeScheme(theme), vars: themeToCssVars(theme) };
}

/**
 * システムがダークかを決める。
 * prefers-color-scheme が dark にも light にも一致しない(WebView が取得できていない)ときは、
 * 「ライト」に確定せず、直前の判定を使う。
 */
export function resolveSystemDark(
	darkMatches: boolean,
	lightMatches: boolean,
	lastSystemDark: boolean
): boolean {
	if (darkMatches) return true;
	if (lightMatches) return false;
	return lastSystemDark;
}

export function buildMirror(input: {
	auto: boolean;
	current: Theme;
	light: Theme;
	dark: Theme;
	lastSystemDark: boolean;
}): ThemeMirror {
	return {
		v: 1,
		auto: input.auto,
		fixed: toSnapshot(input.current),
		light: toSnapshot(input.light),
		dark: toSnapshot(input.dark),
		lastSystemDark: input.lastSystemDark
	};
}

function isSnapshot(value: unknown): value is ThemeSnapshot {
	if (!value || typeof value !== 'object') return false;
	const s = value as Partial<ThemeSnapshot>;
	return (
		typeof s.id === 'string' &&
		(s.scheme === 'light' || s.scheme === 'dark') &&
		!!s.vars &&
		typeof s.vars === 'object'
	);
}

/** localStorage の文字列をミラーに戻す。壊れている・版が違うなら null */
export function parseMirror(raw: string | null | undefined): ThemeMirror | null {
	if (!raw) return null;
	try {
		const m = JSON.parse(raw) as Partial<ThemeMirror> | null;
		if (!m || m.v !== 1) return null;
		if (!isSnapshot(m.fixed) || !isSnapshot(m.light) || !isSnapshot(m.dark)) return null;
		return {
			v: 1,
			auto: m.auto === true,
			fixed: m.fixed,
			light: m.light,
			dark: m.dark,
			lastSystemDark: m.lastSystemDark === true
		};
	} catch {
		return null;
	}
}

/** 起動時に適用するテーマを決める */
export function resolveBootSnapshot(
	mirror: ThemeMirror,
	darkMatches: boolean,
	lightMatches: boolean
): ThemeSnapshot {
	if (!mirror.auto) return mirror.fixed;
	return resolveSystemDark(darkMatches, lightMatches, mirror.lastSystemDark)
		? mirror.dark
		: mirror.light;
}

/** テーマのスナップショットを要素に適用する(ブラウザ側) */
export function applySnapshot(root: HTMLElement, snapshot: ThemeSnapshot): void {
	for (const [name, value] of Object.entries(snapshot.vars)) root.style.setProperty(name, value);
	root.setAttribute('data-theme', snapshot.id);
	root.style.colorScheme = snapshot.scheme;
	root.setAttribute('data-scheme', snapshot.scheme);
}
