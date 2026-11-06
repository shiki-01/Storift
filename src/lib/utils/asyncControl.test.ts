import { describe, it, expect, vi } from 'vitest';
import { Mutex, withTimeout, mapLimit, TimeoutError } from './asyncControl';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Mutex', () => {
	it('処理を重ならずに呼び出し順に実行する', async () => {
		const mutex = new Mutex();
		const log: string[] = [];
		const task = (name: string, ms: number) =>
			mutex.runExclusive(async () => {
				log.push(`${name}:start`);
				await sleep(ms);
				log.push(`${name}:end`);
			});
		await Promise.all([task('a', 20), task('b', 1), task('c', 1)]);
		expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
	});

	it('失敗してもロックが解放され、次の処理が実行される', async () => {
		const mutex = new Mutex();
		const failed = mutex.runExclusive(async () => {
			throw new Error('boom');
		});
		await expect(failed).rejects.toThrow('boom');
		await expect(mutex.runExclusive(async () => 'ok')).resolves.toBe('ok');
		expect(mutex.isLocked).toBe(false);
	});

	it('処理の戻り値を返す', async () => {
		await expect(new Mutex().runExclusive(async () => 42)).resolves.toBe(42);
	});
});

describe('withTimeout', () => {
	it('間に合えば結果を返す', async () => {
		await expect(withTimeout(Promise.resolve(1), 50, 'x')).resolves.toBe(1);
	});

	it('超過したら deadline-exceeded の TimeoutError で reject し、onTimeout を呼ぶ', async () => {
		const onTimeout = vi.fn();
		const err = (await withTimeout(sleep(100), 10, '取得', onTimeout).catch(
			(e) => e
		)) as TimeoutError;
		expect(err).toBeInstanceOf(TimeoutError);
		expect(err.code).toBe('deadline-exceeded');
		expect(onTimeout).toHaveBeenCalledOnce();
	});

	it('元の処理の失敗はそのまま伝える', async () => {
		await expect(withTimeout(Promise.reject(new Error('e')), 50, 'x')).rejects.toThrow('e');
	});
});

describe('mapLimit', () => {
	it('並列数を超えず、結果は入力順で、失敗は他を止めない', async () => {
		let running = 0;
		let peak = 0;
		const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
			running++;
			peak = Math.max(peak, running);
			await sleep(5);
			running--;
			if (n === 3) throw new Error('three');
			return n * 10;
		});
		expect(peak).toBe(2);
		expect(results.map((r) => (r.status === 'fulfilled' ? r.value : 'x'))).toEqual([
			10,
			20,
			'x',
			40,
			50,
			60
		]);
	});

	it('空配列でも動く', async () => {
		await expect(mapLimit([], 5, async () => 1)).resolves.toEqual([]);
	});
});
