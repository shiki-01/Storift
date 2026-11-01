/**
 * テーマの純関数(色の計算・検証・ファイルの書き出し/読み込み)。
 * ブラウザ依存を持たないので、テストから直接呼べる。
 */
import { v4 as uuidv4 } from 'uuid';
import type { Theme } from '$lib/stores/theme.svelte';

type Rgb = [number, number, number];

export const THEME_FILE_FORMAT = 'storift-theme';
export const THEME_FILE_VERSION = 1;

/** 組み込みテーマと同じ既定フォント(theme.svelte.ts の light と揃える) */
export const DEFAULT_THEME_FONTS: Theme['fonts'] = {
	body: "'Noto Sans JP', sans-serif",
	editor: "'Noto Serif JP', serif",
	heading: "'Noto Sans JP', sans-serif"
};

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const COLOR_KEYS = [
	'primary',
	'secondary',
	'background',
	'surface',
	'text',
	'textSecondary',
	'border',
	'accent',
	'success',
	'warning',
	'error',
	'info'
] as const;

const EDITOR_KEYS = ['background', 'text', 'selection', 'lineHighlight', 'cursor'] as const;

const FONT_KEYS = ['body', 'editor', 'heading'] as const;

/** 「かんたん」モードで使う、明暗ごとの状態色 */
const STATUS_COLORS = {
	light: { success: '#557a4c', warning: '#b0812c', error: '#a83c3c', info: '#33507a' },
	dark: { success: '#93b486', warning: '#d6b06a', error: '#e08a82', info: '#9db3d1' }
} as const;

export function isHexColor(value: unknown): value is string {
	return typeof value === 'string' && HEX_PATTERN.test(value);
}

/** #rgb を #rrggbb に展開し、小文字にそろえる */
export function normalizeHex(hex: string): string {
	if (!isHexColor(hex)) {
		throw new Error(`色の形式が正しくありません: ${hex}`);
	}
	let body = hex.slice(1).toLowerCase();
	if (body.length === 3) {
		body = body
			.split('')
			.map((c) => c + c)
			.join('');
	}
	return `#${body}`;
}

function hexToRgb(hex: string): Rgb {
	const body = normalizeHex(hex).slice(1);
	return [0, 2, 4].map((i) => parseInt(body.slice(i, i + 2), 16)) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
	const body = rgb
		.map((v) =>
			Math.round(Math.min(255, Math.max(0, v)))
				.toString(16)
				.padStart(2, '0')
		)
		.join('');
	return `#${body}`;
}

/**
 * 2色を混ぜる。t=0 で a、t=1 で b になる(範囲外は 0〜1 に丸める)
 */
export function mixHex(a: string, b: string, t: number): string {
	const ra = hexToRgb(a);
	const rb = hexToRgb(b);
	const k = Math.min(1, Math.max(0, t));
	return rgbToHex([0, 1, 2].map((i) => ra[i] + (rb[i] - ra[i]) * k) as Rgb);
}

function channelLuminance(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG の相対輝度(0〜1)
 */
export function relativeLuminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map(channelLuminance);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG のコントラスト比(1〜21)。本文 4.5 以上、大きな文字 3 以上が目安
 */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * 背景として見たとき暗い色か(白より黒との対比が強いか)
 */
export function isDarkColor(hex: string): boolean {
	return contrastRatio(hex, '#ffffff') > contrastRatio(hex, '#000000');
}

/**
 * from から to へ少しずつ混ぜ、against と min 以上のコントラストが出る最初の色を返す。
 * 見つからなければ to を返す
 */
function mixUntilReadable(from: string, to: string, against: string, min: number): string {
	for (let t = 0; t <= 1; t += 0.02) {
		const candidate = mixHex(from, to, t);
		if (contrastRatio(candidate, against) >= min) return candidate;
	}
	return to;
}

export interface ThemeBase {
	name: string;
	background: string;
	text: string;
	primary: string;
	accent: string;
	/** 省略時は背景の明暗から判定する */
	dark?: boolean;
}

export type DerivedTheme = Pick<Theme, 'colors' | 'editor'>;

/**
 * 4色(背景・文字・メイン・差し色)から、残りの色をすべて導出する。
 * 面・枠線・薄い文字・原稿の背景などは背景と文字の混色で作る。
 */
export function deriveTheme(base: ThemeBase): DerivedTheme {
	const background = normalizeHex(base.background);
	const text = normalizeHex(base.text);
	const primary = normalizeHex(base.primary);
	const accent = normalizeHex(base.accent);
	const dark = base.dark ?? isDarkColor(background);
	const status = dark ? STATUS_COLORS.dark : STATUS_COLORS.light;

	const editorBackground = dark
		? mixHex(background, text, 0.03)
		: mixHex(background, '#ffffff', 0.5);

	return {
		colors: {
			primary,
			secondary: mixHex(primary, text, 0.3),
			background,
			surface: mixHex(background, text, dark ? 0.08 : 0.05),
			text,
			textSecondary: mixUntilReadable(background, text, background, 4.5),
			border: mixHex(background, text, 0.14),
			accent,
			...status
		},
		editor: {
			background: editorBackground,
			text,
			selection: mixHex(background, primary, 0.25),
			lineHighlight: mixHex(editorBackground, text, 0.04),
			cursor: primary
		}
	};
}

/**
 * テーマを書き出し用の JSON 文字列にする
 */
export function serializeTheme(theme: Theme): string {
	return JSON.stringify({ format: THEME_FILE_FORMAT, version: THEME_FILE_VERSION, theme }, null, 2);
}

/** 新しいカスタムテーマの ID を作る */
export function newCustomThemeId(): string {
	return `custom-${uuidv4()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readColors<K extends string>(
	source: unknown,
	keys: readonly K[],
	label: string
): Record<K, string> {
	if (!isRecord(source)) {
		throw new Error(`${label} がありません`);
	}
	const result = {} as Record<K, string>;
	for (const key of keys) {
		const value = source[key];
		if (!isHexColor(value)) {
			throw new Error(`${label}.${key} が #rgb・#rrggbb の形式ではありません`);
		}
		result[key] = normalizeHex(value);
	}
	return result;
}

function readFonts(source: unknown): Theme['fonts'] {
	const fonts = { ...DEFAULT_THEME_FONTS };
	if (source === undefined) return fonts;
	if (!isRecord(source)) {
		throw new Error('fonts の形式が正しくありません');
	}
	for (const key of FONT_KEYS) {
		const value = source[key];
		if (value === undefined) continue;
		if (typeof value !== 'string' || value.trim() === '') {
			throw new Error(`fonts.${key} が文字列ではありません`);
		}
		fonts[key] = value.trim();
	}
	return fonts;
}

/**
 * テーマファイルの文字列を検証し、新しい ID を振ったテーマとして返す。
 * 不正な場合はエラーを投げる
 */
export function parseThemeFile(text: string): Theme {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('JSON として読み込めません');
	}

	if (!isRecord(data) || data.format !== THEME_FILE_FORMAT) {
		throw new Error('Storift のテーマファイルではありません');
	}
	if (data.version !== THEME_FILE_VERSION) {
		throw new Error(`未対応のテーマファイルの版です: ${String(data.version)}`);
	}

	const body = data.theme;
	if (!isRecord(body)) {
		throw new Error('テーマの内容がありません');
	}
	if (typeof body.name !== 'string' || body.name.trim() === '') {
		throw new Error('テーマ名がありません');
	}

	return {
		id: newCustomThemeId(),
		name: body.name.trim(),
		colors: readColors(body.colors, COLOR_KEYS, 'colors'),
		editor: readColors(body.editor, EDITOR_KEYS, 'editor'),
		fonts: readFonts(body.fonts)
	};
}
