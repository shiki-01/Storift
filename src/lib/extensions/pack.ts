/**
 * パック(コードを含まない拡張)の貢献(contributions)・コンテンツ・バンドルの型と、実行時の検証。
 *
 * パックは JSON だけで構成する。マニフェストの `contributions` に、貢献の種類ごとに
 * コンテンツ(JSON ファイル)への相対パスを書き、このファイルがコンテンツの中身を検証する。
 * アプリ・紹介サイトのビルド・リポジトリの検証スクリプト(scripts/)が同じ実装を使うので、
 * 他のモジュールに依存させない(純関数と定数だけを置く)。
 */

/** 貢献の種類 */
export const CONTRIBUTION_KINDS = [
	'themes',
	'proofreadRules',
	'assistKeys',
	'exportPresets'
] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export const CONTRIBUTION_LABELS: Record<ContributionKind, string> = {
	themes: '配色テーマ',
	proofreadRules: '校正の辞書(表記ゆれ)',
	assistKeys: '入力補助キー',
	exportPresets: '書き出しのプリセット'
};

/** マニフェストの contributions: 貢献の種類ごとの、コンテンツ(JSON)への相対パス */
export type PackContributions = Partial<Record<ContributionKind, string[]>>;

/** サイズなどの上限(アプリ・サイト・検証スクリプトで共通) */
export const PACK_LIMITS = {
	/** コンテンツ 1 ファイルの上限(バイト) */
	fileBytes: 256 * 1024,
	/** パック全体(コンテンツの合計)の上限(バイト) */
	totalBytes: 1024 * 1024,
	/** マニフェスト(JSON)の上限(バイト) */
	manifestBytes: 64 * 1024,
	/** バンドル(.storiftext.json)全体の上限(バイト) */
	bundleBytes: 1280 * 1024,
	/** 貢献の種類ごとのファイル数 */
	filesPerKind: 8,
	/** 校正の辞書: 1 ファイルあたりの規則の数 */
	rulesPerFile: 500,
	/** 校正の辞書: パック全体の規則の数 */
	rulesPerPack: 1000,
	/** 校正の辞書: 検索する語・置き換える語の長さ(文字数) */
	ruleWordLength: 32,
	/** 校正の辞書: 説明文の長さ */
	ruleMessageLength: 80,
	/** 入力補助キー: 1 セットあたりのキーの数 */
	keysPerSet: 32,
	/** 入力補助キー: 表示文字の長さ */
	keyLabelLength: 8,
	/** 入力補助キー: 挿入する文字列の長さ */
	keyTextLength: 16,
	/** リポジトリに置く画像(png / svg)1 枚の上限(バイト) */
	imageBytes: 256 * 1024,
	/** 名前の長さ */
	nameLength: 40,
	/** 説明の長さ */
	descriptionLength: 120
} as const;

/** コミュニティの拡張に認めるライセンス(SPDX の識別子) */
export const ALLOWED_LICENSES: readonly string[] = [
	'MIT',
	'Apache-2.0',
	'CC0-1.0',
	'CC-BY-4.0',
	'ISC',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'0BSD',
	'Unlicense'
];

/** 配色テーマのコントラスト比の下限(WCAG) */
export const THEME_CONTRAST = {
	/** 本文と背景(画面・原稿) */
	text: 4.5,
	/** 薄い文字(textSecondary)と背景 */
	secondaryText: 3,
	/** 差し色(primary / accent)と背景 */
	accent: 3
} as const;

export const BUNDLE_FORMAT = 'storift-extension-bundle';
export const BUNDLE_VERSION = 1;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTENT_PATH_PATTERN =
	/^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*(?:\/[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*){0,2}\.json$/;
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// ---------------------------------------------------------------------------
// 共通の小さな道具
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 制御文字・書字方向の制御文字・ゼロ幅文字・BOM を含むか(挿入文字列・表示名に入れさせない) */
export function hasForbiddenChars(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (
			c <= 0x1f ||
			(c >= 0x7f && c <= 0x9f) ||
			(c >= 0x200b && c <= 0x200f) ||
			(c >= 0x202a && c <= 0x202e) ||
			(c >= 0x2060 && c <= 0x2064) ||
			(c >= 0x2066 && c <= 0x2069) ||
			c === 0xfeff
		) {
			return true;
		}
	}
	return false;
}

/** UTF-8 でのバイト数 */
export function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[]): string[] {
	return Object.keys(obj).filter((key) => !allowed.includes(key));
}

function isText(value: unknown, max: number): value is string {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= max &&
		!hasForbiddenChars(value)
	);
}

function isId(value: unknown): value is string {
	return typeof value === 'string' && ID_PATTERN.test(value) && value.length <= 48;
}

// ---------------------------------------------------------------------------
// 色(コントラスト比の計算。アプリの themeTools と同じ式。こちらは他に依存しない)
// ---------------------------------------------------------------------------

function normalizeHex(hex: string): string {
	let body = hex.slice(1).toLowerCase();
	if (body.length === 3) {
		body = body
			.split('')
			.map((c) => c + c)
			.join('');
	}
	return `#${body}`;
}

function luminance(hex: string): number {
	const body = hex.slice(1);
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = parseInt(body.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG のコントラスト比(1〜21)。引数は正規化した #rrggbb */
export function hexContrast(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 背景色として暗いか(白より黒との対比が強いか) */
export function hexIsDark(hex: string): boolean {
	return hexContrast(hex, '#ffffff') > hexContrast(hex, '#000000');
}

// ---------------------------------------------------------------------------
// 貢献(contributions)の宣言
// ---------------------------------------------------------------------------

/** マニフェストの contributions を検証する(パスの形・重複・個数)。ファイルの中身は見ない */
export function validateContributions(value: unknown, errors: string[]): void {
	if (!isRecord(value)) {
		errors.push('contributions はオブジェクトで指定してください');
		return;
	}
	for (const key of unknownKeys(value, CONTRIBUTION_KINDS)) {
		errors.push(`contributions.${key} は使えない項目です`);
	}
	const seen = new Set<string>();
	let count = 0;
	for (const kind of CONTRIBUTION_KINDS) {
		const list = value[kind];
		if (list === undefined) continue;
		if (!Array.isArray(list) || list.length === 0) {
			errors.push(`contributions.${kind} は、ファイルのパスの配列で指定してください`);
			continue;
		}
		if (list.length > PACK_LIMITS.filesPerKind) {
			errors.push(`contributions.${kind} は ${PACK_LIMITS.filesPerKind} ファイルまでです`);
		}
		for (const path of list) {
			count++;
			if (typeof path !== 'string' || !isSafeContentPath(path)) {
				errors.push(
					`contributions.${kind} のパスが正しくありません: ${String(path)}(小文字英数字・ハイフン・アンダースコアの .json ファイル。階層は 3 つまで。.. や絶対パスは不可)`
				);
				continue;
			}
			if (seen.has(path)) errors.push(`contributions に同じファイルが重複しています: ${path}`);
			seen.add(path);
		}
	}
	if (count === 0) errors.push('contributions に、貢献を 1 つ以上書いてください');
}

/**
 * コンテンツのパスが安全か。パックのルートからの相対パスで、`..`・絶対パス・バックスラッシュ・
 * 隠しファイルを含まない(フォルダから読み込むときのパストラバーサル対策でもある)
 */
export function isSafeContentPath(path: string): boolean {
	if (path.length > 100 || path === 'manifest.json') return false;
	if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
	return CONTENT_PATH_PATTERN.test(path);
}

/** 宣言された貢献のファイルパスを、重複なく順に並べる */
export function contributionPaths(contributions: PackContributions | undefined): string[] {
	const out: string[] = [];
	for (const kind of CONTRIBUTION_KINDS) {
		for (const path of contributions?.[kind] ?? []) if (!out.includes(path)) out.push(path);
	}
	return out;
}

/** 宣言されている貢献の種類(表示用) */
export function contributionKinds(
	contributions: PackContributions | undefined
): ContributionKind[] {
	return CONTRIBUTION_KINDS.filter((kind) => (contributions?.[kind]?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// コンテンツの型
// ---------------------------------------------------------------------------

export interface PackThemeColors {
	primary: string;
	secondary: string;
	background: string;
	surface: string;
	text: string;
	textSecondary: string;
	border: string;
	accent: string;
	success: string;
	warning: string;
	error: string;
	info: string;
}

export interface PackThemeEditor {
	background: string;
	text: string;
	selection: string;
	lineHighlight: string;
	cursor: string;
}

/** 配色テーマ。アプリのテーマ(theme.svelte.ts の Theme)と同じトークン。フォントは持てない */
export interface PackTheme {
	id: string;
	name: string;
	scheme: 'light' | 'dark';
	colors: PackThemeColors;
	editor: PackThemeEditor;
}

export interface PackProofreadRule {
	/** 検索する文字列(固定文字列。正規表現ではない) */
	from: string;
	/** 置き換えの候補 */
	to: string;
	/** 指摘の文言(省略時は「「from」は「to」と書く」) */
	message?: string;
}

export interface PackProofreadRuleSet {
	id: string;
	name: string;
	description?: string;
	rules: PackProofreadRule[];
}

export interface PackAssistKey {
	/** キーに表示する文字 */
	label: string;
	/** 挿入する文字列 */
	text: string;
	/** 挿入後にカーソルを左へ戻す文字数(「」の中に置くときは 1) */
	caretBack: number;
}

export interface PackAssistKeySet {
	id: string;
	name: string;
	keys: PackAssistKey[];
}

export const RUBY_MODES = ['keep', 'pipe-ascii', 'paren', 'strip'] as const;
export const BOUTEN_MODES = ['keep', 'ruby-dots', 'strip'] as const;
export const BLANK_LINE_MODES = ['keep', 'between-paragraphs', 'collapse'] as const;
export type RubyMode = (typeof RUBY_MODES)[number];
export type BoutenMode = (typeof BOUTEN_MODES)[number];
export type BlankLineMode = (typeof BLANK_LINE_MODES)[number];

/** 書き出しのプリセット。本文の記法の変換(テキスト・Markdown の書き出しに適用する) */
export interface PackExportPreset {
	id: string;
	name: string;
	description?: string;
	/** ルビ ｜親《ルビ》 の書き方 */
	ruby: RubyMode;
	/** 傍点 《《語》》 の書き方 */
	bouten: BoutenMode;
	/** 空行の扱い */
	blankLines: BlankLineMode;
}

export interface PackContent {
	themes: PackTheme[];
	proofreadRules: PackProofreadRuleSet[];
	assistKeys: PackAssistKeySet[];
	exportPresets: PackExportPreset[];
}

export function emptyContent(): PackContent {
	return { themes: [], proofreadRules: [], assistKeys: [], exportPresets: [] };
}

// ---------------------------------------------------------------------------
// コンテンツの検証
// ---------------------------------------------------------------------------

const THEME_COLOR_KEYS = [
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
const THEME_EDITOR_KEYS = ['background', 'text', 'selection', 'lineHighlight', 'cursor'] as const;

function readHexGroup<K extends string>(
	source: unknown,
	keys: readonly K[],
	label: string,
	errors: string[]
): Record<K, string> | null {
	if (!isRecord(source)) {
		errors.push(`${label} がありません`);
		return null;
	}
	for (const key of unknownKeys(source, keys)) errors.push(`${label}.${key} は使えない項目です`);
	const result = {} as Record<K, string>;
	let ok = true;
	for (const key of keys) {
		const value = source[key];
		if (typeof value !== 'string' || !HEX_PATTERN.test(value)) {
			errors.push(`${label}.${key} は #rgb または #rrggbb の色で指定してください`);
			ok = false;
			continue;
		}
		result[key] = normalizeHex(value);
	}
	return ok ? result : null;
}

function checkContrast(errors: string[], a: string, b: string, min: number, what: string) {
	const ratio = hexContrast(a, b);
	if (ratio < min) {
		errors.push(`${what}のコントラスト比が ${ratio.toFixed(2)} です(${min} 以上にしてください)`);
	}
}

function validateTheme(value: unknown, label: string, errors: string[]): PackTheme | null {
	if (!isRecord(value)) {
		errors.push(`${label}: テーマはオブジェクトで指定してください`);
		return null;
	}
	const before = errors.length;
	const fail = (message: string) => errors.push(`${label}: ${message}`);
	const scoped: string[] = [];
	for (const key of unknownKeys(value, ['id', 'name', 'scheme', 'colors', 'editor'])) {
		scoped.push(`${key} は使えない項目です(フォントは指定できません)`);
	}
	if (!isId(value.id)) scoped.push('id は英小文字・数字・ハイフンで指定してください');
	if (!isText(value.name, PACK_LIMITS.nameLength)) scoped.push('name(テーマ名)を書いてください');
	if (value.scheme !== 'light' && value.scheme !== 'dark')
		scoped.push('scheme は light / dark のどちらかで指定してください');
	const colors = readHexGroup(value.colors, THEME_COLOR_KEYS, 'colors', scoped);
	const editor = readHexGroup(value.editor, THEME_EDITOR_KEYS, 'editor', scoped);
	if (colors && editor && scoped.length === 0) {
		const isDark = hexIsDark(colors.background);
		if ((value.scheme === 'dark') !== isDark) {
			scoped.push(
				`scheme が ${String(value.scheme)} ですが、背景色(${colors.background})は${isDark ? '暗い' : '明るい'}色です`
			);
		}
		const c = THEME_CONTRAST;
		const issues: string[] = [];
		checkContrast(issues, colors.text, colors.background, c.text, '文字色と背景色');
		checkContrast(issues, editor.text, editor.background, c.text, '原稿の文字色と背景色');
		checkContrast(issues, colors.text, colors.surface, c.text, '文字色と面の色');
		checkContrast(issues, editor.text, editor.selection, c.secondaryText, '原稿の文字色と選択範囲');
		checkContrast(
			issues,
			colors.textSecondary,
			colors.background,
			c.secondaryText,
			'薄い文字色(textSecondary)と背景色'
		);
		checkContrast(issues, colors.primary, colors.background, c.accent, 'primary と背景色');
		checkContrast(issues, colors.accent, colors.background, c.accent, 'accent と背景色');
		scoped.push(...issues);
	}
	for (const m of scoped) fail(m);
	if (errors.length > before || !colors || !editor) return null;
	return {
		id: value.id as string,
		name: (value.name as string).trim(),
		scheme: value.scheme as 'light' | 'dark',
		colors: colors as unknown as PackThemeColors,
		editor: editor as unknown as PackThemeEditor
	};
}

function validateRuleSet(
	value: unknown,
	label: string,
	errors: string[]
): PackProofreadRuleSet | null {
	if (!isRecord(value)) {
		errors.push(`${label}: 辞書はオブジェクトで指定してください`);
		return null;
	}
	const before = errors.length;
	const fail = (message: string) => errors.push(`${label}: ${message}`);
	for (const key of unknownKeys(value, ['id', 'name', 'description', 'rules'])) {
		fail(`${key} は使えない項目です`);
	}
	if (!isId(value.id)) fail('id は英小文字・数字・ハイフンで指定してください');
	if (!isText(value.name, PACK_LIMITS.nameLength)) fail('name(辞書名)を書いてください');
	if (value.description !== undefined && !isText(value.description, PACK_LIMITS.descriptionLength))
		fail(`description は ${PACK_LIMITS.descriptionLength} 文字以内の文字列で指定してください`);
	const rules: PackProofreadRule[] = [];
	if (!Array.isArray(value.rules) || value.rules.length === 0) {
		fail('rules を 1 件以上、配列で指定してください');
	} else if (value.rules.length > PACK_LIMITS.rulesPerFile) {
		fail(`rules は ${PACK_LIMITS.rulesPerFile} 件までです`);
	} else {
		const froms = new Set<string>();
		value.rules.forEach((rule, i) => {
			const at = `rules[${i}]`;
			if (!isRecord(rule)) return fail(`${at} はオブジェクトで指定してください`);
			for (const key of unknownKeys(rule, ['from', 'to', 'message'])) {
				fail(
					`${at}.${key} は使えない項目です${key === 'pattern' || key === 'regex' ? '(正規表現は使えません。固定の文字列だけです)' : ''}`
				);
			}
			const { from, to, message } = rule;
			if (
				typeof from !== 'string' ||
				from.length === 0 ||
				from.length > PACK_LIMITS.ruleWordLength ||
				hasForbiddenChars(from) ||
				from.trim() !== from
			)
				return fail(
					`${at}.from は ${PACK_LIMITS.ruleWordLength} 文字以内の文字列にしてください(前後の空白・制御文字は不可)`
				);
			if (typeof to !== 'string' || to.length > PACK_LIMITS.ruleWordLength || hasForbiddenChars(to))
				return fail(
					`${at}.to は ${PACK_LIMITS.ruleWordLength} 文字以内の文字列にしてください(制御文字は不可。削除の提案なら空文字)`
				);
			if (from === to) return fail(`${at}: from と to が同じです`);
			if (message !== undefined && !isText(message, PACK_LIMITS.ruleMessageLength))
				return fail(`${at}.message は ${PACK_LIMITS.ruleMessageLength} 文字以内にしてください`);
			if (froms.has(from)) return fail(`${at}.from が重複しています: ${from}`);
			froms.add(from);
			rules.push({ from, to, ...(message !== undefined ? { message } : {}) });
		});
	}
	if (errors.length > before) return null;
	return {
		id: value.id as string,
		name: (value.name as string).trim(),
		...(value.description !== undefined ? { description: value.description as string } : {}),
		rules
	};
}

function validateKeySet(value: unknown, label: string, errors: string[]): PackAssistKeySet | null {
	if (!isRecord(value)) {
		errors.push(`${label}: キーのセットはオブジェクトで指定してください`);
		return null;
	}
	const before = errors.length;
	const fail = (message: string) => errors.push(`${label}: ${message}`);
	for (const key of unknownKeys(value, ['id', 'name', 'keys'])) fail(`${key} は使えない項目です`);
	if (!isId(value.id)) fail('id は英小文字・数字・ハイフンで指定してください');
	if (!isText(value.name, PACK_LIMITS.nameLength)) fail('name(セット名)を書いてください');
	const keys: PackAssistKey[] = [];
	if (!Array.isArray(value.keys) || value.keys.length === 0) {
		fail('keys を 1 件以上、配列で指定してください');
	} else if (value.keys.length > PACK_LIMITS.keysPerSet) {
		fail(`keys は ${PACK_LIMITS.keysPerSet} 件までです`);
	} else {
		value.keys.forEach((key, i) => {
			const at = `keys[${i}]`;
			if (!isRecord(key)) return fail(`${at} はオブジェクトで指定してください`);
			for (const k of unknownKeys(key, ['label', 'text', 'caretBack'])) {
				fail(`${at}.${k} は使えない項目です`);
			}
			if (typeof key.text !== 'string' || key.text.length === 0 || hasForbiddenChars(key.text))
				return fail(`${at}.text は、制御文字を含まない 1 文字以上の文字列にしてください`);
			if (key.text.length > PACK_LIMITS.keyTextLength)
				return fail(`${at}.text は ${PACK_LIMITS.keyTextLength} 文字以内にしてください`);
			const label =
				key.label === undefined ? key.text : typeof key.label === 'string' ? key.label : null;
			if (
				label === null ||
				label.length === 0 ||
				label.length > PACK_LIMITS.keyLabelLength ||
				hasForbiddenChars(label)
			)
				return fail(
					`${at}.label は ${PACK_LIMITS.keyLabelLength} 文字以内の文字列にしてください(制御文字は不可)`
				);
			const caretBack = key.caretBack ?? 0;
			if (
				typeof caretBack !== 'number' ||
				!Number.isInteger(caretBack) ||
				caretBack < 0 ||
				caretBack > key.text.length
			)
				return fail(`${at}.caretBack は 0 以上、text の長さ以下の整数にしてください`);
			keys.push({ label, text: key.text, caretBack });
		});
	}
	if (errors.length > before) return null;
	return { id: value.id as string, name: (value.name as string).trim(), keys };
}

function validatePreset(value: unknown, label: string, errors: string[]): PackExportPreset | null {
	if (!isRecord(value)) {
		errors.push(`${label}: プリセットはオブジェクトで指定してください`);
		return null;
	}
	const before = errors.length;
	const fail = (message: string) => errors.push(`${label}: ${message}`);
	for (const key of unknownKeys(value, [
		'id',
		'name',
		'description',
		'ruby',
		'bouten',
		'blankLines'
	])) {
		fail(`${key} は使えない項目です`);
	}
	if (!isId(value.id)) fail('id は英小文字・数字・ハイフンで指定してください');
	if (!isText(value.name, PACK_LIMITS.nameLength)) fail('name(プリセット名)を書いてください');
	if (value.description !== undefined && !isText(value.description, PACK_LIMITS.descriptionLength))
		fail(`description は ${PACK_LIMITS.descriptionLength} 文字以内の文字列で指定してください`);
	const ruby = value.ruby ?? 'keep';
	const bouten = value.bouten ?? 'keep';
	const blankLines = value.blankLines ?? 'keep';
	if (!(RUBY_MODES as readonly unknown[]).includes(ruby))
		fail(`ruby は ${RUBY_MODES.join(' / ')} のいずれかです`);
	if (!(BOUTEN_MODES as readonly unknown[]).includes(bouten))
		fail(`bouten は ${BOUTEN_MODES.join(' / ')} のいずれかです`);
	if (!(BLANK_LINE_MODES as readonly unknown[]).includes(blankLines))
		fail(`blankLines は ${BLANK_LINE_MODES.join(' / ')} のいずれかです`);
	if (errors.length > before) return null;
	return {
		id: value.id as string,
		name: (value.name as string).trim(),
		...(value.description !== undefined ? { description: value.description as string } : {}),
		ruby: ruby as RubyMode,
		bouten: bouten as BoutenMode,
		blankLines: blankLines as BlankLineMode
	};
}

export type PackContentValidation =
	| { ok: true; content: PackContent }
	| { ok: false; errors: string[] };

/**
 * パックのコンテンツ(ファイルのパス → 解析済みの JSON)を検証する。
 * 宣言した全ファイルがあること・宣言していないファイルが無いこと・サイズ・各貢献の中身・id の重複を見る
 */
export function validatePackContent(
	contributions: PackContributions | undefined,
	files: Record<string, unknown>
): PackContentValidation {
	const errors: string[] = [];
	const content = emptyContent();
	const declared = contributionPaths(contributions);

	for (const path of Object.keys(files)) {
		if (!declared.includes(path))
			errors.push(`${path}: contributions に書かれていないファイルです`);
	}

	let total = 0;
	let rules = 0;
	const readers: Record<ContributionKind, (v: unknown, l: string, e: string[]) => unknown> = {
		themes: validateTheme,
		proofreadRules: validateRuleSet,
		assistKeys: validateKeySet,
		exportPresets: validatePreset
	};

	for (const kind of CONTRIBUTION_KINDS) {
		const ids = new Set<string>();
		for (const path of contributions?.[kind] ?? []) {
			if (!(path in files)) {
				errors.push(`${path}: ファイルがありません`);
				continue;
			}
			let size: number;
			try {
				size = byteLength(JSON.stringify(files[path]));
			} catch {
				errors.push(`${path}: JSON として扱えません`);
				continue;
			}
			total += size;
			if (size > PACK_LIMITS.fileBytes) {
				errors.push(`${path}: ${Math.round(PACK_LIMITS.fileBytes / 1024)}KB を超えています`);
				continue;
			}
			const item = readers[kind](files[path], path, errors) as { id: string } | null;
			if (!item) continue;
			if (ids.has(item.id)) errors.push(`${path}: id「${item.id}」が同じ種類の中で重複しています`);
			ids.add(item.id);
			(content[kind] as unknown[]).push(item);
			if (kind === 'proofreadRules') rules += (item as PackProofreadRuleSet).rules.length;
		}
	}
	if (total > PACK_LIMITS.totalBytes) {
		errors.push(`コンテンツの合計が ${Math.round(PACK_LIMITS.totalBytes / 1024)}KB を超えています`);
	}
	if (rules > PACK_LIMITS.rulesPerPack) {
		errors.push(`校正の規則が合計 ${PACK_LIMITS.rulesPerPack} 件を超えています`);
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, content };
}

/** コンテンツの項目数(同意画面・一覧に出す) */
export function countContent(content: PackContent): Record<ContributionKind, number> {
	return {
		themes: content.themes.length,
		proofreadRules: content.proofreadRules.reduce((n, s) => n + s.rules.length, 0),
		assistKeys: content.assistKeys.reduce((n, s) => n + s.keys.length, 0),
		exportPresets: content.exportPresets.length
	};
}

// ---------------------------------------------------------------------------
// バンドル(.storiftext.json): マニフェスト + 全コンテンツを 1 つの JSON にしたもの
// ---------------------------------------------------------------------------

export interface PackBundle<M = unknown> {
	format: typeof BUNDLE_FORMAT;
	bundleVersion: typeof BUNDLE_VERSION;
	manifest: M;
	/** コンテンツのパス → 解析済みの JSON */
	files: Record<string, unknown>;
}

/** バンドルを作る。ファイルはパスの昇順に並べる(同じ入力から同じバイト列が出るようにする) */
export function buildBundle<M>(manifest: M, files: Record<string, unknown>): PackBundle<M> {
	const sorted: Record<string, unknown> = {};
	for (const path of Object.keys(files).sort()) sorted[path] = files[path];
	return { format: BUNDLE_FORMAT, bundleVersion: BUNDLE_VERSION, manifest, files: sorted };
}

/** バンドルを JSON 文字列にする(末尾に改行を 1 つ) */
export function serializeBundle(bundle: PackBundle): string {
	return `${JSON.stringify(bundle)}\n`;
}

export type BundleShape = { ok: true; bundle: PackBundle } | { ok: false; errors: string[] };

/** バンドルの外側の形(format・版・files)を検証する。マニフェストとコンテンツの検証は呼び出し側 */
export function checkBundleShape(input: unknown): BundleShape {
	if (!isRecord(input)) return { ok: false, errors: ['バンドルは JSON のオブジェクトです'] };
	const errors: string[] = [];
	for (const key of unknownKeys(input, ['format', 'bundleVersion', 'manifest', 'files'])) {
		errors.push(`${key} は使えない項目です`);
	}
	if (input.format !== BUNDLE_FORMAT) errors.push('Storift の拡張のバンドルではありません');
	else if (input.bundleVersion !== BUNDLE_VERSION)
		errors.push(`未対応のバンドルの版です: ${String(input.bundleVersion)}`);
	if (!isRecord(input.manifest)) errors.push('manifest がありません');
	if (!isRecord(input.files)) errors.push('files がありません');
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, bundle: input as unknown as PackBundle };
}
