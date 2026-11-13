/**
 * スクリプト拡張の画面(宣言的な UI 記述)。
 *
 * スクリプトは DOM やスタイルに触れず、JSON の記述だけを渡す。ホストはこのファイルで記述を検証して、
 * 知っている項目だけを取り出した新しいオブジェクトを作り直し、Svelte のテンプレート(ScriptUi.svelte)で描画する。
 * 文字は常にテキストとして描画する({@html} は使わない)ので、HTML や <script> を入れても文字として表示されるだけ。
 * リンクは https の URL だけ。どれか 1 つでも不正なら、記述全体を受け付けない。
 */
import { SCRIPT_LIMITS } from './limits';

export const UI_TEXT_TONES = ['normal', 'muted', 'warning', 'error'] as const;
export type UiTextTone = (typeof UI_TEXT_TONES)[number];
export const UI_BUTTON_VARIANTS = ['primary', 'secondary', 'danger'] as const;
export type UiButtonVariant = (typeof UI_BUTTON_VARIANTS)[number];

export interface UiOption {
	value: string;
	label: string;
}

export type UiNode =
	| { type: 'heading'; text: string }
	| { type: 'text'; text: string; tone: UiTextTone }
	| {
			type: 'button';
			id: string;
			label: string;
			variant: UiButtonVariant;
			disabled: boolean;
	  }
	| {
			type: 'toggle';
			id: string;
			label: string;
			value: boolean;
			description: string;
			disabled: boolean;
	  }
	| {
			type: 'input';
			id: string;
			label: string;
			value: string;
			placeholder: string;
			secret: boolean;
			description: string;
			disabled: boolean;
	  }
	| {
			type: 'select';
			id: string;
			label: string;
			value: string;
			options: UiOption[];
			description: string;
			disabled: boolean;
	  }
	| { type: 'list'; items: { text: string; detail: string }[] }
	| { type: 'progress'; value: number; label: string }
	| { type: 'divider' }
	| { type: 'link'; label: string; url: string };

/** ui.set で渡す 1 画面分(ポップアップ、または設定欄) */
export interface UiTree {
	nodes: UiNode[];
	/** ツールバーのアイコンにドットを出すか(ポップアップのときだけ使う) */
	badge: boolean;
}

export type UiValidation = { ok: true; tree: UiTree } | { ok: false; error: string };

const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 制御文字(改行とタブは除く)を含むか */
function hasControl(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if ((c <= 0x1f && c !== 0x0a && c !== 0x09) || (c >= 0x7f && c <= 0x9f)) return true;
	}
	return false;
}

/** https の URL だけ(認証情報・長すぎる URL は不可)。正規化した文字列を返す */
export function normalizeHttpsUrl(value: unknown): string | null {
	if (typeof value !== 'string' || value.length === 0 || value.length > SCRIPT_LIMITS.uiUrlLength)
		return null;
	if (hasControl(value) || /\s/.test(value)) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
		return url.href;
	} catch {
		return null;
	}
}

class Fail extends Error {}

function str(value: unknown, max: number, what: string, required = false): string {
	if (value === undefined && !required) return '';
	if (typeof value !== 'string') throw new Fail(`${what} は文字列で指定してください`);
	if (value.length > max) throw new Fail(`${what} は ${max} 文字までです`);
	if (hasControl(value)) throw new Fail(`${what} に使えない文字があります`);
	return value;
}

function bool(value: unknown, what: string, fallback = false): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean') throw new Fail(`${what} は true / false で指定してください`);
	return value;
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	what: string,
	fallback: T
): T {
	if (value === undefined) return fallback;
	if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
		return value as T;
	throw new Fail(`${what} は ${allowed.join(' / ')} のいずれかです`);
}

function ident(value: unknown, seen: Set<string>): string {
	if (
		typeof value !== 'string' ||
		!ID_PATTERN.test(value) ||
		value.length > SCRIPT_LIMITS.uiIdLength
	)
		throw new Fail(
			`id は英数字・ハイフン・アンダースコア・ピリオドで指定してください(${SCRIPT_LIMITS.uiIdLength} 文字まで)`
		);
	if (seen.has(value)) throw new Fail(`id「${value}」が重複しています`);
	seen.add(value);
	return value;
}

function parseNode(raw: unknown, seen: Set<string>): UiNode {
	if (!isRecord(raw)) throw new Fail('要素はオブジェクトで指定してください');
	const L = SCRIPT_LIMITS;
	switch (raw.type) {
		case 'heading':
			return { type: 'heading', text: str(raw.text, L.uiLabelLength, 'heading.text', true) };
		case 'text':
			return {
				type: 'text',
				text: str(raw.text, L.uiTextLength, 'text.text', true),
				tone: oneOf(raw.tone, UI_TEXT_TONES, 'text.tone', 'normal')
			};
		case 'button':
			return {
				type: 'button',
				id: ident(raw.id, seen),
				label: str(raw.label, L.uiLabelLength, 'button.label', true),
				variant: oneOf(raw.variant, UI_BUTTON_VARIANTS, 'button.variant', 'secondary'),
				disabled: bool(raw.disabled, 'button.disabled')
			};
		case 'toggle':
			return {
				type: 'toggle',
				id: ident(raw.id, seen),
				label: str(raw.label, L.uiLabelLength, 'toggle.label', true),
				value: bool(raw.value, 'toggle.value'),
				description: str(raw.description, L.uiTextLength, 'toggle.description'),
				disabled: bool(raw.disabled, 'toggle.disabled')
			};
		case 'input':
			return {
				type: 'input',
				id: ident(raw.id, seen),
				label: str(raw.label, L.uiLabelLength, 'input.label', true),
				value: str(raw.value, L.uiInputLength, 'input.value'),
				placeholder: str(raw.placeholder, L.uiLabelLength, 'input.placeholder'),
				secret: bool(raw.secret, 'input.secret'),
				description: str(raw.description, L.uiTextLength, 'input.description'),
				disabled: bool(raw.disabled, 'input.disabled')
			};
		case 'select': {
			if (!Array.isArray(raw.options) || raw.options.length === 0)
				throw new Fail('select.options は 1 つ以上の配列で指定してください');
			if (raw.options.length > L.uiSelectOptions)
				throw new Fail(`select.options は ${L.uiSelectOptions} 個までです`);
			const options = raw.options.map((o: unknown) => {
				if (!isRecord(o)) throw new Fail('select.options の要素はオブジェクトで指定してください');
				return {
					value: str(o.value, L.uiLabelLength, 'option.value', true),
					label: str(o.label, L.uiLabelLength, 'option.label', true)
				};
			});
			return {
				type: 'select',
				id: ident(raw.id, seen),
				label: str(raw.label, L.uiLabelLength, 'select.label', true),
				value: str(raw.value, L.uiLabelLength, 'select.value'),
				options,
				description: str(raw.description, L.uiTextLength, 'select.description'),
				disabled: bool(raw.disabled, 'select.disabled')
			};
		}
		case 'list': {
			if (!Array.isArray(raw.items)) throw new Fail('list.items は配列で指定してください');
			if (raw.items.length > L.uiListItems)
				throw new Fail(`list.items は ${L.uiListItems} 個までです`);
			return {
				type: 'list',
				items: raw.items.map((item: unknown) => {
					if (typeof item === 'string')
						return { text: str(item, L.uiLabelLength, 'list.items', true), detail: '' };
					if (!isRecord(item)) throw new Fail('list.items の要素は文字列かオブジェクトです');
					return {
						text: str(item.text, L.uiLabelLength, 'list.items.text', true),
						detail: str(item.detail, L.uiLabelLength, 'list.items.detail')
					};
				})
			};
		}
		case 'progress': {
			if (typeof raw.value !== 'number' || !Number.isFinite(raw.value))
				throw new Fail('progress.value は 0 〜 1 の数値で指定してください');
			return {
				type: 'progress',
				value: Math.min(1, Math.max(0, raw.value)),
				label: str(raw.label, L.uiLabelLength, 'progress.label')
			};
		}
		case 'divider':
			return { type: 'divider' };
		case 'link': {
			const url = normalizeHttpsUrl(raw.url);
			if (!url) throw new Fail('link.url は https:// の URL だけ指定できます');
			return { type: 'link', label: str(raw.label, L.uiLabelLength, 'link.label', true), url };
		}
		default:
			throw new Fail(`使えない要素の種類です: ${String(raw.type).slice(0, 30)}`);
	}
}

/**
 * ui.set の引数({ nodes, badge? })を検証して、描画できる形にする。
 * 要素の個数・文字数の上限を超える、知らない種類の要素がある、リンクが https でない、id が重複する、のどれかなら失敗
 */
export function validateUi(input: unknown): UiValidation {
	if (!isRecord(input) || !Array.isArray(input.nodes)) {
		return { ok: false, error: 'nodes は要素の配列で指定してください' };
	}
	if (input.nodes.length > SCRIPT_LIMITS.uiNodes) {
		return { ok: false, error: `要素は ${SCRIPT_LIMITS.uiNodes} 個までです` };
	}
	try {
		const seen = new Set<string>();
		const nodes = input.nodes.map((raw: unknown) => parseNode(raw, seen));
		return { ok: true, tree: { nodes, badge: bool(input.badge, 'badge') } };
	} catch (error) {
		if (error instanceof Fail) return { ok: false, error: error.message };
		throw error;
	}
}

/** 画面のイベント(ホスト → スクリプト) */
export type UiEventKind = 'press' | 'change';

/** 描画側で、操作の値が記述と合っているか確かめる(存在する id・種類・選択肢だけ通す) */
export function checkUiEvent(
	tree: UiTree | null,
	id: string,
	kind: UiEventKind,
	value: unknown
): value is string | boolean | undefined {
	const node = tree?.nodes.find((n) => 'id' in n && n.id === id);
	if (!node) return false;
	if (kind === 'press') return node.type === 'button' && value === undefined;
	if (node.type === 'toggle') return typeof value === 'boolean';
	if (node.type === 'input')
		return typeof value === 'string' && value.length <= SCRIPT_LIMITS.uiInputLength;
	if (node.type === 'select')
		return typeof value === 'string' && node.options.some((o) => o.value === value);
	return false;
}
