import { describe, expect, it } from 'vitest';
import { describeConflict, excerptAround, firstDifference } from './conflictView';

describe('conflictView', () => {
	it('最初に食い違う位置を返す', () => {
		expect(firstDifference('abc', 'abc')).toBe(-1);
		expect(firstDifference('abc', 'abd')).toBe(2);
		expect(firstDifference('abc', 'abcd')).toBe(3);
	});

	it('長い本文は、食い違う位置の前後を抜粋する', () => {
		const head = 'あ'.repeat(100);
		const local = `${head}この端末で書いた続き`;
		const remote = `${head}クラウドの続き`;
		const summary = describeConflict('scenes', { content: local }, { content: remote });
		const diff = summary.diffs.find((d) => d.key === 'content');
		expect(diff?.local).toContain('この端末で書いた続き');
		expect(diff?.remote).toContain('クラウドの続き');
		expect(diff?.note).toContain('101文字目から違います');
	});

	it('短い文字列はそのまま', () => {
		expect(excerptAround('短い', 1)).toBe('短い');
	});
});
