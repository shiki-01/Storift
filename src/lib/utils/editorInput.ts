/**
 * エディタ(contenteditable)向けの入力補助
 * - 補助バーからの記号・ルビ挿入
 * - タイプライタースクロール
 * - フォーカスモードの「今の段落以外を薄く」
 */

import { symbolInsertion, type SymbolItem } from './symbols';

export type InsertKind =
	| 'kagi'
	| 'nijukagi'
	| 'paren'
	| 'ellipsis'
	| 'dash'
	| 'ruby'
	| 'bouten'
	| 'indent';

export interface Insertion {
	text: string;
	/** 挿入後にカーソルを戻す文字数 */
	caretBack: number;
}

/** 選択中の文字列(空可)から、挿入するテキストとカーソルの戻し量を求める */
export function buildInsertion(kind: InsertKind, selected = ''): Insertion {
	const has = selected.length > 0;
	switch (kind) {
		case 'kagi':
			return { text: `「${selected}」`, caretBack: has ? 0 : 1 };
		case 'nijukagi':
			return { text: `『${selected}』`, caretBack: has ? 0 : 1 };
		case 'paren':
			return { text: `（${selected}）`, caretBack: has ? 0 : 1 };
		case 'ellipsis':
			return { text: '……', caretBack: 0 };
		case 'dash':
			return { text: '――', caretBack: 0 };
		case 'ruby':
			// 親文字を選択していれば｜親《》、無ければ｜《》。ルビ入力位置へカーソルを置く
			return has ? { text: `｜${selected}《》`, caretBack: 1 } : { text: '｜《》', caretBack: 2 };
		case 'bouten':
			return has
				? { text: `《《${selected}》》`, caretBack: 0 }
				: { text: '《《》》', caretBack: 2 };
		case 'indent':
			return { text: '　', caretBack: 0 };
	}
}

/** 段落の先頭に全角スペースを入れる(空行・字下げ済み・「『（【〈《 で始まる行はそのまま) */
export function indentParagraphs(text: string): string {
	return text
		.split('\n')
		.map((line) => {
			if (line.trim() === '') return line;
			if (line.startsWith('　') || line.startsWith(' ')) return line;
			if (/^[「『（【〈《]/.test(line)) return line;
			return '　' + line;
		})
		.join('\n');
}

/** 選択範囲を置き換える形で補助入力を挿入する(ブラウザのUndo履歴に残る) */
export function applyInsertion(kind: InsertKind): void {
	const selection = window.getSelection();
	const selected = selection ? selection.toString() : '';
	const { text, caretBack } = buildInsertion(kind, selected);
	document.execCommand('insertText', false, text);
	moveCaret(-caretBack);
}

/** 任意の文字列を、選択範囲を置き換える形で挿入する(パックの入力補助キー用。caretBack は挿入後に左へ戻す文字数) */
export function insertText(text: string, caretBack = 0): void {
	document.execCommand('insertText', false, text);
	moveCaret(-caretBack);
}

/** カーソルを文字単位で動かす(負:左 / 正:右) */
export function moveCaret(delta: number): void {
	const selection = window.getSelection() as
		| (Selection & {
				modify?: (alter: string, direction: string, granularity: string) => void;
		  })
		| null;
	if (!selection || !selection.modify || delta === 0) return;
	const direction = delta < 0 ? 'backward' : 'forward';
	for (let i = 0; i < Math.abs(delta); i++) {
		selection.modify('move', direction, 'character');
	}
}

/**
 * 元に戻す/やり直すの差し替え。共同編集のシーンでは、ブラウザ標準の履歴の代わりに
 * 自分の編集だけを対象にした履歴(Y.UndoManager)を使う。null なら標準の動作。
 */
export interface HistoryHandler {
	undo(): void;
	redo(): void;
}

let historyHandler: HistoryHandler | null = null;

export function setHistoryHandler(handler: HistoryHandler | null): void {
	historyHandler = handler;
}

export function undo(): void {
	if (historyHandler) historyHandler.undo();
	else document.execCommand('undo');
}

export function redo(): void {
	if (historyHandler) historyHandler.redo();
	else document.execCommand('redo');
}

/** カーソル位置の矩形(取得できなければ null) */
export function getCaretRect(): DOMRect | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0).cloneRange();
	range.collapse(true);
	const rects = range.getClientRects();
	if (rects.length > 0) return rects[0];
	const rect = range.getBoundingClientRect();
	if (rect.height > 0) return rect;
	// 空行などで矩形が取れない場合は、カーソルの隣のノード(改行の <br> など)の位置で代用する。
	// 親要素(エディタ全体)の矩形で代用すると、本文の末尾までスクロールしてしまうので使わない
	const node = range.startContainer;
	if (node.nodeType === Node.ELEMENT_NODE) {
		const children = node.childNodes;
		const offset = range.startOffset;
		for (const candidate of [children[offset], children[offset - 1]]) {
			const box = nodeRect(candidate);
			if (box) return box;
		}
		return null;
	}
	const parent = node.parentElement;
	if (!parent || parent.isContentEditable === false) return null;
	if (parent.getAttribute('contenteditable') === 'true') return null;
	const box = parent.getBoundingClientRect();
	return box.height > 0 ? box : null;
}

/** 1 行ぶんの高さに収まるノードの矩形(取れなければ null) */
function nodeRect(node: Node | undefined): DOMRect | null {
	if (!node) return null;
	const r = document.createRange();
	r.selectNode(node);
	const rects = r.getClientRects();
	const box = rects.length > 0 ? rects[0] : r.getBoundingClientRect();
	if (box.height <= 0) return null;
	// 段落の要素など、複数行にまたがる大きな矩形は位置の代用にならない
	if (node.nodeType === Node.ELEMENT_NODE && node.nodeName !== 'BR' && box.height > 64) return null;
	return box;
}

/**
 * カーソルのある行を、可視領域の一定の高さ(既定: 上から40%)に保つ。
 * 上端より上にある、または下端付近のときだけ動かし、細かな揺れは無視する。
 * topInset は、スクロール領域の上端に重なって本文を隠すもの(スマホの上部バーなど)の高さ(px)。
 * 可視領域はその下端から始まるものとして扱う。
 */
export function typewriterScroll(container: HTMLElement, ratio = 0.4, topInset = 0): void {
	const caret = getCaretRect();
	if (!caret) return;
	const box = container.getBoundingClientRect();
	if (caret.height > box.height / 2) return;
	const inset = Math.max(0, topInset);
	const target = box.top + inset + (box.height - inset) * ratio;
	const delta = caret.top + caret.height / 2 - target;
	if (Math.abs(delta) < 6) return;
	container.scrollTop += delta;
}

/**
 * カーソルが可視領域の外(キーボードの陰や、上端に重なる上部バーの裏を含む)に出ないよう最小限だけ動かす。
 * topInset は、スクロール領域の上端に重なって本文を隠すものの高さ(px)。
 */
export function ensureCaretVisible(container: HTMLElement, margin = 28, topInset = 0): void {
	const caret = getCaretRect();
	if (!caret) return;
	const box = container.getBoundingClientRect();
	// 1 行より大きな矩形は、カーソルの位置を取り違えている(大きく飛ばさない)
	if (caret.height > box.height / 2) return;
	const top = box.top + Math.max(0, topInset);
	if (caret.bottom > box.bottom - margin) {
		container.scrollTop += caret.bottom - (box.bottom - margin);
	} else if (caret.top < top + margin) {
		container.scrollTop -= top + margin - caret.top;
	}
}

/** 今のカーソルがある段落(改行区切り)の範囲を除いた、前後2つの範囲を返す */
export function rangesOutsideCurrentParagraph(root: HTMLElement): Range[] {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return [];
	const anchor = selection.anchorNode;
	if (!anchor || !root.contains(anchor)) return [];

	// anchor を root 直下の子まで辿る
	let node: Node = anchor;
	while (node.parentNode && node.parentNode !== root) node = node.parentNode;
	if (node.parentNode !== root) return [];

	const isBreak = (n: Node | null) => !!n && (n.nodeName === 'BR' || n.nodeName === 'DIV');

	let first: Node = node;
	let last: Node = node;
	if (!isBreak(node)) {
		while (first.previousSibling && !isBreak(first.previousSibling)) first = first.previousSibling;
		while (last.nextSibling && !isBreak(last.nextSibling)) last = last.nextSibling;
	}

	const ranges: Range[] = [];
	const before = document.createRange();
	before.setStart(root, 0);
	before.setEndBefore(first);
	if (!before.collapsed) ranges.push(before);

	const after = document.createRange();
	after.setStartAfter(last);
	after.setEnd(root, root.childNodes.length);
	if (!after.collapsed) ranges.push(after);

	return ranges;
}

/** CSS Custom Highlight API が使えるか */
export function supportsHighlight(): boolean {
	return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

const DIM_NAME = 'storift-dim';

/** 今の段落以外を薄く表示する。off のとき・非対応のときは解除する */
export function updateDimHighlight(root: HTMLElement | null, enabled: boolean): void {
	if (!supportsHighlight()) return;
	const highlights = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
	if (!enabled || !root) {
		highlights.delete(DIM_NAME);
		return;
	}
	const ranges = rangesOutsideCurrentParagraph(root);
	highlights.set(DIM_NAME, new Highlight(...ranges));
}

/**
 * 本文(改行を含む文字列)上の位置 [start, end) を、contenteditable 内の Range にする。
 * <br> と 2 つ目以降の <div> は改行 1 文字として数える(innerText と同じ数え方)。
 * 見つからなければ null。
 */
export function textRange(root: HTMLElement, start: number, end: number): Range | null {
	let count = 0;
	let startPos: { node: Node; offset: number } | null = null;
	let endPos: { node: Node; offset: number } | null = null;

	const visit = (node: Node, isFirstChild: boolean): void => {
		if (endPos) return;
		if (node.nodeType === Node.TEXT_NODE) {
			const length = node.textContent?.length ?? 0;
			if (!startPos && start <= count + length) startPos = { node, offset: start - count };
			if (startPos && end <= count + length) endPos = { node, offset: end - count };
			count += length;
			return;
		}
		if (node.nodeName === 'BR') {
			count += 1;
			return;
		}
		if (node.nodeName === 'DIV' && !isFirstChild) count += 1;
		node.childNodes.forEach((child, i) => visit(child, i === 0));
	};
	root.childNodes.forEach((child, i) => visit(child, i === 0));

	if (!startPos || !endPos) return null;
	const range = document.createRange();
	const s = startPos as { node: Node; offset: number };
	const e = endPos as { node: Node; offset: number };
	range.setStart(s.node, s.offset);
	range.setEnd(e.node, e.offset);
	return range;
}

/**
 * 本文上の位置 [start, end) を、contenteditable 内の選択範囲にする。見つからなければ false。
 */
export function selectTextRange(root: HTMLElement, start: number, end: number): boolean {
	const range = textRange(root, start, end);
	const selection = window.getSelection();
	if (!range || !selection) return false;
	selection.removeAllRanges();
	selection.addRange(range);
	return true;
}

/** スクロールできる一番近い祖先(なければ null) */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
	for (let node = el?.parentElement; node; node = node.parentElement) {
		const { overflowY, overflowX } = getComputedStyle(node);
		if (/(auto|scroll)/.test(overflowY + overflowX)) return node;
	}
	return null;
}

/**
 * 本文の範囲がスクロール領域の中央に来るようにスクロールする。
 * 本文は 1 つの大きな要素なので scrollIntoView ではなく、範囲の位置から移動量を求める。
 */
export function scrollRangeIntoView(root: HTMLElement, range: Range): void {
	const container = scrollParent(root);
	if (!container) return;
	const rect = range.getBoundingClientRect();
	const box = container.getBoundingClientRect();
	container.scrollBy({
		top: rect.top + rect.height / 2 - (box.top + box.height / 2),
		left: rect.left + rect.width / 2 - (box.left + box.width / 2),
		behavior: 'smooth'
	});
}

/** 記号パレットの記号を、選択範囲を置き換える(括弧なら囲む)形で挿入する */
export function insertSymbol(item: SymbolItem): void {
	const selection = window.getSelection();
	const selected = selection ? selection.toString() : '';
	const { text, caretBack } = symbolInsertion(item, selected);
	document.execCommand('insertText', false, text);
	moveCaret(-caretBack);
}
