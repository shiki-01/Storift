import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../events';
import type { ExtensionPermissions } from '../manifest';
import { ScriptBridge, type BridgeEnv, type StopReason } from './bridge';
import { SCRIPT_LIMITS } from './limits';
import type { HostMessage } from './protocol';
import { ScriptStorage, type ScriptStorageBackend } from './storage';

function setup(permissions: ExtensionPermissions, chars = 1234) {
	const emitter = new EventEmitter();
	const sent: HostMessage[] = [];
	const notices: string[] = [];
	const uis: unknown[] = [];
	const stops: { reason: StopReason; detail?: string }[] = [];
	const data = new Map<string, Record<string, string>>();
	const backend: ScriptStorageBackend = {
		read: async (id) => data.get(id),
		write: async (id, items) => void data.set(id, items),
		remove: async (id) => void data.delete(id)
	};
	let now = 1_000_000;
	const env: BridgeEnv = {
		events: emitter,
		getProjectCharCount: async () => chars,
		storage: new ScriptStorage('t', backend),
		notify: (m) => notices.push(m),
		setUi: (target, tree) => uis.push([target, tree]),
		send: (m) => sent.push(m),
		stop: (reason, detail) => stops.push({ reason, detail }),
		now: () => now
	};
	const bridge = new ScriptBridge(permissions, env);
	let id = 0;
	const req = (m: string, a?: unknown) => {
		const rid = ++id;
		bridge.handle({ t: 'req', id: rid, m, a });
		return rid;
	};
	const flush = () => new Promise((r) => setTimeout(r, 0));
	const reply = (rid: number) =>
		sent.find((x) => x.t === 'res' && x.id === rid) as
			| Extract<HostMessage, { t: 'res' }>
			| undefined;
	return {
		bridge,
		emitter,
		sent,
		notices,
		uis,
		stops,
		req,
		flush,
		reply,
		tick: (ms: number) => (now += ms)
	};
}

const session = (over = {}) => ({
	sessionId: 's',
	startedAt: 1,
	lastEditAt: 2,
	endedAt: 3,
	netChars: 5,
	projectId: 'p',
	projectTitle: '作品',
	...over
});

describe('ScriptBridge の権限', () => {
	it('宣言していないイベントの購読は拒否し、宣言したものは届く(作品名は権限があるときだけ)', async () => {
		const t = setup({ events: ['session:end'] });
		const denied = t.req('events.on', { name: 'session:start' });
		const ok = t.req('events.on', { name: 'session:end' });
		await t.flush();
		expect(t.reply(denied)).toMatchObject({ ok: false, code: 'permission' });
		expect(t.reply(ok)).toMatchObject({ ok: true });
		t.emitter.emit('session:start', session());
		t.emitter.emit('session:end', session());
		await t.flush();
		const events = t.sent.filter((m) => m.t === 'ev');
		expect(events).toHaveLength(1);
		expect(JSON.stringify(events[0])).not.toContain('作品');
		expect(JSON.stringify(events[0])).not.toContain('projectChars');
	});

	it('project:title を宣言すると作品名が、project:chars を宣言すると総文字数が付く', async () => {
		const t = setup({ events: ['session:end'], read: ['project:title', 'project:chars'] });
		t.req('events.on', { name: 'session:end' });
		await t.flush();
		t.emitter.emit('session:end', session());
		await t.flush();
		expect(t.sent.find((m) => m.t === 'ev')).toMatchObject({
			p: { projectTitle: '作品', projectChars: 1234, netChars: 5 }
		});
	});

	it('総文字数だけ宣言したときは、作品名は付かない', async () => {
		const t = setup({ events: ['session:end'], read: ['project:chars'] });
		t.req('events.on', { name: 'session:end' });
		await t.flush();
		t.emitter.emit('session:end', session());
		await t.flush();
		const ev = t.sent.find((m) => m.t === 'ev') as { p: Record<string, unknown> };
		expect(ev.p.projectChars).toBe(1234);
		expect(ev.p).not.toHaveProperty('projectTitle');
	});

	it('解除すると届かなくなる', async () => {
		const t = setup({ events: ['page:change'] });
		t.req('events.on', { name: 'page:change' });
		await t.flush();
		t.req('events.off', { name: 'page:change' });
		await t.flush();
		t.emitter.emit('page:change', { page: 'write' } as never);
		await t.flush();
		expect(t.sent.filter((m) => m.t === 'ev')).toHaveLength(0);
	});

	it('storage / notify / ui は、宣言が無ければ拒否する', async () => {
		const t = setup({});
		const ids = [
			t.req('storage.get', { key: 'a' }),
			t.req('storage.set', { key: 'a', value: 1 }),
			t.req('notify', { message: 'x' }),
			t.req('ui.set', { target: 'panel', nodes: [] })
		];
		await t.flush();
		for (const id of ids) expect(t.reply(id)).toMatchObject({ ok: false, code: 'permission' });
		expect(t.notices).toEqual([]);
		expect(t.uis).toEqual([]);
	});

	it('storage / notify / ui は、宣言があれば使える', async () => {
		const t = setup({ storage: true, notify: true, ui: true });
		const set = t.req('storage.set', { key: 'a', value: { n: 1 } });
		await t.flush();
		const get = t.req('storage.get', { key: 'a' });
		const note = t.req('notify', { message: 'hi' });
		const ui = t.req('ui.set', { target: 'panel', nodes: [{ type: 'divider' }], badge: true });
		await t.flush();
		expect(t.reply(set)).toMatchObject({ ok: true });
		expect(t.reply(get)).toMatchObject({ ok: true, v: { n: 1 } });
		expect(t.reply(note)).toMatchObject({ ok: true });
		expect(t.notices).toEqual(['hi']);
		expect(t.reply(ui)).toMatchObject({ ok: true });
		expect(t.uis).toHaveLength(1);
	});

	it('UI の不正な記述は拒否する(前の画面は残る)', async () => {
		const t = setup({ ui: true });
		const bad = t.req('ui.set', {
			target: 'panel',
			nodes: [{ type: 'link', label: 'x', url: 'javascript:1' }]
		});
		await t.flush();
		expect(t.reply(bad)).toMatchObject({ ok: false, code: 'limit' });
		expect(t.uis).toEqual([]);
	});
});

describe('ScriptBridge の上限と停止', () => {
	it('通知は 1 分に 5 回まで、200 文字まで', async () => {
		const t = setup({ notify: true });
		const ids = Array.from({ length: 7 }, () => t.req('notify', { message: 'x' }));
		await t.flush();
		expect(ids.filter((id) => t.reply(id)?.ok)).toHaveLength(5);
		expect(t.reply(ids[6])).toMatchObject({ ok: false, code: 'rate' });
		t.tick(61_000);
		const later = t.req('notify', { message: 'x' });
		const long = t.req('notify', { message: 'あ'.repeat(201) });
		await t.flush();
		expect(t.reply(later)).toMatchObject({ ok: true });
		expect(t.reply(long)).toMatchObject({ ok: false, code: 'limit' });
	});

	it('メッセージが 1 秒に上限を超えると停止する(それ以降は無視)', async () => {
		const t = setup({ ui: true });
		for (let i = 1; i <= SCRIPT_LIMITS.messagesPerSecond + 1; i++) {
			t.req('events.off', { name: 'page:change' });
			await t.flush();
		}
		expect(t.stops).toEqual([{ reason: 'flood', detail: 'メッセージの数' }]);
		const before = t.sent.length;
		t.req('events.off', { name: 'page:change' });
		expect(t.sent.length).toBe(before);
		expect(t.stops).toHaveLength(1);
	});

	it('時間が経てばメッセージの数は数え直す', async () => {
		const t = setup({});
		for (let i = 0; i < SCRIPT_LIMITS.messagesPerSecond; i++) {
			t.req('events.off', { name: 'page:change' });
			await t.flush();
		}
		t.tick(1500);
		for (let i = 0; i < SCRIPT_LIMITS.messagesPerSecond; i++) {
			t.req('events.off', { name: 'page:change' });
			await t.flush();
		}
		expect(t.stops).toEqual([]);
	});

	it('画面の更新が 1 秒に上限を超えると停止する', async () => {
		const t = setup({ ui: true });
		for (let i = 0; i <= SCRIPT_LIMITS.uiUpdatesPerSecond; i++)
			t.req('ui.set', { target: 'panel', nodes: [] });
		await t.flush();
		expect(t.stops[0]?.reason).toBe('flood');
	});

	it('巨大なペイロードと不正な形は停止する', () => {
		const a = setup({ storage: true });
		a.bridge.handle({
			t: 'req',
			id: 1,
			m: 'storage.set',
			a: { key: 'k', value: 'x'.repeat(300_000) }
		});
		expect(a.stops[0]?.reason).toBe('oversize');
		const b = setup({});
		b.bridge.handle({ t: 'req', id: 1, m: 'host.eval', a: 'x' });
		expect(b.stops[0]?.reason).toBe('protocol');
		const c = setup({});
		c.bridge.handle('文字列');
		expect(c.stops[0]?.reason).toBe('protocol');
		const d = setup({});
		d.bridge.handle({ t: 'req', id: 1, m: 'notify', a: new Map() });
		expect(d.stops[0]?.reason).toBe('protocol');
	});

	it('応答待ちのリクエストが多すぎると停止する', () => {
		const t = setup({ storage: true });
		// 保存先が応答しない状態を作る
		for (let i = 0; i < SCRIPT_LIMITS.pendingRequests + 2; i++) t.req('storage.get', { key: 'k' });
		expect(t.stops[0]?.reason).toBe('flood');
	});

	it('権限違反や上限の超過を繰り返すと停止する', async () => {
		const t = setup({});
		for (let i = 0; i < SCRIPT_LIMITS.violationsBeforeStop + 2; i++) {
			t.req('storage.get', { key: 'a' });
			t.tick(50);
			await t.flush();
		}
		expect(t.stops[0]?.reason).toBe('violations');
		expect(t.stops).toHaveLength(1);
	});

	it('画面の操作は、記述にある要素だけをスクリプトへ渡す', async () => {
		const t = setup({ ui: true });
		t.req('ui.set', { target: 'panel', nodes: [{ type: 'button', id: 'go', label: 'Go' }] });
		await t.flush();
		t.bridge.sendUiEvent('panel', 'go', 'press');
		t.bridge.sendUiEvent('panel', 'nope', 'press');
		t.bridge.sendUiEvent('settings', 'go', 'press');
		expect(t.sent.filter((m) => m.t === 'ui')).toEqual([{ t: 'ui', id: 'go', kind: 'press' }]);
	});

	it('dispose のあとは何も受け付けず、購読も解除される', async () => {
		const t = setup({ events: ['page:change'] });
		t.req('events.on', { name: 'page:change' });
		await t.flush();
		t.bridge.dispose();
		t.emitter.emit('page:change', { page: 'write' } as never);
		t.req('notify');
		await t.flush();
		expect(t.sent.filter((m) => m.t === 'ev')).toHaveLength(0);
		expect(t.emitter.hasListeners('page:change')).toBe(false);
	});
});
