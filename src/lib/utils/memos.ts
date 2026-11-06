/**
 * メモの純粋な処理(タグ・範囲の再アンカー・絞り込み・AI への依頼文)と、
 * 旧 localStorage 形式からの移行変換。永続化は $lib/db/memos.ts が担当する。
 */
import type { Memo, MemoAnchor } from '$lib/types';

/** 既定のタグ(候補として常に出す) */
export const DEFAULT_MEMO_TAGS = ['todo', 'アイデア', '伏線', '要確認'];
/** AI への依頼の対象になるタグ */
export const TODO_TAG = 'todo';
/** 範囲メモの引用として保存する最大文字数 */
export const MEMO_QUOTE_MAX = 200;
/** 再アンカーで「元の位置の付近」とみなす距離(文字数) */
const NEAR_RANGE = 500;

const LEGACY_PREFIX = 'storift:memos:';

/** 旧形式(localStorage の 1 件)。範囲もタグも持たない */
interface LegacyMemo {
	id: string;
	text: string;
	createdAt: number;
}

export function legacyStorageKey(projectId: string): string {
	return `${LEGACY_PREFIX}${projectId}`;
}

/** localStorage のキーが旧メモのものなら、作品 ID を返す。違えば null */
export function legacyProjectId(key: string): string | null {
	if (!key.startsWith(LEGACY_PREFIX)) return null;
	const id = key.slice(LEGACY_PREFIX.length);
	return id || null;
}

/**
 * 旧形式の JSON 配列を Memo に変換する。壊れた要素は捨て、本文の #タグ だけをタグにする。
 * 旧メモは id を引き継ぐので、途中で止まって再実行しても重複しない。
 */
export function parseLegacyMemos(raw: string, projectId: string, now = Date.now()): Memo[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const memos: Memo[] = [];
	for (const item of parsed) {
		if (!isLegacyMemo(item)) continue;
		const createdAt = Number.isFinite(item.createdAt) ? item.createdAt : now;
		memos.push({
			id: item.id,
			projectId,
			text: item.text,
			tags: mergeTags([], item.text),
			done: false,
			createdAt,
			updatedAt: createdAt
		});
	}
	return memos;
}

function isLegacyMemo(value: unknown): value is LegacyMemo {
	const m = value as LegacyMemo;
	return !!m && typeof m.id === 'string' && typeof m.text === 'string' && m.text.trim() !== '';
}

/** タグを整える(前後の空白と先頭の # を除き、小文字にする)。空なら '' */
export function normalizeTag(raw: string): string {
	return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

/**
 * 本文中の #タグ を抜き出す。直前が ASCII の英数字・記号なら対象外(「C#」「a#b」「URL の #」を除く)。
 * 日本語の助詞の直後(「今日は#伏線」)は対象にする。
 */
export function extractTags(text: string): string[] {
	return [...text.matchAll(/(?<![A-Za-z0-9_&/#])#([\p{L}\p{N}_-]+)/gu)].map((m) =>
		normalizeTag(m[1])
	);
}

/** 手入力のタグと本文の #タグ をまとめる(空と重複を除く) */
export function mergeTags(manual: string[], text: string): string[] {
	const out: string[] = [];
	for (const raw of [...manual, ...extractTags(text)]) {
		const tag = normalizeTag(raw);
		if (tag && !out.includes(tag)) out.push(tag);
	}
	return out;
}

/** 本文の [start, end) から範囲を作る。引用は先頭 200 文字まで */
export function makeAnchor(content: string, start: number, end: number): MemoAnchor {
	const from = Math.max(0, Math.min(start, end));
	const to = Math.min(content.length, Math.max(start, end));
	return { start: from, end: to, quote: content.slice(from, to).slice(0, MEMO_QUOTE_MAX) };
}

/**
 * 範囲を現在の本文に合わせ直す。
 * 元の start の位置に引用があればそのまま使い、無ければ元の位置の付近(NEAR_RANGE 文字以内)で
 * いちばん近い一致、さらに無ければ全文の最初の一致を使う。どれも無ければ null(位置不明)。
 */
export function resolveAnchor(
	text: string,
	anchor: MemoAnchor
): { start: number; end: number } | null {
	const { quote } = anchor;
	if (!quote) return null;
	// 引用は 200 文字までに切ってあるので、範囲の長さは元の選択の長さを使う
	const length = Math.max(anchor.end - anchor.start, quote.length);
	const span = (at: number) => ({ start: at, end: Math.min(text.length, at + length) });

	if (text.startsWith(quote, anchor.start)) return span(anchor.start);

	const hits = findAll(text, quote);
	if (hits.length === 0) return null;
	const distance = (at: number) => Math.abs(at - anchor.start);
	const near = hits
		.filter((at) => distance(at) <= NEAR_RANGE)
		.sort((a, b) => distance(a) - distance(b));
	return span(near[0] ?? hits[0]);
}

/**
 * 本文の変更(他者の編集など)のあと、範囲メモの位置を現在の本文に合わせ直す。
 * resolveAnchor で見つかり、かつ位置が変わったものだけ新しい範囲を返す。
 * 見つからないメモ(位置不明)は何も返さない: 既存の「孤立」表示のままにし、範囲は書き換えない。
 */
export function reanchorMemos(
	text: string,
	memos: Pick<Memo, 'id' | 'anchor'>[]
): { id: string; anchor: MemoAnchor }[] {
	const updates: { id: string; anchor: MemoAnchor }[] = [];
	for (const memo of memos) {
		if (!memo.anchor) continue;
		const span = resolveAnchor(text, memo.anchor);
		if (!span) continue;
		if (span.start === memo.anchor.start && span.end === memo.anchor.end) continue;
		updates.push({ id: memo.id, anchor: { ...memo.anchor, start: span.start, end: span.end } });
	}
	return updates;
}

function findAll(text: string, needle: string): number[] {
	const out: number[] = [];
	let at = text.indexOf(needle);
	while (at !== -1) {
		out.push(at);
		at = text.indexOf(needle, at + 1);
	}
	return out;
}

/**
 * 本文の DOM 上の点(container の offset 番目)を、本文の文字オフセットにする。
 * 数え方は $lib/utils/editorInput の textRange と揃える(<br> と 2 つ目以降の <div> は改行 1 文字)。
 * root の外の点なら null。
 */
export function textOffsetAt(root: Node, container: Node, offset: number): number | null {
	let count = 0;
	let found: number | null = null;

	const walkChildren = (node: Node): void => {
		const children = node.childNodes;
		for (let i = 0; i < children.length && found === null; i++) {
			if (node === container && i === offset) {
				found = count;
				return;
			}
			visit(children[i], i === 0);
		}
		if (found === null && node === container) found = count;
	};

	const visit = (node: Node, isFirstChild: boolean): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			if (node === container) found = count + offset;
			else count += node.textContent?.length ?? 0;
			return;
		}
		if (node.nodeName === 'BR') {
			if (node === container) found = count + (offset > 0 ? 1 : 0);
			else count += 1;
			return;
		}
		if (node.nodeName === 'DIV' && !isFirstChild) count += 1;
		walkChildren(node);
	};

	walkChildren(root);
	return found;
}

/** 選択範囲を本文の文字オフセット [start, end) にする。root の外なら null */
export function rangeTextOffsets(root: Node, range: Range): { start: number; end: number } | null {
	const start = textOffsetAt(root, range.startContainer, range.startOffset);
	const end = textOffsetAt(root, range.endContainer, range.endOffset);
	if (start === null || end === null) return null;
	return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** 未完了の TODO か */
export function isOpenTodo(memo: Memo): boolean {
	return memo.tags.includes(TODO_TAG) && !memo.done;
}

export interface TodoEntry {
	text: string;
	sceneTitle?: string;
	quote?: string;
}

const TODO_LEAD =
	'以下の TODO を順に対応してください。本文の修正が必要なものは編集提案として出してください。対応した項目は番号で報告してください。';

/** AI に送る TODO の依頼文。番号付きで、シーン名と本文の引用を添える */
export function buildTodoPrompt(entries: TodoEntry[]): string {
	const items = entries.map((entry, i) => {
		const [first, ...rest] = entry.text.trim().split('\n');
		const lines = [`${i + 1}. ${first}`, ...rest.map((line) => `   ${line}`)];
		if (entry.sceneTitle) lines.push(`   - シーン: ${entry.sceneTitle}`);
		if (entry.quote) lines.push(`   - 本文の引用: 「${entry.quote.replace(/\s+/g, ' ')}」`);
		return lines.join('\n');
	});
	return `${TODO_LEAD}\n\n${items.join('\n')}`;
}

export interface MemoFilter {
	/** scene: 指定したシーンのメモだけ / all: 作品のすべて */
	scope: 'scene' | 'all';
	sceneId?: string | null;
	tag?: string | null;
	query?: string;
	/** 未完了のものだけ */
	openOnly?: boolean;
}

/** 新しいメモを先頭にして、条件で絞り込む */
export function filterMemos(memos: Memo[], filter: MemoFilter): Memo[] {
	const q = (filter.query ?? '').trim().toLowerCase();
	return [...memos]
		.sort((a, b) => b.createdAt - a.createdAt)
		.filter((m) => {
			if (filter.scope === 'scene' && (!filter.sceneId || m.sceneId !== filter.sceneId)) {
				return false;
			}
			if (filter.tag && !m.tags.includes(filter.tag)) return false;
			if (filter.openOnly && m.done) return false;
			if (q) {
				const hit =
					m.text.toLowerCase().includes(q) ||
					(m.anchor?.quote.toLowerCase().includes(q) ?? false) ||
					m.tags.some((t) => t.includes(q));
				if (!hit) return false;
			}
			return true;
		});
}
