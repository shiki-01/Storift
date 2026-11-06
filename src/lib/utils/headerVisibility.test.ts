import { describe, expect, it } from 'vitest';
import {
	computeHeaderVisibility,
	INITIAL_HEADER_STATE,
	type HeaderVisibilityState
} from './headerVisibility';

/** y の列を順に流して最終状態を返す */
function run(ys: number[], start: HeaderVisibilityState = INITIAL_HEADER_STATE) {
	let state = start;
	for (let i = 1; i < ys.length; i++) state = computeHeaderVisibility(ys[i - 1], ys[i], state);
	return state;
}

describe('computeHeaderVisibility', () => {
	it('最上部では常に表示する', () => {
		expect(computeHeaderVisibility(50, 0, { visible: false, travel: 30 }).visible).toBe(true);
		expect(computeHeaderVisibility(5, -10, { visible: false, travel: 0 }).visible).toBe(true);
	});

	it('小さな揺れでは切り替わらない', () => {
		expect(run([100, 105, 110, 115]).visible).toBe(true);
		expect(run([100, 90, 95, 90, 95], { visible: false, travel: 0 }).visible).toBe(false);
	});

	it('下向きに 24px 以上で隠す(細かいイベントの積算でも)', () => {
		expect(run([100, 110, 120, 123]).visible).toBe(true);
		expect(run([100, 110, 120, 124]).visible).toBe(false);
	});

	it('上向きに 12px 以上で出す', () => {
		const hidden = { visible: false, travel: 0 };
		expect(run([200, 195, 190], hidden).visible).toBe(false);
		expect(run([200, 195, 188], hidden).visible).toBe(true);
	});

	it('向きが変わると積算をやり直す', () => {
		// 20px 下がってから 5px 戻り、また 10px 下がっても、積算は 10px なので隠れない
		expect(run([100, 120, 115, 125]).visible).toBe(true);
	});

	it('移動がなければ状態を変えない', () => {
		const s = { visible: false, travel: 30 };
		expect(computeHeaderVisibility(100, 100, s)).toBe(s);
	});
});
