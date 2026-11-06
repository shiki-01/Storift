import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getBase, setBase, removeBase, flushSyncMeta } from './syncMeta';

describe('syncMeta の base 永続化', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
	});
	afterEach(() => {
		flushSyncMeta();
		vi.useRealTimers();
	});

	it('多数の更新を1回の書き込みにまとめる', () => {
		const spy = vi.spyOn(Storage.prototype, 'setItem');
		for (let i = 0; i < 100; i++) setBase('scenes', `s${i}`, 1000 + i);
		expect(spy).not.toHaveBeenCalled();
		expect(getBase('scenes', 's5')).toBe(1005); // メモリ上では即座に参照できる

		vi.advanceTimersByTime(1000);
		expect(spy).toHaveBeenCalledTimes(1);
		const saved = JSON.parse(localStorage.getItem('storift_sync_base')!);
		expect(saved['scenes/s99']).toBe(1099);
		spy.mockRestore();
	});

	it('flushSyncMeta で即時に保存し、削除も反映される', () => {
		setBase('chapters', 'c1', 1);
		removeBase('chapters', 'c1');
		flushSyncMeta();
		const saved = JSON.parse(localStorage.getItem('storift_sync_base')!);
		expect(saved['chapters/c1']).toBeUndefined();
	});

	it('pagehide で即時に保存する', () => {
		setBase('plots', 'p1', 7);
		window.dispatchEvent(new Event('pagehide'));
		expect(JSON.parse(localStorage.getItem('storift_sync_base')!)['plots/p1']).toBe(7);
	});

	it('値が変わらない更新では書き込みを予約しない', () => {
		setBase('plots', 'same', 5);
		flushSyncMeta();
		const spy = vi.spyOn(Storage.prototype, 'setItem');
		setBase('plots', 'same', 5);
		vi.advanceTimersByTime(2000);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});
