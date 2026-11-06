import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounceAsync } from './debounce';

describe('debounceAsync', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('連続呼び出しの全 Promise が同じ結果で解決され、関数は1回だけ最後の引数で実行される', async () => {
		const fn = vi.fn(async (n: number) => n * 2);
		const d = debounceAsync(fn, 100);
		const p1 = d(1);
		const p2 = d(2);
		const p3 = d(3);
		await vi.advanceTimersByTimeAsync(100);
		await expect(Promise.all([p1, p2, p3])).resolves.toEqual([6, 6, 6]);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith(3);
	});

	it('関数が reject した場合、待機中の全 Promise が reject される', async () => {
		const d = debounceAsync(async () => {
			throw new Error('boom');
		}, 50);
		const p1 = d().catch((e: Error) => e.message);
		const p2 = d().catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(50);
		await expect(Promise.all([p1, p2])).resolves.toEqual(['boom', 'boom']);
	});

	it('関数が同期的に throw した場合も reject される', async () => {
		const d = debounceAsync(
			(() => {
				throw new Error('sync');
			}) as () => Promise<void>,
			50
		);
		const p = d().catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(50);
		await expect(p).resolves.toBe('sync');
	});

	it('呼び出しのたびに遅延が再スケジュールされる', async () => {
		const fn = vi.fn(async () => 'ok');
		const d = debounceAsync(fn, 100);
		const p1 = d();
		await vi.advanceTimersByTimeAsync(80);
		const p2 = d();
		await vi.advanceTimersByTimeAsync(80);
		expect(fn).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(20);
		expect(fn).toHaveBeenCalledTimes(1);
		await expect(Promise.all([p1, p2])).resolves.toEqual(['ok', 'ok']);
	});

	it('実行完了後の呼び出しは新しいバッチとして再度実行される', async () => {
		const fn = vi.fn(async () => 'x');
		const d = debounceAsync(fn, 10);
		const p1 = d();
		await vi.advanceTimersByTimeAsync(10);
		await p1;
		const p2 = d();
		await vi.advanceTimersByTimeAsync(10);
		await p2;
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
