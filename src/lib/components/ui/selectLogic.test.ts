import { describe, expect, it } from 'vitest';
import {
	computePlacement,
	findTypeahead,
	firstEnabled,
	lastEnabled,
	stepEnabled,
	type SelectOption
} from './selectLogic';

const opts: SelectOption[] = [
	{ value: 'a', label: 'Apple' },
	{ value: 'b', label: 'Banana', disabled: true },
	{ value: 'c', label: 'Cherry' },
	{ value: 'd', label: 'Avocado' }
];

describe('stepEnabled', () => {
	it('無効な項目を飛ばして進む', () => {
		expect(stepEnabled(opts, 0, 1)).toBe(2);
		expect(stepEnabled(opts, 2, -1)).toBe(0);
	});

	it('端を越えたら -1', () => {
		expect(stepEnabled(opts, 3, 1)).toBe(-1);
		expect(stepEnabled(opts, 0, -1)).toBe(-1);
	});

	it('先頭と末尾の選べる項目', () => {
		expect(firstEnabled(opts)).toBe(0);
		expect(lastEnabled(opts)).toBe(3);
		expect(firstEnabled([{ value: 'x', label: 'x', disabled: true }])).toBe(-1);
	});
});

describe('findTypeahead', () => {
	it('先頭一致で最初の項目を返す(大文字小文字は区別しない)', () => {
		expect(findTypeahead(opts, 'c', -1)).toBe(2);
		expect(findTypeahead(opts, 'AV', 0)).toBe(3);
	});

	it('無効な項目は飛ばす', () => {
		expect(findTypeahead(opts, 'b', -1)).toBe(-1);
	});

	it('同じ文字の繰り返しでは次の同じ頭文字へ進む', () => {
		expect(findTypeahead(opts, 'aa', 0)).toBe(3);
		expect(findTypeahead(opts, 'aa', 3)).toBe(0);
	});

	it('一致がなければ -1', () => {
		expect(findTypeahead(opts, 'z', 0)).toBe(-1);
		expect(findTypeahead(opts, '', 0)).toBe(-1);
	});
});

describe('computePlacement', () => {
	const viewport = { width: 1000, height: 800 };
	const rect = (top: number, left = 100, width = 120, height = 30) => ({
		top,
		bottom: top + height,
		left,
		right: left + width,
		width
	});

	it('下に収まれば下へ開く', () => {
		const p = computePlacement(rect(100), 200, viewport);
		expect(p.side).toBe('down');
		expect(p.top).toBe(134);
	});

	it('下に収まらず上が広ければ上へ開く(画面下の AI パネル)', () => {
		const p = computePlacement(rect(740), 200, viewport);
		expect(p.side).toBe('up');
		expect(p.top).toBe(740 - 4 - 200);
	});

	it('どちらにも収まらなければ広い側で高さを抑える', () => {
		const p = computePlacement(rect(600), 900, viewport);
		expect(p.side).toBe('up');
		expect(p.maxHeight).toBe(600 - 4 - 8);
	});

	it('右端にはみ出さないよう左へ寄せ、最小幅を守る', () => {
		const p = computePlacement(rect(100, 950, 40), 100, viewport, 200);
		expect(p.width).toBe(200);
		expect(p.left + p.width).toBeLessThanOrEqual(1000 - 8);
	});

	it('画面より広い最小幅は画面に収める', () => {
		const p = computePlacement(rect(100), 100, { width: 300, height: 800 }, 500);
		expect(p.width).toBe(284);
		expect(p.left).toBe(8);
	});
});
