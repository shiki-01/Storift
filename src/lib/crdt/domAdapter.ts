import { rangeTextOffsets, textOffsetAt } from '$lib/utils/memos';
import { selectTextRange } from '$lib/utils/editorInput';
import type { EditorAdapter } from './editorBinding';

/**
 * contenteditable 用のアダプタ。本文は innerText、位置は innerText の文字インデックス
 * (<br> と 2 つ目以降の <div> は改行 1 文字。既存の editorInput / memos と同じ数え方)。
 * 表示の切り替え(プレビューのみ)で DOM が作り直されるため、root は付け替えられる。
 */
export interface DomEditorAdapter extends EditorAdapter {
	setRoot(root: HTMLElement | null): void;
	/** 画面上の点に対応する本文のインデックス(ドロップ位置用)。分からなければ null */
	indexFromPoint(x: number, y: number): number | null;
}

export function createDomAdapter(): DomEditorAdapter {
	let root: HTMLElement | null = null;

	return {
		setRoot(next) {
			root = next;
		},
		isAttached: () => root !== null,
		getText: () => root?.innerText ?? '',
		setText(text) {
			if (!root) return;
			root.innerText = text;
		},
		getSelection() {
			if (!root) return null;
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
			return rangeTextOffsets(root, range);
		},
		setSelection(start, end) {
			if (!root) return;
			const selection = window.getSelection();
			if (!selection) return;
			if (selectTextRange(root, start, end)) return;
			// 空の本文や、位置が見つからないとき: 末尾に置く
			const range = document.createRange();
			range.selectNodeContents(root);
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
		},
		indexFromPoint(x, y) {
			if (!root) return null;
			let node: Node | null = null;
			let offset = 0;
			const doc = document as Document & {
				caretPositionFromPoint?: (
					x: number,
					y: number
				) => { offsetNode: Node; offset: number } | null;
			};
			if (doc.caretPositionFromPoint) {
				const position = doc.caretPositionFromPoint(x, y);
				if (position) {
					node = position.offsetNode;
					offset = position.offset;
				}
			} else if (document.caretRangeFromPoint) {
				const range = document.caretRangeFromPoint(x, y);
				if (range) {
					node = range.startContainer;
					offset = range.startOffset;
				}
			}
			if (!node || !root.contains(node)) return null;
			return textOffsetAt(root, node, offset);
		}
	};
}
