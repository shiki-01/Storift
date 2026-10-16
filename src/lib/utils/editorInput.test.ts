import { describe, it, expect } from 'vitest';
import { buildInsertion } from './editorInput';

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
