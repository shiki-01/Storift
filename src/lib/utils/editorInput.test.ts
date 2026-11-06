import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildInsertion, redo, setHistoryHandler, undo } from './editorInput';

describe('buildInsertion', () => {
	it('かぎ括弧は未選択ならカーソルを括弧の間に置く', () => {
		expect(buildInsertion('kagi')).toEqual({ text: '「」', caretBack: 1 });
	});

	it('かぎ括弧は選択中の文字を囲み、カーソルは末尾に置く', () => {
		expect(buildInsertion('kagi', 'こんにちは')).toEqual({ text: '「こんにちは」', caretBack: 0 });
	});

	it('二重かぎ括弧・丸括弧も同様', () => {
		expect(buildInsertion('nijukagi')).toEqual({ text: '『』', caretBack: 1 });
		expect(buildInsertion('paren', 'a')).toEqual({ text: '（a）', caretBack: 0 });
	});

	it('ルビは親文字を選択していれば｜親《》にしてルビ入力位置へ戻す', () => {
		expect(buildInsertion('ruby', '漢字')).toEqual({ text: '｜漢字《》', caretBack: 1 });
		expect(buildInsertion('ruby')).toEqual({ text: '｜《》', caretBack: 2 });
	});

	it('傍点は《《》》で囲む', () => {
		expect(buildInsertion('bouten', '強調')).toEqual({ text: '《《強調》》', caretBack: 0 });
		expect(buildInsertion('bouten')).toEqual({ text: '《《》》', caretBack: 2 });
	});

	it('三点リーダー・ダッシュ・字下げは固定文字', () => {
		expect(buildInsertion('ellipsis').text).toBe('……');
		expect(buildInsertion('dash').text).toBe('――');
		expect(buildInsertion('indent').text).toBe('　');
	});
});

import { selectTextRange } from './editorInput';

describe('selectTextRange', () => {
	it('改行(<br>)をまたいだ位置を選択範囲にできる', () => {
		const root = document.createElement('div');
		root.contentEditable = 'true';
		root.innerHTML = 'あいう<br>えおか';
		document.body.appendChild(root);
		// 本文は「あいう\nえおか」。3文字目の改行の次から2文字 = 「えお」
		expect(selectTextRange(root, 4, 6)).toBe(true);
		expect(window.getSelection()?.toString()).toBe('えお');
		root.remove();
	});

	it('範囲外の位置は false を返す', () => {
		const root = document.createElement('div');
		root.textContent = 'abc';
		document.body.appendChild(root);
		expect(selectTextRange(root, 10, 12)).toBe(false);
		root.remove();
	});
});

describe('元に戻す/やり直す(共同編集用の差し替え)', () => {
	afterEach(() => {
		setHistoryHandler(null);
		vi.restoreAllMocks();
	});

	it('ハンドラを登録すると、標準の履歴(execCommand)ではなくそちらを呼ぶ', () => {
		const exec = vi.fn(() => true);
		document.execCommand = exec;
		const handler = { undo: vi.fn(), redo: vi.fn() };
		setHistoryHandler(handler);
		undo();
		redo();
		expect(handler.undo).toHaveBeenCalledOnce();
		expect(handler.redo).toHaveBeenCalledOnce();
		expect(exec).not.toHaveBeenCalled();
	});

	it('解除すれば従来どおり execCommand', () => {
		const exec = vi.fn(() => true);
		document.execCommand = exec;
		setHistoryHandler({ undo: vi.fn(), redo: vi.fn() });
		setHistoryHandler(null);
		undo();
		redo();
		expect(exec).toHaveBeenCalledWith('undo');
		expect(exec).toHaveBeenCalledWith('redo');
	});
});
