import { describe, it, expect } from 'vitest';
import { blockerRects, cutoutRect, placeCard, type Rect } from './tourGeometry';

const VIEW = { width: 1000, height: 800 };
const CARD = { width: 320, height: 200 };

const rect = (x: number, y: number, width: number, height: number): Rect => ({
	x,
	y,
	width,
	height
});

/** 矩形どうしが重なるか(辺が接しているだけなら重ならない) */
const overlap = (a: Rect, b: Rect) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('placeCard', () => {
	it('target が無ければ画面中央に置く', () => {
		expect(placeCard(null, CARD, VIEW)).toEqual({ x: 340, y: 300, side: 'center' });
	});

	it('placement を指定すると、その側に gap を空けて置く', () => {
		const target = rect(400, 300, 200, 100);
		const pos = placeCard(target, CARD, VIEW, 'top');
		expect(pos.side).toBe('top');
		expect(pos.y).toBe(300 - 14 - 200);
	});

	it('placement の側が入らなければ反対側へ切り替える', () => {
		// 上に空きが無い target
		const target = rect(400, 10, 200, 60);
		const pos = placeCard(target, CARD, VIEW, 'top');
		expect(pos.side).toBe('bottom');
		expect(pos.y).toBe(10 + 60 + 14);
	});

	it('反対側も入らなければ、直交する左右へ逃がす', () => {
		// 縦に画面をほぼ覆う target。上下どちらにも 200px のカードは入らない
		const target = rect(100, 20, 200, 760);
		const pos = placeCard(target, CARD, VIEW, 'bottom');
		expect(['left', 'right']).toContain(pos.side);
		expect(overlap({ x: pos.x, y: pos.y, ...CARD }, target)).toBe(false);
	});

	it('auto は下・上・右・左の順に、入る最初の側を選ぶ', () => {
		const target = rect(400, 300, 200, 100);
		expect(placeCard(target, CARD, VIEW, 'auto').side).toBe('bottom');

		const bottomBlocked = rect(400, 600, 200, 150);
		expect(placeCard(bottomBlocked, CARD, VIEW, 'auto').side).toBe('top');
	});

	it('どの側にも入らないときは、最も空いている側へ寄せてもビューポート内に収める', () => {
		const huge = rect(0, 0, 1000, 800);
		const pos = placeCard(huge, CARD, VIEW, 'bottom');
		expect(pos.x).toBeGreaterThanOrEqual(12);
		expect(pos.x + CARD.width).toBeLessThanOrEqual(VIEW.width - 12);
		expect(pos.y).toBeGreaterThanOrEqual(12);
		expect(pos.y + CARD.height).toBeLessThanOrEqual(VIEW.height - 12);
	});

	it('target が画面の左端にあり、上下に置くとカードが左にはみ出す場合は左の余白内にクランプする', () => {
		const target = rect(0, 300, 40, 40);
		const pos = placeCard(target, CARD, VIEW, 'bottom');
		expect(pos.side).toBe('bottom');
		expect(pos.x).toBe(12);
	});

	it('target が画面の右下隅にあるときも、画面外へ出ない', () => {
		const target = rect(960, 760, 40, 30);
		const pos = placeCard(target, CARD, VIEW, 'bottom');
		expect(pos.x + CARD.width).toBeLessThanOrEqual(VIEW.width - 12);
		expect(pos.y + CARD.height).toBeLessThanOrEqual(VIEW.height - 12);
	});

	it('カードが画面より大きい場合は、左上の余白位置に固定する', () => {
		const pos = placeCard(rect(100, 100, 10, 10), { width: 2000, height: 2000 }, VIEW, 'right');
		expect(pos.x).toBe(12);
		expect(pos.y).toBe(12);
	});

	it('余白と gap は引数で変えられる', () => {
		const target = rect(400, 300, 200, 100);
		const pos = placeCard(target, CARD, VIEW, 'bottom', 20, 30);
		expect(pos.y).toBe(300 + 100 + 30);
	});

	it('どの候補でもカードが target と重ならない(通常ケース)', () => {
		const targets = [rect(400, 300, 200, 100), rect(10, 10, 80, 40), rect(900, 700, 90, 80)];
		for (const target of targets) {
			for (const placement of ['auto', 'top', 'bottom', 'left', 'right'] as const) {
				const pos = placeCard(target, CARD, VIEW, placement);
				expect(overlap({ x: pos.x, y: pos.y, ...CARD }, target)).toBe(false);
			}
		}
	});
});

describe('cutoutRect', () => {
	it('余白を付けて矩形を広げる', () => {
		expect(cutoutRect(rect(100, 100, 50, 30), 6, VIEW)).toEqual({
			x: 94,
			y: 94,
			width: 62,
			height: 42
		});
	});

	it('画面の外にはみ出した分は切り詰める', () => {
		expect(cutoutRect(rect(-10, 5, 50, 30), 6, { width: 100, height: 100 })).toEqual({
			x: 0,
			y: 0,
			width: 46,
			height: 41
		});
	});

	it('画面の外にだけある矩形は幅・高さ 0 になる', () => {
		const cut = cutoutRect(rect(-200, -200, 50, 50), 6, VIEW);
		expect(cut.width).toBe(0);
		expect(cut.height).toBe(0);
	});
});

describe('blockerRects', () => {
	it('穴の上下左右に 4 枚の矩形を置き、穴の内側は覆わない', () => {
		const hole = rect(10, 20, 30, 40);
		const [top, bottom, left, right] = blockerRects(hole, { width: 100, height: 100 });
		expect(top).toEqual({ x: 0, y: 0, width: 100, height: 20 });
		expect(bottom).toEqual({ x: 0, y: 60, width: 100, height: 40 });
		expect(left).toEqual({ x: 0, y: 20, width: 10, height: 40 });
		expect(right).toEqual({ x: 40, y: 20, width: 60, height: 40 });
	});

	it('4 枚の面積の合計は、画面から穴を引いた面積と一致する', () => {
		const hole = rect(10, 20, 30, 40);
		const area = blockerRects(hole, { width: 100, height: 100 }).reduce(
			(sum, r) => sum + r.width * r.height,
			0
		);
		expect(area).toBe(100 * 100 - 30 * 40);
	});

	it('4 枚のどれも穴と重ならない', () => {
		const hole = rect(10, 20, 30, 40);
		for (const b of blockerRects(hole, { width: 100, height: 100 })) {
			if (b.width === 0 || b.height === 0) continue;
			expect(overlap(b, hole)).toBe(false);
		}
	});

	it('穴が画面端にある場合は、該当する面の幅・高さが 0 になる', () => {
		const [top, , left] = blockerRects(rect(0, 0, 30, 40), { width: 100, height: 100 });
		expect(top.height).toBe(0);
		expect(left.width).toBe(0);
	});

	it('穴が画面からはみ出していても、画面内に切り詰めて分割する', () => {
		const blockers = blockerRects(rect(80, 80, 50, 50), { width: 100, height: 100 });
		const area = blockers.reduce((sum, r) => sum + r.width * r.height, 0);
		// 穴は画面内では 20x20 の領域
		expect(area).toBe(100 * 100 - 20 * 20);
	});
});
