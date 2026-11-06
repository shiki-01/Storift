import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	getBase,
	setBase,
	removeBase,
	flushSyncMeta,
	pendingKey,
	targetOf,
	loadPendingChanges,
	loadSyncState,
	saveSyncState,
	getTargetState,
	withTargetState,
	withoutTargetState
} from './syncMeta';

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

describe('ターゲットを区別する base・pending・同期状態', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
	});
	afterEach(() => {
		flushSyncMeta();
		vi.useRealTimers();
	});

	it('同じ id が別ターゲットにあっても base が衝突しない', () => {
		setBase('scenes', 's1', 100);
		setBase('scenes', 's1', 200, 'shared/p1');
		expect(getBase('scenes', 's1')).toBe(100);
		expect(getBase('scenes', 's1', 'primary')).toBe(100);
		expect(getBase('scenes', 's1', 'shared/p1')).toBe(200);
		expect(getBase('scenes', 's1', 'shared/p2')).toBeUndefined();

		removeBase('scenes', 's1', 'shared/p1');
		expect(getBase('scenes', 's1', 'shared/p1')).toBeUndefined();
		expect(getBase('scenes', 's1')).toBe(100);
	});

	it('primary の base は従来のキー(type/id)のまま保存される', () => {
		setBase('chapters', 'c1', 5);
		setBase('chapters', 'c1', 6, 'shared/p1');
		flushSyncMeta();
		const saved = JSON.parse(localStorage.getItem('storift_sync_base')!);
		expect(saved['chapters/c1']).toBe(5);
		expect(saved['shared/p1|chapters/c1']).toBe(6);
	});

	it('pending のキーはターゲットを含む。target なし(旧形式)は primary と同じキー', () => {
		const legacy = { type: 'scenes' as const, id: 's1', action: 'update' as const };
		expect(pendingKey(legacy)).toBe('scenes/s1');
		expect(pendingKey({ ...legacy, target: 'primary' })).toBe('scenes/s1');
		expect(pendingKey({ ...legacy, target: 'shared/p1' })).toBe('shared/p1|scenes/s1');
		expect(targetOf(legacy)).toBe('primary');
	});

	it('旧形式の pending を読み込むと primary として扱う', () => {
		localStorage.setItem(
			'storift_sync_pending',
			JSON.stringify([
				{ type: 'scenes', id: 's1', action: 'delete' },
				{ type: 'scenes', id: 's2', action: 'update', target: 'shared/p1' }
			])
		);
		const loaded = loadPendingChanges();
		expect(loaded.map((c) => c.target)).toEqual(['primary', 'shared/p1']);
	});

	it('旧形式の同期状態を読み込め、ターゲットごとの状態を更新しても primary は保たれる', () => {
		localStorage.setItem(
			'storift_sync_state',
			JSON.stringify({ lastFullSyncAt: 10, lastSyncTimes: { scenes: 5 } })
		);
		let state = loadSyncState();
		expect(state.targets).toEqual({});
		expect(getTargetState(state, 'primary')).toEqual({
			lastFullSyncAt: 10,
			lastSyncTimes: { scenes: 5 }
		});
		expect(getTargetState(state, 'shared/p1')).toEqual({ lastSyncTimes: {} });

		state = withTargetState(state, 'shared/p1', {
			lastFullSyncAt: 20,
			lastSyncTimes: { scenes: 9 }
		});
		expect(getTargetState(state, 'primary').lastSyncTimes).toEqual({ scenes: 5 });
		expect(getTargetState(state, 'shared/p1').lastSyncTimes).toEqual({ scenes: 9 });

		saveSyncState(state);
		expect(loadSyncState()).toEqual(state);

		state = withoutTargetState(state, 'shared/p1');
		expect(state.targets).toEqual({});
	});
});
