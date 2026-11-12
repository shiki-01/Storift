import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type TimerInfo } from './client';
import {
	DEFAULT_SETTINGS,
	MonologSessionManager,
	buildTitle,
	formatMemo,
	toOffsetIso,
	type MonologSettings
} from './session';
import type { SceneUpdatedEvent } from '$lib/extensions/events';

const T0 = new Date('2026-11-12T01:00:00.000Z').getTime();
const MIN = 60_000;

function ev(over: Partial<SceneUpdatedEvent> = {}): SceneUpdatedEvent {
	return {
		sceneId: 's1',
		chapterId: 'c1',
		projectId: 'p1',
		characterCount: 110,
		previousCharacterCount: 100,
		...over
	};
}

function setup(settings: Partial<MonologSettings> = {}) {
	const cfg: MonologSettings = { ...DEFAULT_SETTINGS, ...settings };
	const client = {
		startTimer: vi.fn(
			async (_tag?: string): Promise<TimerInfo> => ({
				status: 'running',
				startedAt: '2026-11-12T10:00:00+09:00',
				elapsedMs: 0,
				tagName: '執筆'
			})
		),
		getTimer: vi.fn(
			async (): Promise<TimerInfo> => ({
				status: 'running',
				startedAt: '2026-11-12T10:00:00+09:00',
				elapsedMs: 0,
				tagName: '執筆'
			})
		),
		stopTimer: vi.fn(async (_input: { title: string; memo: string }) => {}),
		createRecord: vi.fn(async (_input: unknown) => {}),
		sendKeepalive: vi.fn((_path: string, _body: Record<string, unknown>) => true)
	};
	const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
	const onActiveChange = vi.fn();
	const manager = new MonologSessionManager({
		client,
		getSettings: () => cfg,
		getProjectTitle: async () => '月の庭',
		notify,
		onActiveChange,
		now: () => Date.now()
	});
	return { manager, client, notify, onActiveChange, cfg };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('整形', () => {
	it('memo は符号付きの増減文字数に (Storift) を添える', () => {
		expect(formatMemo(1234)).toBe('+1,234字 (Storift)');
		expect(formatMemo(-120)).toBe('-120字 (Storift)');
		expect(formatMemo(0)).toBe('+0字 (Storift)');
	});

	it('title は既定が「執筆(Storift)」、作品名を送る設定なら「作品名を執筆」', () => {
		expect(buildTitle('月の庭', false)).toBe('執筆(Storift)');
		expect(buildTitle('月の庭', true)).toBe('月の庭を執筆');
		expect(buildTitle(undefined, true)).toBe('執筆(Storift)');
		expect(buildTitle('  ', true)).toBe('執筆(Storift)');
	});

	it('オフセット付きの ISO 8601 にする(同じ時刻に戻せる)', () => {
		const iso = toOffsetIso(T0);
		expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		expect(Date.parse(iso)).toBe(T0);
	});
});

describe('タイマー方式', () => {
	it('最初の編集で /timer/start、無操作で GET /timer の検証後に /timer/stop。/records は呼ばない', async () => {
		const { manager, client, onActiveChange } = setup({ idleMinutes: 5 });
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		expect(client.startTimer).toHaveBeenCalledWith('執筆');
		expect(onActiveChange).toHaveBeenCalledWith(true);
		expect(manager.active).toBe(true);

		await vi.advanceTimersByTimeAsync(4 * MIN);
		expect(client.stopTimer).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(MIN);

		expect(client.getTimer).toHaveBeenCalledTimes(1);
		expect(client.stopTimer).toHaveBeenCalledWith({
			title: '執筆(Storift)',
			memo: '+10字 (Storift)'
		});
		expect(client.createRecord).not.toHaveBeenCalled();
		expect(onActiveChange).toHaveBeenLastCalledWith(false);
		expect(manager.active).toBe(false);
	});

	it('編集のたびに無操作の時間が延びる。文字数は増減の合計(複数シーン・減少を含む)', async () => {
		const { manager, client } = setup({ idleMinutes: 5 });
		manager.handleSceneUpdated(ev({ characterCount: 150, previousCharacterCount: 100 })); // +50
		await vi.advanceTimersByTimeAsync(4 * MIN);
		manager.handleSceneUpdated(
			ev({ sceneId: 's2', characterCount: 10, previousCharacterCount: 70 }) // -60
		);
		await vi.advanceTimersByTimeAsync(4 * MIN);
		manager.handleSceneUpdated(ev({ characterCount: 160, previousCharacterCount: 150 })); // +10
		await vi.advanceTimersByTimeAsync(4 * MIN);
		expect(client.stopTimer).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(MIN);
		expect(client.stopTimer).toHaveBeenCalledWith(
			expect.objectContaining({ memo: '+0字 (Storift)' })
		);
		expect(client.startTimer).toHaveBeenCalledTimes(1);
	});

	it('無操作時間の設定(15 分)に従う', async () => {
		const { manager, client } = setup({ idleMinutes: 15 });
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(14 * MIN);
		expect(client.getTimer).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(MIN);
		expect(client.stopTimer).toHaveBeenCalled();
	});

	it('作品名を送る設定ならタイトルに作品名を使い、タグ名の設定をタイマーの開始に渡す', async () => {
		const { manager, client } = setup({ sendProjectTitle: true, tagName: '小説' });
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(client.startTimer).toHaveBeenCalledWith('小説');
		expect(client.stopTimer).toHaveBeenCalledWith(
			expect.objectContaining({ title: '月の庭を執筆' })
		);
	});

	it('停止前の GET /timer が別のタイマー(started_at 違い)なら停止せず、破棄を通知する', async () => {
		const { manager, client, notify } = setup();
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		client.getTimer.mockResolvedValueOnce({
			status: 'running',
			startedAt: '2026-11-12T10:30:00+09:00',
			elapsedMs: 0,
			tagName: '別'
		});
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(client.stopTimer).not.toHaveBeenCalled();
		expect(notify.info).toHaveBeenCalled();
		expect(manager.active).toBe(false);
	});

	it('停止前の GET /timer が idle(すでに止められている)でも停止しない', async () => {
		const { manager, client, notify } = setup();
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		client.getTimer.mockResolvedValueOnce({
			status: 'idle',
			startedAt: null,
			elapsedMs: 0,
			tagName: null
		});
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(client.stopTimer).not.toHaveBeenCalled();
		expect(notify.info).toHaveBeenCalled();
	});

	it('表記が違っても同じ時刻なら同一のタイマーとして停止する', async () => {
		const { manager, client } = setup();
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		client.getTimer.mockResolvedValueOnce({
			status: 'running',
			startedAt: '2026-11-12T01:00:00Z',
			elapsedMs: 0,
			tagName: null
		});
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(client.stopTimer).toHaveBeenCalled();
	});

	it('開始で 409 timer_already_running: 乗っ取らず、そのセッションはスキップして通知する', async () => {
		const { manager, client, notify, onActiveChange } = setup();
		client.startTimer.mockRejectedValueOnce(new ApiError(409, 'timer_already_running', 'x'));
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		expect(notify.info).toHaveBeenCalledTimes(1);
		expect(onActiveChange).not.toHaveBeenCalledWith(true);

		// 同じセッション中の編集では、再試行も追加の通知もしない
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(client.startTimer).toHaveBeenCalledTimes(1);
		expect(client.getTimer).not.toHaveBeenCalled();
		expect(client.stopTimer).not.toHaveBeenCalled();
		expect(notify.info).toHaveBeenCalledTimes(1);

		// 無操作で終わった後の次の編集では、新しいセッションとして開始を試みる
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		expect(client.startTimer).toHaveBeenCalledTimes(2);
		expect(manager.active).toBe(true);
	});

	it('停止で 409 timer_not_running は失敗扱いにせず通知する', async () => {
		const { manager, client, notify } = setup();
		client.stopTimer.mockRejectedValueOnce(new ApiError(409, 'timer_not_running', 'x'));
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(notify.info).toHaveBeenCalled();
		expect(notify.error).not.toHaveBeenCalled();
	});

	it('前のセッションの停止が終わってから、次のセッションを開始する', async () => {
		const { manager, client } = setup();
		const order: string[] = [];
		client.stopTimer.mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 1000));
			order.push('stop');
		});
		client.startTimer.mockImplementation(async () => {
			order.push('start');
			return {
				status: 'running',
				startedAt: '2026-11-12T10:00:00+09:00',
				elapsedMs: 0,
				tagName: null
			};
		});
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(5 * MIN);
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(2000);
		expect(order).toEqual(['start', 'stop', 'start']);
	});

	it('「いま終了して記録する」で即座に終了する', async () => {
		const { manager, client } = setup();
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		expect(await manager.finish('manual')).toBe('recorded');
		expect(client.stopTimer).toHaveBeenCalledTimes(1);
		expect(await manager.finish('manual')).toBe('none');
	});

	it('開始の応答を待つ間に終了しても、開始したタイマーを止める', async () => {
		const { manager, client } = setup();
		let resolveStart!: (v: unknown) => void;
		client.startTimer.mockImplementation(
			() =>
				new Promise((r) => {
					resolveStart = r;
				}) as never
		);
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		const done = manager.finish('manual');
		resolveStart({
			status: 'running',
			startedAt: '2026-11-12T10:00:00+09:00',
			elapsedMs: 0,
			tagName: null
		});
		expect(await done).toBe('recorded');
		expect(client.stopTimer).toHaveBeenCalledTimes(1);
	});
});

describe('記録方式', () => {
	it('終了時に /records だけを呼ぶ。タイマーには触れない', async () => {
		const { manager, client } = setup({ mode: 'record', idleMinutes: 10 });
		manager.handleSceneUpdated(ev({ characterCount: 1334, previousCharacterCount: 100 }));
		expect(manager.active).toBe(true);
		await vi.advanceTimersByTimeAsync(3 * MIN);
		manager.handleSceneUpdated(ev({ characterCount: 1334, previousCharacterCount: 1334 }));
		await vi.advanceTimersByTimeAsync(10 * MIN);

		expect(client.createRecord).toHaveBeenCalledTimes(1);
		const input = client.createRecord.mock.calls[0][0] as Record<string, unknown>;
		expect(input).toMatchObject({
			title: '執筆(Storift)',
			memo: '+1,234字 (Storift)',
			tagName: '執筆',
			// 無操作で終わるときの終了時刻は、最後の編集の時刻
			durationMs: 3 * MIN
		});
		expect(Date.parse(input.startedAt as string)).toBe(T0);
		expect(Date.parse(input.endedAt as string)).toBe(T0 + 3 * MIN);
		expect(client.startTimer).not.toHaveBeenCalled();
		expect(client.getTimer).not.toHaveBeenCalled();
		expect(client.stopTimer).not.toHaveBeenCalled();
	});

	it('失敗は通知のみで、例外を外に出さない', async () => {
		const { manager, client, notify } = setup({ mode: 'record' });
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		client.createRecord.mockRejectedValueOnce(new Error('network'));
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(notify.error).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('pagehide', () => {
	it('タイマー方式: keepalive で /timer/stop を送る(GET /timer は呼ばない)', async () => {
		const { manager, client } = setup();
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		manager.flushOnHide();
		expect(client.sendKeepalive).toHaveBeenCalledWith('/timer/stop', {
			title: '執筆(Storift)',
			memo: '+10字 (Storift)'
		});
		expect(client.getTimer).not.toHaveBeenCalled();
		expect(manager.active).toBe(false);
		// 無操作タイマーが残っていても二重に送らない
		await vi.advanceTimersByTimeAsync(10 * MIN);
		expect(client.stopTimer).not.toHaveBeenCalled();
		expect(client.sendKeepalive).toHaveBeenCalledTimes(1);
	});

	it('記録方式: keepalive で /records を送る', async () => {
		const { manager, client } = setup({ mode: 'record' });
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(2 * MIN);
		manager.flushOnHide();
		expect(client.sendKeepalive).toHaveBeenCalledWith(
			'/records',
			expect.objectContaining({ duration_ms: 2 * MIN, tag: { name: '執筆' } })
		);
	});

	it('計測中でなければ何も送らない', () => {
		const { manager, client } = setup();
		manager.flushOnHide();
		expect(client.sendKeepalive).not.toHaveBeenCalled();
	});

	it('作品名を送る設定でも、取得済みの作品名をタイトルに使う', async () => {
		const { manager, client } = setup({ sendProjectTitle: true });
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		manager.flushOnHide();
		expect(client.sendKeepalive).toHaveBeenCalledWith(
			'/timer/stop',
			expect.objectContaining({ title: '月の庭を執筆' })
		);
	});
});

describe('dispose', () => {
	it('拡張の無効化で計測中のセッションを終了する', async () => {
		const { manager, client } = setup();
		manager.handleSceneUpdated(ev());
		await vi.advanceTimersByTimeAsync(0);
		await manager.dispose();
		expect(client.stopTimer).toHaveBeenCalledTimes(1);
	});
});
