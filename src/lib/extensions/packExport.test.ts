import { describe, expect, it } from 'vitest';
import { applyExportNotation } from './packExport';

const keep = { ruby: 'keep', bouten: 'keep', blankLines: 'keep' } as const;
const text = '｜紅蓮の炎《ヘルフレイム》と漢字《かんじ》、これは《《重要》》です。';

describe('applyExportNotation', () => {
	it('keep は何も変えない', () => {
		expect(applyExportNotation(text, keep)).toBe(text);
	});

	it('ルビの書き方を変える', () => {
		expect(applyExportNotation(text, { ...keep, ruby: 'paren' })).toBe(
			'紅蓮の炎(ヘルフレイム)と漢字(かんじ)、これは《《重要》》です。'
		);
		expect(applyExportNotation(text, { ...keep, ruby: 'strip' })).toBe(
			'紅蓮の炎と漢字、これは《《重要》》です。'
		);
		expect(applyExportNotation(text, { ...keep, ruby: 'pipe-ascii' })).toBe(
			'|紅蓮の炎《ヘルフレイム》と|漢字《かんじ》、これは《《重要》》です。'
		);
	});

	it('傍点の書き方を変える', () => {
		expect(applyExportNotation(text, { ...keep, bouten: 'strip' })).toBe(
			'｜紅蓮の炎《ヘルフレイム》と漢字《かんじ》、これは重要です。'
		);
		expect(applyExportNotation(text, { ...keep, bouten: 'ruby-dots' })).toContain('｜重要《・・》');
	});

	it('変換した結果を、もう一度変換しない', () => {
		const out = applyExportNotation('これは《《重要》》', {
			ruby: 'strip',
			bouten: 'ruby-dots',
			blankLines: 'keep'
		});
		expect(out).toBe('これは｜重要《・・》');
	});

	it('空行の扱い', () => {
		const src = '一行目\n\n\n二行目\n三行目\n';
		expect(applyExportNotation(src, { ...keep, blankLines: 'collapse' })).toBe(
			'一行目\n二行目\n三行目'
		);
		expect(applyExportNotation(src, { ...keep, blankLines: 'between-paragraphs' })).toBe(
			'一行目\n\n二行目\n\n三行目'
		);
	});
});
