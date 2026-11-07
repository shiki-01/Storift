import { describe, expect, it } from 'vitest';
import {
	autoScrollDelta,
	clampIndex,
	indicatorY,
	insertionIndex,
	moveAnnouncement,
	pickList,
	previewPositions
} from './sortableLogic';

describe('insertionIndex', () => {
	const mids = [50, 150, 250];
	it('ポインタより上にある項目の数が挿入位置', () => {
		expect(insertionIndex(mids, 0)).toBe(0);
		expect(insertionIndex(mids, 49)).toBe(0);
		expect(insertionIndex(mids, 51)).toBe(1);
		expect(insertionIndex(mids, 200)).toBe(2);
		expect(insertionIndex(mids, 999)).toBe(3);
	});
	it('項目が無ければ 0', () => {
		expect(insertionIndex([], 100)).toBe(0);
	});
});

describe('indicatorY', () => {
	const rects = [
		{ top: 0, bottom: 100 },
		{ top: 112, bottom: 200 }
	];
	it('先頭・間・末尾・空', () => {
		expect(indicatorY(rects, 0, 12, 0)).toBe(-6);
		expect(indicatorY(rects, 1, 12, 0)).toBe(106);
		expect(indicatorY(rects, 2, 12, 0)).toBe(206);
		expect(indicatorY([], 0, 12, 40)).toBe(40);
	});
});

describe('autoScrollDelta', () => {
	it('端から離れていれば 0', () => {
		expect(autoScrollDelta(300, 0, 600)).toBe(0);
	});
	it('開始側は負、終了側は正。端に近いほど速い', () => {
		expect(autoScrollDelta(10, 0, 600)).toBeLessThan(0);
		expect(autoScrollDelta(590, 0, 600)).toBeGreaterThan(0);
		expect(Math.abs(autoScrollDelta(2, 0, 600))).toBeGreaterThan(
			Math.abs(autoScrollDelta(40, 0, 600))
		);
	});
	it('範囲の外に出ても最大速度まで', () => {
		expect(autoScrollDelta(-100, 0, 600, 56, 18)).toBe(-18);
		expect(autoScrollDelta(900, 0, 600, 56, 18)).toBe(18);
	});
	it('端の入口でも最低 1px は動く', () => {
		expect(autoScrollDelta(55, 0, 600, 56, 18)).toBe(-1);
	});
	it('幅 0 のコンテナは 0', () => {
		expect(autoScrollDelta(0, 10, 10)).toBe(0);
	});
});

describe('pickList', () => {
	const lists = [
		{ key: 'a', rect: { left: 0, right: 300, top: 50, bottom: 500 } },
		{ key: 'b', rect: { left: 320, right: 620, top: 50, bottom: 500 } }
	];
	it('ポインタを含む一覧', () => {
		expect(pickList(lists, { x: 100, y: 100 })?.key).toBe('a');
		expect(pickList(lists, { x: 400, y: 300 })?.key).toBe('b');
	});
	it('列の見出しの上など、縦に外れていても横が合えばその一覧', () => {
		expect(pickList(lists, { x: 400, y: 10 })?.key).toBe('b');
		expect(pickList(lists, { x: 400, y: 900 })?.key).toBe('b');
	});
	it('列の間の隙間は近い方、離れすぎていれば null', () => {
		expect(pickList(lists, { x: 310, y: 100 })?.key).toBe('a');
		expect(pickList(lists, { x: 700, y: 100 }, 48)).toBeNull();
		expect(pickList(lists, { x: 640, y: 100 }, 48)?.key).toBe('b');
	});
	it('一覧が無ければ null', () => {
		expect(pickList([], { x: 0, y: 0 })).toBeNull();
	});
});

describe('clampIndex / previewPositions / moveAnnouncement', () => {
	it('範囲に収める', () => {
		expect(clampIndex(0, -1, 5)).toBe(0);
		expect(clampIndex(4, 1, 5)).toBe(4);
		expect(clampIndex(2, 1, 5)).toBe(3);
	});
	it('仮の並び', () => {
		const pos = previewPositions(['a', 'b', 'c', 'd'], 'a', 2);
		expect([...pos.entries()].sort((x, y) => x[1] - y[1]).map((e) => e[0])).toEqual([
			'b',
			'c',
			'a',
			'd'
		]);
		expect(previewPositions(['a', 'b'], null, 0).get('b')).toBe(1);
	});
	it('通知文', () => {
		expect(moveAnnouncement('「導入」', 2, 5)).toBe('「導入」を 3 番目に移動しました(全 5 件)');
	});
});
