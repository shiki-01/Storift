import { describe, it, expect } from 'vitest';
import {
	planDownload,
	classifyLocalOnly,
	canDetectRemoteDeletion,
	chunkBatches,
	DIFF_SAFETY_MARGIN_MS,
	FULL_SYNC_INTERVAL_MS,
	type DownloadPlanInput
} from './syncPlan';
import type { EntityType } from './sync';

const TYPES: EntityType[] = ['projects', 'scenes'];
const NOW = 10 * 24 * 60 * 60 * 1000;
const base = (over: Partial<DownloadPlanInput> = {}): DownloadPlanInput => ({
	now: NOW,
	trigger: 'periodic',
	types: TYPES,
	lastFullSyncAt: NOW - 60 * 1000,
	lastSyncTimes: { projects: NOW - 120 * 1000, scenes: NOW - 120 * 1000 },
	localCounts: { projects: 3, scenes: 50 },
	...over
});

describe('planDownload', () => {
	it('通常のトリガは安全マージンを引いた差分取得になる', () => {
		const plan = planDownload(base());
		expect(plan.scenes).toEqual({ mode: 'diff', since: NOW - 120 * 1000 - DIFF_SAFETY_MARGIN_MS });
		expect(plan.projects.mode).toBe('diff');
	});

	it('起動時でも前回の完全同期から6時間未満なら差分取得', () => {
		const plan = planDownload(
			base({ trigger: 'startup', lastFullSyncAt: NOW - FULL_SYNC_INTERVAL_MS + 1000 })
		);
		expect(plan.scenes.mode).toBe('diff');
	});

	it('起動時に前回の完全同期から6時間以上、または未実施なら完全取得', () => {
		expect(
			planDownload(base({ trigger: 'startup', lastFullSyncAt: NOW - FULL_SYNC_INTERVAL_MS })).scenes
				.mode
		).toBe('full');
		expect(planDownload(base({ trigger: 'startup', lastFullSyncAt: undefined })).scenes.mode).toBe(
			'full'
		);
	});

	it('定期・タブ表示などの通常トリガは、6時間を過ぎていても完全取得にしない', () => {
		const plan = planDownload(base({ lastFullSyncAt: NOW - 100 * FULL_SYNC_INTERVAL_MS }));
		expect(plan.scenes.mode).toBe('diff');
	});

	it('手動の完全同期は常に完全取得', () => {
		const plan = planDownload(base({ trigger: 'manual-full' }));
		expect(plan.projects).toEqual({ mode: 'full' });
		expect(plan.scenes).toEqual({ mode: 'full' });
	});

	it('型の最終同期時刻が無い、またはローカルが0件の型は完全取得', () => {
		const plan = planDownload(
			base({ lastSyncTimes: { projects: NOW - 1000 }, localCounts: { projects: 0, scenes: 5 } })
		);
		expect(plan.projects.mode).toBe('full');
		expect(plan.scenes.mode).toBe('full');
	});
});

describe('classifyLocalOnly(削除判定)', () => {
	const none = () => false;

	it('差分取得ではリモートに無いローカルデータがあっても削除・アップロードを判定しない', () => {
		const plan = { mode: 'diff' as const, since: 1 };
		expect(canDetectRemoteDeletion(plan)).toBe(false);
		const result = classifyLocalOnly(plan, ['a', 'b', 'c'], new Set(['a']), none, () => true);
		expect(result).toEqual({ removals: [], uploads: [] });
	});

	it('完全取得では、同期済みは削除・未同期はアップロードに分類する', () => {
		const result = classifyLocalOnly(
			{ mode: 'full' },
			['kept', 'synced-gone', 'new-local', 'pending'],
			new Set(['kept']),
			(id) => id === 'pending',
			(id) => id === 'synced-gone'
		);
		expect(result).toEqual({ removals: ['synced-gone'], uploads: ['new-local'] });
	});
});

describe('chunkBatches', () => {
	const items = (n: number, size = 1) => Array.from({ length: n }, (_, i) => ({ i, size }));

	it('500件ごとに分割し、順序を保つ', () => {
		const batches = chunkBatches(items(1200));
		expect(batches.map((b) => b.length)).toEqual([500, 500, 200]);
		expect(batches.flat().map((x) => x.i)).toEqual(Array.from({ length: 1200 }, (_, i) => i));
	});

	it('サイズ上限でも分割し、上限超過の1件は単独になる', () => {
		const batches = chunkBatches(
			[...items(3, 40), { i: 99, size: 500 }, ...items(1, 10)],
			500,
			100
		);
		expect(batches.map((b) => b.map((x) => x.size))).toEqual([[40, 40], [40], [500], [10]]);
	});

	it('空なら空', () => {
		expect(chunkBatches([])).toEqual([]);
	});
});
