import { describe, it, expect } from 'vitest';
import { proofread, applyAllSuggestions, applyProofreadingSuggestion } from './proofreading';

const originals = (text: string) => proofread(text).map((i) => i.original);

describe('proofread', () => {
	it('正しい日常語を誤字として指摘しない', () => {
		const text = '彼以外は皆、その雰囲気を延々と味わっていた。';
		expect(proofread(text)).toEqual([]);
	});

	it('明らかな誤用・誤字を指摘し、修正候補を返す', () => {
		const text = '永遠と続く道。シュミレーションをした。';
		const issues = proofread(text);
		expect(issues.map((i) => i.suggestion)).toEqual(['延々と', 'シミュレーション']);
		expect(applyAllSuggestions(text, issues)).toBe('延々と続く道。シミュレーションをした。');
	});

	it('修正候補を適用しても、他の箇所の位置がずれない', () => {
		const text = 'ふいんきが良い。永遠と歩いた。';
		expect(applyAllSuggestions(text, proofread(text))).toBe('ふんいきが良い。延々と歩いた。');
	});

	it('段落の改行や行頭の字下げは「連続したスペース」にならない', () => {
		const text = '　最初の段落。\n\n　次の段落。';
		expect(proofread(text).filter((i) => i.message.includes('スペース'))).toEqual([]);
	});

	it('文中の連続した半角スペースは指摘する', () => {
		expect(originals('これは  誤り。')).toContain('  ');
	});

	it('笑い声などの「ははは」は助詞の重複にしない', () => {
		expect(proofread('「ははは」と笑った。')).toEqual([]);
	});

	it('「サーバー」だけなら表記揺れにしない。短い表記が混在するときだけ指摘する', () => {
		expect(proofread('サーバーを置いた。サーバーが動く。')).toEqual([]);
		const mixed = proofread('サーバを置いた。サーバーが動く。');
		expect(mixed.some((i) => i.message.includes('表記揺れ'))).toBe(true);
	});

	it('同じ語尾の連続は、実際の文の位置を指す', () => {
		const text = '彼は走った。彼は待った。彼は笑った。';
		const issue = proofread(text).find((i) => i.message.includes('語尾'));
		// 「った」が3文続く(最後の文を指す)
		expect(issue).toBeDefined();
		expect(text.slice(issue!.position.start, issue!.position.end)).toBe('彼は笑った。');
	});

	it('ら抜き言葉には修正候補を付ける', () => {
		const issue = proofread('これは見れる。').find((i) => i.message.includes('ら抜き'));
		expect(issue?.suggestion).toBe('見られる');
		expect(applyProofreadingSuggestion('これは見れる。', issue!)).toBe('これは見られる。');
	});

	it('長すぎる文は同じ文が複数あっても正しい位置を指す', () => {
		const long = 'あ'.repeat(120) + '。';
		const text = `短い。${long}短い。${long}`;
		const starts = proofread(text)
			.filter((i) => i.message.includes('長すぎ'))
			.map((i) => i.position.start);
		expect(starts).toEqual([3, 3 + long.length + 3]);
	});
});
