import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter, type WritingSessionEvent } from '$lib/extensions/events';
import { DiscordPresenceController, type PresenceStatus } from './controller';
import { DEFAULT_SETTINGS } from './settings.svelte';
import type { DiscordSettings, PresenceActivity } from './presence';

const T0 = new Date('2026-11-12T01:00:00.000Z').getTime();
const SEC = 1000;

function sessionEvent(over: Partial<WritingSessionEvent> = {}): WritingSessionEvent {
	return {
		sessionId: 's1',
		startedAt: T0,
		lastEditAt: T0,
		endedAt: null,
		netChars: 10,
		projectId: 'p1',
		...over
	};
}

function setup(settings: Partial<DiscordSettings> = {}, opts: { discord?: boolean } = {}) {
	const cfg = { ...DEFAULT_SETTINGS, ...settings };
	const state = { discord: opts.discord ?? true };
	const sent: Array<{ id: string; activity: PresenceActivity }> = [];
	const transport = {
		set: vi.fn(async (id: string, activity: PresenceActivity) => {
			if (!state.discord) return false;
			sent.push({ id, activity });
			return true;
		}),
		clear: vi.fn(async () => {})
	};
	const events = new EventEmitter();
	const statuses: PresenceStatus[] = [];
	const controller = new DiscordPresenceController({
		transport,
		getSettings: () => cfg,
		getProjectTitle: vi.fn(async () => '月の庭'),
		getProjectCharCount: vi.fn(async () => 12345),
		onStatusChange: (s) => statuses.push(s)
	});
	controller.attach(events);
	controller.start({ page: { page: 'home' }, visible: true, session: null });
	return { controller, events, transport, sent, state, statuses, cfg };
}

const last = (sent: Array<{ activity: PresenceActivity }>) => sent[sent.length - 1].activity;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('DiscordPresenceController', () => {
	it('有効にした時点で、いまの画面を表示する(Application ID は既定の ID)', async () => {
		const { sent, statuses } = setup();
		await vi.advanceTimersByTimeAsync(0);
		expect(sent).toHaveLength(1);
		expect(sent[0].id).toBe('1570411903996661791');
		expect(sent[0].activity).toMatchObject({ details: 'ホーム', state: '', smallImage: '' });
		expect(statuses).toEqual(['shown']);
	});

	it('設定の Application ID で上書きできる', async () => {
		const { sent } = setup({ applicationId: '1234567890123456789' });
		await vi.advanceTimersByTimeAsync(0);
		expect(sent[0].id).toBe('1234567890123456789');
	});

	it('画面を移動すると表示が変わる。続けた移動は間隔を空けて最後の内容だけ送る', async () => {
		const { events, sent } = setup();
		await vi.advanceTimersByTimeAsync(0);
		events.emit('page:change', { page: 'plot', projectId: 'p1' });
		events.emit('page:change', { page: 'characters', projectId: 'p1' });
		events.emit('page:change', { page: 'progress', projectId: 'p1' });
		await vi.advanceTimersByTimeAsync(0);
		expect(sent).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(5 * SEC);
		expect(sent).toHaveLength(2);
		expect(last(sent).details).toBe('進捗を見ています');
	});

	it('執筆セッション中は State と小さい画像を足し、終了で外す', async () => {
		const { events, sent } = setup();
		await vi.advanceTimersByTimeAsync(0);
		events.emit('page:change', { page: 'editor', projectId: 'p1' });
		await vi.advanceTimersByTimeAsync(5 * SEC);
		events.emit('session:start', sessionEvent({ startedAt: T0 + 5 * SEC, netChars: 3 }));
		await vi.advanceTimersByTimeAsync(5 * SEC);
		expect(last(sent)).toMatchObject({
			details: '執筆中',
			state: '+3 字',
			smallImage: 'writing',
			startTimestamp: (T0 + 5 * SEC) / 1000
		});
		events.emit('session:end', sessionEvent({ reason: 'idle', endedAt: T0 }));
		await vi.advanceTimersByTimeAsync(5 * SEC);
		expect(last(sent)).toMatchObject({ details: '執筆中', state: '', smallImage: '' });
	});

	it('同じ内容なら送り直さない', async () => {
		const { events, sent } = setup();
		await vi.advanceTimersByTimeAsync(0);
		events.emit('page:change', { page: 'home' });
		await vi.advanceTimersByTimeAsync(10 * SEC);
		expect(sent).toHaveLength(1);
	});

	it('作品名・総文字数は、オンで、テンプレートが使っているときだけ取得して入れる', async () => {
		const off = setup({ detailsTemplate: '『{project}』を{page}' });
		off.events.emit('page:change', { page: 'editor', projectId: 'p1' });
		await vi.advanceTimersByTimeAsync(5 * SEC);
		expect(last(off.sent).details).toBe('執筆中');

		const on = setup({
			showProjectTitle: true,
			showTotalChars: true,
			detailsTemplate: '『{project}』を{page}',
			stateTemplate: '{total} 字'
		});
		on.events.emit('page:change', { page: 'editor', projectId: 'p1' });
		on.events.emit('session:start', sessionEvent());
		await vi.advanceTimersByTimeAsync(5 * SEC);
		expect(last(on.sent)).toMatchObject({ details: '『月の庭』を執筆中', state: '12,345 字' });
	});

	describe('前面にないとき', () => {
		it('keep(既定): 表示を続ける', async () => {
			const { events, sent, transport } = setup();
			await vi.advanceTimersByTimeAsync(0);
			events.emit('app:visibility', { visible: false });
			await vi.advanceTimersByTimeAsync(10 * SEC);
			expect(transport.clear).not.toHaveBeenCalled();
			expect(sent).toHaveLength(1);
		});

		it('clear: 消し、戻ったら再び表示する', async () => {
			const { events, sent, transport } = setup({ whenHidden: 'clear' });
			await vi.advanceTimersByTimeAsync(0);
			events.emit('app:visibility', { visible: false });
			await vi.advanceTimersByTimeAsync(5 * SEC);
			expect(transport.clear).toHaveBeenCalledTimes(1);
			events.emit('app:visibility', { visible: true });
			await vi.advanceTimersByTimeAsync(5 * SEC);
			expect(sent).toHaveLength(2);
		});

		it('away: 「離席中」にする', async () => {
			const { events, sent } = setup({ whenHidden: 'away' });
			await vi.advanceTimersByTimeAsync(0);
			events.emit('app:visibility', { visible: false });
			await vi.advanceTimersByTimeAsync(5 * SEC);
			expect(last(sent).details).toBe('離席中');
		});
	});

	describe('Discord が起動していないとき', () => {
		it('静かに何もしない(例外なし)。同じ間は試さず、新しい執筆セッションの開始でつなぎ直す', async () => {
			const { events, transport, state, statuses } = setup({}, { discord: false });
			await vi.advanceTimersByTimeAsync(0);
			expect(transport.set).toHaveBeenCalledTimes(1);
			expect(statuses).toEqual(['unavailable']);

			// 画面を移動しても、しばらくは試さない
			events.emit('page:change', { page: 'plot', projectId: 'p1' });
			await vi.advanceTimersByTimeAsync(10 * SEC);
			expect(transport.set).toHaveBeenCalledTimes(1);

			// 新しい執筆セッションの開始では試す(Discord が起動していれば表示される)
			state.discord = true;
			events.emit('session:start', sessionEvent());
			await vi.advanceTimersByTimeAsync(5 * SEC);
			expect(transport.set).toHaveBeenCalledTimes(2);
			expect(statuses).toEqual(['unavailable', 'shown']);
		});

		it('一定時間たてば、画面の移動の更新でつなぎ直す', async () => {
			const { events, transport, state } = setup({}, { discord: false });
			await vi.advanceTimersByTimeAsync(0);
			state.discord = true;
			await vi.advanceTimersByTimeAsync(60 * SEC);
			events.emit('page:change', { page: 'plot', projectId: 'p1' });
			await vi.advanceTimersByTimeAsync(5 * SEC);
			expect(transport.set).toHaveBeenCalledTimes(2);
		});

		it('transport が例外を投げても止まらない(渡せなかった扱いにする)', async () => {
			const t = setup({}, { discord: true });
			t.transport.set.mockRejectedValueOnce(new Error('ipc'));
			await vi.advanceTimersByTimeAsync(5 * SEC);
			expect(t.statuses).toEqual(['unavailable']);
		});
	});

	it('停止すると表示を消し、以後は送らない', async () => {
		const { controller, events, transport, sent } = setup();
		await vi.advanceTimersByTimeAsync(0);
		await controller.stop();
		expect(transport.clear).toHaveBeenCalledTimes(1);
		events.emit('page:change', { page: 'plot', projectId: 'p1' });
		await vi.advanceTimersByTimeAsync(10 * SEC);
		expect(sent).toHaveLength(1);
	});

	it('設定の変更はすぐに反映する', async () => {
		const { controller, cfg, sent } = setup();
		await vi.advanceTimersByTimeAsync(0);
		cfg.detailsTemplate = '{page}です';
		controller.settingsChanged();
		await vi.advanceTimersByTimeAsync(0);
		expect(last(sent).details).toBe('ホームです');
	});
});
