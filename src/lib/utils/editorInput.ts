/**
 * エディタ(contenteditable)向けの入力補助
 * - 補助バーからの記号・ルビ挿入
 * - タイプライタースクロール
 * - フォーカスモードの「今の段落以外を薄く」
 */

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

/** 選択範囲を置き換える形で補助入力を挿入する(ブラウザのUndo履歴に残る) */
export function applyInsertion(kind: InsertKind): void {
	const selection = window.getSelection();
	const selected = selection ? selection.toString() : '';
	const { text, caretBack } = buildInsertion(kind, selected);
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

export function undo(): void {
	document.execCommand('undo');
}

export function redo(): void {
	document.execCommand('redo');
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
	// 空行などで矩形が取れない場合は親要素で代用
	const node = range.startContainer;
	const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
	return el ? el.getBoundingClientRect() : null;
}

/**
 * カーソルのある行を、スクロール領域の一定の高さ(既定: 上から40%)に保つ。
 * 上端より上にある、または下端付近のときだけ動かし、細かな揺れは無視する。
 */
export function typewriterScroll(container: HTMLElement, ratio = 0.4): void {
	const caret = getCaretRect();
	if (!caret) return;
	const box = container.getBoundingClientRect();
	const target = box.top + box.height * ratio;
	const delta = caret.top + caret.height / 2 - target;
	if (Math.abs(delta) < 6) return;
	container.scrollTop += delta;
}

/** カーソルがスクロール領域の外(キーボードの陰を含む)に出ないよう最小限だけ動かす */
export function ensureCaretVisible(container: HTMLElement, margin = 28): void {
	const caret = getCaretRect();
	if (!caret) return;
	const box = container.getBoundingClientRect();
	if (caret.bottom > box.bottom - margin) {
		container.scrollTop += caret.bottom - (box.bottom - margin);
	} else if (caret.top < box.top + margin) {
		container.scrollTop -= box.top + margin - caret.top;
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
 * 本文(改行を含む文字列)上の位置 [start, end) を、contenteditable 内の選択範囲にする。
 * <br> と 2 つ目以降の <div> は改行 1 文字として数える(innerText と同じ数え方)。
 * 見つからなければ false。
 */
export function selectTextRange(root: HTMLElement, start: number, end: number): boolean {
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

	if (!startPos || !endPos) return false;
	const selection = window.getSelection();
	if (!selection) return false;
	const range = document.createRange();
	const s = startPos as { node: Node; offset: number };
	const e = endPos as { node: Node; offset: number };
	range.setStart(s.node, s.offset);
	range.setEnd(e.node, e.offset);
	selection.removeAllRanges();
	selection.addRange(range);
	return true;
}
