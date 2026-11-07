import { describe, expect, it } from 'vitest';
import {
	MIN_GAP,
	REBALANCE_STEP,
	moveItem,
	needsRebalance,
	nextOrder,
	orderBetween,
	rebalance,
	sortByOrder,
	type Orderable
} from './ordering';

const item = (id: string, order?: number, createdAt?: number): Orderable => ({
	id,
	order,
	createdAt
});
const ids = (items: Orderable[]) => items.map((i) => i.id);

/** 更新を適用して並べ直した id の並び */
function apply(items: Orderable[], updates: { id: string; order: number }[]): string[] {
	const map = new Map(updates.map((u) => [u.id, u.order]));
	return ids(sortByOrder(items.map((i) => (map.has(i.id) ? { ...i, order: map.get(i.id) } : i))));
}

describe('sortByOrder', () => {
	it('order の昇順に並べ、元の配列は変えない', () => {
		const src = [item('a', 3), item('b', 1), item('c', 2)];
		expect(ids(sortByOrder(src))).toEqual(['b', 'c', 'a']);
		expect(ids(src)).toEqual(['a', 'b', 'c']);
	});

	it('order が無いデータは createdAt の昇順', () => {
		expect(
			ids(
				sortByOrder([item('a', undefined, 30), item('b', undefined, 10), item('c', undefined, 20)])
			)
		).toEqual(['b', 'c', 'a']);
	});

	it('createdAt が無ければ updatedAt、さらに id', () => {
		const rows: Orderable[] = [
			{ id: 'z', updatedAt: 5 },
			{ id: 'y', updatedAt: 1 },
			{ id: 'b' },
			{ id: 'a' }
		];
		expect(ids(sortByOrder(rows))).toEqual(['a', 'b', 'y', 'z']);
	});

	it('order の有無が混ざるときは、order の無い行が前', () => {
		const rows = [item('n', 1, 1), item('old2', undefined, 20), item('old1', undefined, 10)];
		expect(ids(sortByOrder(rows))).toEqual(['old1', 'old2', 'n']);
	});

	it('同じ order は createdAt、さらに id で安定して並ぶ', () => {
		const rows = [item('b', 1, 5), item('a', 1, 5), item('c', 1, 1)];
		expect(ids(sortByOrder(rows))).toEqual(['c', 'a', 'b']);
		expect(ids(sortByOrder([...rows].reverse()))).toEqual(['c', 'a', 'b']);
	});

	it('NaN / 無限大の order は無いものとして扱う', () => {
		expect(ids(sortByOrder([item('a', 1, 1), item('b', NaN, 2), item('c', Infinity, 0)]))).toEqual([
			'c',
			'b',
			'a'
		]);
	});

	it('空と 1 件', () => {
		expect(sortByOrder([])).toEqual([]);
		expect(ids(sortByOrder([item('a')]))).toEqual(['a']);
	});
});

describe('orderBetween / nextOrder', () => {
	it('中間値・先頭(next - 1)・末尾(prev + 1)', () => {
		expect(orderBetween(1, 3)).toBe(2);
		expect(orderBetween(1, 2)).toBe(1.5);
		expect(orderBetween(undefined, 5)).toBe(4);
		expect(orderBetween(5, undefined)).toBe(6);
		expect(orderBetween()).toBe(REBALANCE_STEP);
	});

	it('nextOrder は最大値 + 1024(order の無い行は数えない)', () => {
		expect(nextOrder([])).toBe(REBALANCE_STEP);
		expect(nextOrder([item('a'), item('b')])).toBe(REBALANCE_STEP);
		expect(nextOrder([item('a', 2048), item('b', 5), item('c')])).toBe(2048 + REBALANCE_STEP);
	});
});

describe('needsRebalance / rebalance', () => {
	it('十分な間隔があれば不要', () => {
		expect(needsRebalance([item('a', 1), item('b', 2)])).toBe(false);
		expect(needsRebalance([])).toBe(false);
		expect(needsRebalance([item('a', 1)])).toBe(false);
	});

	it('order の無い行が混ざる、間隔が MIN_GAP 未満、同じ値なら必要', () => {
		expect(needsRebalance([item('a', 1), item('b')])).toBe(true);
		expect(needsRebalance([item('a', 1), item('b', 1 + MIN_GAP / 2)])).toBe(true);
		expect(needsRebalance([item('a', 1), item('b', 1)])).toBe(true);
	});

	it('現在の並びのまま 1024 刻みに振り直す', () => {
		const rows = [item('c', undefined, 3), item('a', undefined, 1), item('b', undefined, 2)];
		expect(rebalance(rows)).toEqual([
			{ id: 'a', order: 1024 },
			{ id: 'b', order: 2048 },
			{ id: 'c', order: 3072 }
		]);
	});

	it('既に 1024 刻みなら何も返さない', () => {
		expect(rebalance([item('a', 1024), item('b', 2048)])).toEqual([]);
	});
});

describe('moveItem', () => {
	const base = () => [item('a', 1024), item('b', 2048), item('c', 3072), item('d', 4096)];

	it('1 件だけ書く(中間値)', () => {
		const updates = moveItem(base(), 'd', 1);
		expect(updates).toEqual([{ id: 'd', order: (1024 + 2048) / 2 }]);
		expect(apply(base(), updates)).toEqual(['a', 'd', 'b', 'c']);
	});

	it('下方向への移動も、移動後の位置で指定する', () => {
		const updates = moveItem(base(), 'a', 2);
		expect(updates).toEqual([{ id: 'a', order: (3072 + 4096) / 2 }]);
		expect(apply(base(), updates)).toEqual(['b', 'c', 'a', 'd']);
	});

	it('先頭は next - 1、末尾は prev + 1', () => {
		expect(moveItem(base(), 'c', 0)).toEqual([{ id: 'c', order: 1023 }]);
		expect(moveItem(base(), 'b', 3)).toEqual([{ id: 'b', order: 4097 }]);
	});

	it('位置が変わらなければ空', () => {
		expect(moveItem(base(), 'b', 1)).toEqual([]);
		expect(moveItem(base(), 'd', 3)).toEqual([]);
		expect(moveItem(base(), 'd', 99)).toEqual([]);
		expect(moveItem(base(), 'a', -5)).toEqual([]);
	});

	it('範囲外の toIndex は端に丸める', () => {
		expect(apply(base(), moveItem(base(), 'a', 99))).toEqual(['b', 'c', 'd', 'a']);
		expect(apply(base(), moveItem(base(), 'd', -3))).toEqual(['d', 'a', 'b', 'c']);
	});

	it('空・1 件・存在しない id', () => {
		expect(moveItem([], 'x', 0)).toEqual([{ id: 'x', order: REBALANCE_STEP }]);
		expect(moveItem([item('a', 5)], 'a', 0)).toEqual([]);
		expect(moveItem([item('a', 5)], 'a', 3)).toEqual([]);
	});

	it('他のグループからの挿入(id が items に無い)', () => {
		expect(moveItem(base(), 'x', 2)).toEqual([{ id: 'x', order: (2048 + 3072) / 2 }]);
		expect(moveItem(base(), 'x', 0)).toEqual([{ id: 'x', order: 1023 }]);
		expect(moveItem(base(), 'x', 4)).toEqual([{ id: 'x', order: 4097 }]);
		expect(moveItem([], 'x', 0)).toEqual([{ id: 'x', order: REBALANCE_STEP }]);
	});

	it('間隔が尽きたら全体を振り直す(複数件)', () => {
		const rows = [item('a', 1), item('b', 1 + MIN_GAP * 1.5), item('c', 10)];
		// b と a の間に c を入れると、中間値の間隔が MIN_GAP を下回る
		const updates = moveItem(rows, 'c', 1);
		expect(updates.length).toBeGreaterThan(1);
		expect(apply(rows, updates)).toEqual(['a', 'c', 'b']);
		expect(new Set(updates.map((u) => u.order)).size).toBe(updates.length);
	});

	it('既存の間隔が枯渇していれば振り直す', () => {
		const rows = [item('a', 1), item('b', 1), item('c', 5)];
		const updates = moveItem(rows, 'c', 0);
		expect(updates.length).toBeGreaterThan(1);
		expect(apply(rows, updates)).toEqual(['c', 'a', 'b']);
	});

	it('中間値を繰り返し取っても順序が保たれ、いつか振り直される', () => {
		let rows = [item('a', 0), item('b', 1), item('c', 2)];
		let rebalanced = false;
		for (let i = 0; i < 60; i++) {
			// 末尾の c を a と、その直後の項目の間へ
			const sorted = sortByOrder(rows);
			const target = sorted.findIndex((r) => r.id === 'c') === 2 ? 1 : 2;
			const updates = moveItem(rows, 'c', target);
			if (updates.length > 1) rebalanced = true;
			const map = new Map(updates.map((u) => [u.id, u.order]));
			rows = rows.map((r) => (map.has(r.id) ? { ...r, order: map.get(r.id) } : r));
			expect(ids(sortByOrder(rows))[target]).toBe('c');
		}
		expect(rebalanced).toBe(false);
		// a と b の間に c を入れ続ける(間隔は半分ずつ縮む)
		rows = [item('a', 0), item('b', 1), item('x', 2)];
		for (let i = 0; i < 60; i++) {
			const sorted = sortByOrder(rows);
			const moving = sorted[2].id;
			const updates = moveItem(rows, moving, 1);
			if (updates.length > 1) rebalanced = true;
			const map = new Map(updates.map((u) => [u.id, u.order]));
			rows = rows.map((r) => (map.has(r.id) ? { ...r, order: map.get(r.id) } : r));
			expect(sortByOrder(rows)[1].id).toBe(moving);
		}
		expect(rebalanced).toBe(true);
	});

	it('order の無い行が混ざっていれば全体を振り直す', () => {
		const rows = [item('a', undefined, 1), item('b', undefined, 2), item('c', undefined, 3)];
		const updates = moveItem(rows, 'c', 0);
		expect(updates).toHaveLength(3);
		expect(apply(rows, updates)).toEqual(['c', 'a', 'b']);
		const mixed = [item('a', undefined, 1), item('b', 5, 2)];
		expect(apply(mixed, moveItem(mixed, 'b', 0))).toEqual(['b', 'a']);
	});

	it('同じ order が並ぶデータも、見た目の順のまま移動できる', () => {
		const rows = [item('a', 1, 1), item('b', 1, 2), item('c', 1, 3)];
		expect(apply(rows, moveItem(rows, 'a', 2))).toEqual(['b', 'c', 'a']);
	});
});
