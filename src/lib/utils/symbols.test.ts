import { describe, expect, it } from 'vitest';
import { SYMBOL_GROUPS, symbolInsertion } from './symbols';

describe('symbolInsertion', () => {
	const kagi = SYMBOL_GROUPS[0].items[0];

	it('括弧は選択が無ければ内側にカーソルを置く', () => {
		expect(symbolInsertion(kagi)).toEqual({ text: '「」', caretBack: 1 });
	});

	it('括弧は選択中の文字列を囲む', () => {
		expect(symbolInsertion(kagi, '台詞')).toEqual({ text: '「台詞」', caretBack: 0 });
	});

	it('単独の記号はそのまま入れる', () => {
		expect(symbolInsertion({ text: '※', name: '米印' }, '選択')).toEqual({
			text: '※',
			caretBack: 0
		});
	});

	it('記号の重複が無い', () => {
		const all = SYMBOL_GROUPS.flatMap((g) => g.items.map((i) => i.text));
		expect(new Set(all).size).toBe(all.length);
	});
});
