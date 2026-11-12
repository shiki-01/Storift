import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter, type SceneUpdatedEvent, type WritingSessionEvent } from './events';
import { WritingSessionTracker } from './session';

const T0 = new Date('2026-11-12T01:00:00.000Z').getTime();
const MIN = 60_000;

function scene(over: Partial<SceneUpdatedEvent> = {}): SceneUpdatedEvent {
	return {
		sceneId: 's1',
		chapterId: 'c1',
		projectId: 'p1',
		characterCount: 110,
		previousCharacterCount: 100,
		delta: 10,
		origin: 'user',
		...over
	};
}

function setup(idleMinutes = 5) {
	const events = new EventEmitter();
	let ids = 0;
	let hide = () => {};
	const hideOff = vi.fn();
	const tracker = new WritingSessionTracker({
		events,
		getIdleMinutes: () => idleMinutes,
		getProjectTitle: async (id) => (id === 'p1' ? '月の庭' : undefined),
		onPageHide: (cb) => {
			hide = cb;
			return hideOff;
		},
		newId: () => `id-${++ids}`
	});
	tracker.attach();
	const got: Array<[string, WritingSessionEvent]> = [];
	for (const name of ['session:start', 'session:update', 'session:end'] as const) {
		events.on(name, (e) => void got.push([name, e]));
	}
	return { events, tracker, got, hide: () => hide(), hideOff };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('WritingSessionTracker', () => {
	it('最初の編集で session:start、続く編集で session:update。増減は合計する', async () => {
		const { events, got } = setup();
		events.emit('scene:updated', scene({ delta: 10 }));
		expect(got.map(([n]) => n)).toEqual(['session:start']);
		expect(got[0][1]).toMatchObject({
			sessionId: 'id-1',
			startedAt: T0,
			lastEditAt: T0,
			endedAt: null,
			netChars: 10,
			projectId: 'p1'
		});

		await vi.advanceTimersByTimeAsync(MIN);
		events.emit('scene:updated', scene({ delta: -4 }));
		const last = got[got.length - 1];
		expect(last[0]).toBe('session:update');
		expect(last[1]).toMatchObject({ netChars: 6, lastEditAt: T0 + MIN, startedAt: T0 });
	});

	it('作品名は後から session:update で届く', async () => {
		const { events, got } = setup();
		events.emit('scene:updated', scene());
		expect(got[0][1].projectTitle).toBeUndefined();
		await vi.advanceTimersByTimeAsync(0);
		const last = got[got.length - 1][1];
		expect(got[got.length - 1][0]).toBe('session:update');
		expect(last.projectTitle).toBe('月の庭');
	});

	it('無操作時間(設定)が過ぎると session:end(reason: idle)。終了時刻は最後の編集の時刻', async () => {
		const { events, got, tracker } = setup(10);
		events.emit('scene:updated', scene());
		await vi.advanceTimersByTimeAsync(3 * MIN);
		events.emit('scene:updated', scene({ delta: 5 }));
		await vi.advanceTimersByTimeAsync(9 * MIN);
		expect(got.some(([n]) => n === 'session:end')).toBe(false);
		await vi.advanceTimersByTimeAsync(MIN);
		const end = got.find(([n]) => n === 'session:end')![1];
		expect(end).toMatchObject({ reason: 'idle', endedAt: T0 + 3 * MIN, netChars: 15 });
		expect(tracker.current()).toBeNull();
	});

	it('終了後の編集は新しいセッションになる', async () => {
		const { events, got } = setup();
		events.emit('scene:updated', scene());
		await vi.advanceTimersByTimeAsync(5 * MIN);
		events.emit('scene:updated', scene({ delta: 7 }));
		const starts = got.filter(([n]) => n === 'session:start').map(([, e]) => e);
		expect(starts.map((e) => e.sessionId)).toEqual(['id-1', 'id-2']);
		expect(starts[1].netChars).toBe(7);
	});

	it('AI の提案の適用(origin: ai)は、セッションを始めも延ばしもせず、数えもしない', async () => {
		const { events, got, tracker } = setup();
		events.emit('scene:updated', scene({ origin: 'ai', delta: 500 }));
		expect(got).toEqual([]);
		expect(tracker.current()).toBeNull();

		events.emit('scene:updated', scene({ delta: 10 }));
		await vi.advanceTimersByTimeAsync(4 * MIN);
		events.emit('scene:updated', scene({ origin: 'ai', delta: 500 })); // 無操作を延ばさない
		await vi.advanceTimersByTimeAsync(MIN);
		const end = got.find(([n]) => n === 'session:end')![1];
		expect(end.netChars).toBe(10);
	});

	it('共同編集で自分が書いた分(origin: collab-local)は数える', () => {
		const { events, got } = setup();
		events.emit('scene:updated', scene({ origin: 'collab-local', delta: 12 }));
		expect(got[0][1].netChars).toBe(12);
	});

	it('pagehide で session:end(reason: pagehide)。進行中でなければ何もしない', () => {
		const { events, got, hide } = setup();
		hide();
		expect(got).toEqual([]);
		events.emit('scene:updated', scene());
		hide();
		expect(got[got.length - 1][1]).toMatchObject({ reason: 'pagehide', endedAt: T0 });
	});

	it('end(manual) で終了する。二度目は false', () => {
		const { events, tracker, got } = setup();
		events.emit('scene:updated', scene());
		expect(tracker.end('manual')).toBe(true);
		expect(tracker.end('manual')).toBe(false);
		expect(got[got.length - 1][1].reason).toBe('manual');
	});

	it('作品を切り替えても同じセッションとして続く(projectId は開始した作品)', () => {
		const { events, got } = setup();
		events.emit('scene:updated', scene());
		events.emit('scene:updated', scene({ projectId: 'p2', delta: 3 }));
		const last = got[got.length - 1][1];
		expect(last).toMatchObject({ sessionId: 'id-1', projectId: 'p1', netChars: 13 });
	});

	describe('購読者がいないときは動かない', () => {
		it('セッションのイベントの購読者が 1 つも無ければ、scene:updated も pagehide も購読しない', () => {
			const events = new EventEmitter();
			const onPageHide = vi.fn(() => () => {});
			const tracker = new WritingSessionTracker({
				events,
				getIdleMinutes: () => 5,
				getProjectTitle: async () => undefined,
				onPageHide
			});
			tracker.attach();
			expect(tracker.tracking).toBe(false);
			expect(events.hasListeners('scene:updated')).toBe(false);
			expect(onPageHide).not.toHaveBeenCalled();
		});

		it('購読者が現れると動き、全員が解除すると止まって、進行中のセッションを捨てる', () => {
			const events = new EventEmitter();
			const hideOff = vi.fn();
			const tracker = new WritingSessionTracker({
				events,
				getIdleMinutes: () => 5,
				getProjectTitle: async () => undefined,
				onPageHide: () => hideOff
			});
			tracker.attach();
			const off = events.on('session:start', () => {});
			expect(tracker.tracking).toBe(true);
			expect(events.hasListeners('scene:updated')).toBe(true);
			events.emit('scene:updated', scene());
			expect(tracker.current()).not.toBeNull();

			off();
			expect(tracker.tracking).toBe(false);
			expect(events.hasListeners('scene:updated')).toBe(false);
			expect(hideOff).toHaveBeenCalledTimes(1);
			expect(tracker.current()).toBeNull();
			// 無操作タイマーも残らない
			expect(vi.getTimerCount()).toBe(0);
		});

		it('scene:updated だけを購読する拡張がいても、セッションの追跡は動かない', () => {
			const events = new EventEmitter();
			const tracker = new WritingSessionTracker({
				events,
				getIdleMinutes: () => 5,
				getProjectTitle: async () => undefined,
				onPageHide: () => () => {}
			});
			tracker.attach();
			events.on('scene:updated', () => {});
			expect(tracker.tracking).toBe(false);
		});
	});
});
