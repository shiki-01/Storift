import { describe, expect, it } from 'vitest';
import { POPOVER_GAP, POPOVER_MARGIN, computePopoverPosition } from './popoverPosition';

const viewport = { width: 1000, height: 800 };
const trigger = { top: 10, bottom: 44, left: 900, right: 934 };

describe('computePopoverPosition', () => {
	it('収まるなら起点の下に、右端をそろえて開く', () => {
		const p = computePopoverPosition(trigger, { width: 280, height: 200 }, viewport);
		expect(p.side).toBe('down');
		expect(p.top).toBe(44 + POPOVER_GAP);
		expect(p.left).toBe(934 - 280);
	});

	it('align=start なら左端をそろえる(右にはみ出すときは画面内に収める)', () => {
		const p = computePopoverPosition(trigger, { width: 280, height: 100 }, viewport, 'start');
		expect(p.left).toBe(1000 - POPOVER_MARGIN - 280);
	});

	it('左にはみ出すときは左の余白に収める', () => {
		const p = computePopoverPosition(
			{ top: 10, bottom: 44, left: 0, right: 34 },
			{ width: 280, height: 100 },
			viewport
		);
		expect(p.left).toBe(POPOVER_MARGIN);
	});

	it('下に収まらず上の方が広ければ、上に反転する', () => {
		const low = { top: 700, bottom: 734, left: 500, right: 534 };
		const p = computePopoverPosition(low, { width: 200, height: 300 }, viewport);
		expect(p.side).toBe('up');
		expect(p.top).toBe(700 - POPOVER_GAP - 300);
	});

	it('どちら側にも収まらないときは広い側で高さを抑える', () => {
		const p = computePopoverPosition(trigger, { width: 200, height: 5000 }, viewport);
		expect(p.side).toBe('down');
		expect(p.maxHeight).toBe(800 - 44 - POPOVER_GAP - POPOVER_MARGIN);
	});

	it('画面より幅が広くても余白の位置に置く', () => {
		const p = computePopoverPosition(trigger, { width: 2000, height: 100 }, viewport);
		expect(p.left).toBe(POPOVER_MARGIN);
	});
});
