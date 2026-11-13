import { describe, expect, it } from 'vitest';
import { proofread, applyAllSuggestions } from '$lib/utils/proofreading';
import { findRuleMatches, type PackRuleSource } from './packProofread';

const source = (rules: PackRuleSource['rules']): PackRuleSource => ({
	packId: 'p',
	packName: 'パック',
	setName: '辞書',
	rules
});

describe('findRuleMatches', () => {
	it('固定の文字列の出現を、位置の昇順で返す', () => {
		const m = findRuleMatches('出来る。下さい。出来る', [
			source([
				{ from: '出来る', to: 'できる' },
				{ from: '下さい', to: 'ください' }
			])
		]);
		expect(m.map((x) => [x.start, x.original, x.suggestion])).toEqual([
			[0, '出来る', 'できる'],
			[4, '下さい', 'ください'],
			[8, '出来る', 'できる']
		]);
		expect(m[0].message).toContain('「出来る」は「できる」と書きます');
	});

	it('正規表現のメタ文字は、ただの文字として扱う(ReDoS の余地が無い)', () => {
		const text = 'a'.repeat(5000) + '!';
		const start = performance.now();
		const m = findRuleMatches(text, [source([{ from: '(a+)+$', to: 'x' }])]);
		expect(m).toEqual([]);
		expect(performance.now() - start).toBeLessThan(200);
		expect(findRuleMatches('a.b a+b', [source([{ from: 'a.b', to: 'x' }])])).toHaveLength(1);
	});

	it('message を使う。to が空なら削除の提案', () => {
		const m = findRuleMatches('えーと、', [source([{ from: 'えーと', to: '', message: '不要' }])]);
		expect(m[0].message).toBe('不要');
		expect(m[0].suggestion).toBe('');
	});

	it('実行時間と件数の上限で打ち切る', () => {
		let t = 0;
		const rules = [
			{ from: 'a', to: 'b' },
			{ from: 'c', to: 'd' }
		];
		// 2 つ目の規則に入る前に、時間切れになる
		const calls = [0, 0, 1000];
		const m = findRuleMatches('ac', [source(rules)], {
			budgetMs: 100,
			now: () => calls[Math.min(t++, calls.length - 1)]
		});
		expect(m.map((x) => x.original)).toEqual(['a']);
		expect(findRuleMatches('aaaa', [source([{ from: 'a', to: 'b' }])], { limit: 2 })).toHaveLength(
			2
		);
	});
});

describe('proofread への合成', () => {
	it('パックの辞書の指摘を、本体の指摘と並べて返す', () => {
		const issues = proofread('お願い下さい。', [source([{ from: '下さい', to: 'ください' }])]);
		const hit = issues.find((i) => i.packId === 'p');
		expect(hit?.suggestion).toBe('ください');
		expect(hit?.position).toEqual({ start: 3, end: 6 });
	});

	it('辞書が無いときは、従来の結果と同じ', () => {
		expect(proofread('お願い下さい。')).toEqual(proofread('お願い下さい。', []));
	});

	it('範囲の重なる指摘をすべて適用しても本文を壊さない', () => {
		const rules = source([
			{ from: '出来るだけ', to: 'できるだけ' },
			{ from: '出来る', to: 'できる' }
		]);
		const text = '出来るだけ急ぐ';
		expect(applyAllSuggestions(text, proofread(text, [rules]))).toBe('できるだけ急ぐ');
	});
});
