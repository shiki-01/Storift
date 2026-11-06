import type { EditorFont } from '$lib/types';

const SYSTEM_PREFIX = 'system:';

/** 値がシステムフォント指定(`system:名前`)か */
export function isSystemFont(font: string): font is `system:${string}` {
	return font.startsWith(SYSTEM_PREFIX) && font.length > SYSTEM_PREFIX.length;
}

/** EditorFont からシステムフォント名を取り出す。システムフォントでなければ null */
export function getSystemFontName(font: EditorFont): string | null {
	return isSystemFont(font) ? font.slice(SYSTEM_PREFIX.length) : null;
}

/** フォント名から EditorFont の値を作る */
export function toSystemFontValue(name: string): EditorFont {
	return `${SYSTEM_PREFIX}${name.trim()}`;
}

/**
 * システムフォント名を CSS の font-family に変換する。
 * 引用符・バックスラッシュ・セミコロン等を除去し、和文向けに serif/sans-serif を後ろに付ける。
 */
export function systemFontToCss(name: string): string {
	const safe = name.replace(/["';{}<>\n\r]/g, '').trim();
	if (!safe) return 'sans-serif';
	return `"${safe}", serif, sans-serif`;
}

/**
 * window.queryLocalFonts() でインストール済みフォントのファミリー名を列挙する。
 * 非対応・権限拒否の場合は空配列(呼び出し側で自由入力にフォールバックする)。
 */
export async function listSystemFonts(): Promise<string[]> {
	const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> })
		.queryLocalFonts;
	if (typeof query !== 'function') return [];
	try {
		const fonts = await query.call(window);
		return [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'ja'));
	} catch {
		return [];
	}
}

const FONT_FAMILIES: Record<string, string> = {
	'yu-gothic': '"Yu Gothic", "游ゴシック", YuGothic, "游ゴシック体", sans-serif',
	'gen-shin-mincho': '"源真明朝", "Gen Shin Mincho", serif',
	'hiragino-mincho': '"Hiragino Mincho ProN", "ヒラギノ明朝 ProN", serif',
	'noto-sans': '"Noto Sans JP", sans-serif',
	'noto-serif': '"Noto Serif JP", serif',
	'hannari-mincho': '"はんなり明朝", "Hannari Mincho", serif',
	'sawarabi-mincho': '"さわらび明朝", "Sawarabi Mincho", serif',
	'sawarabi-gothic': '"さわらびゴシック", "Sawarabi Gothic", sans-serif'
};

/** 執筆画面のフォント設定(EditorFont)を CSS の font-family に変換する(通読プレビュー用) */
export function editorFontToCss(font: EditorFont): string {
	const systemName = getSystemFontName(font);
	if (systemName) return systemFontToCss(systemName);
	return FONT_FAMILIES[font] || FONT_FAMILIES['yu-gothic'];
}
