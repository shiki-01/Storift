import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearSyncMetrics, getSyncMetrics, measureSync, recordSyncMetric } from './syncMetrics';

describe('syncMetrics', () => {
	beforeEach(() => {
		clearSyncMetrics();
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('直近50件だけを新しい順で保持する', () => {
		for (let i = 0; i < 60; i++) {
			recordSyncMetric({ kind: 'download', durationMs: i, count: i, ok: true });
		}
		const list = getSyncMetrics();
		expect(list).toHaveLength(50);
		expect(list[0].count).toBe(59);
		expect(list[49].count).toBe(10);
	});

	it('measureSync は成功と失敗の両方を記録する', async () => {
		await measureSync(
			'applyRealtime',
			'scenes',
			async () => 3,
			(r) => r ?? 0
		);
		await expect(
			measureSync(
				'download',
				undefined,
				async () => {
					throw new Error('x');
				},
				() => 0
			)
		).rejects.toThrow('x');
		const [failed, succeeded] = getSyncMetrics();
		expect(succeeded).toMatchObject({ kind: 'applyRealtime', label: 'scenes', count: 3, ok: true });
		expect(failed).toMatchObject({ kind: 'download', ok: false });
	});
});
