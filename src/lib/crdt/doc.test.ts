import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Firestore } from 'firebase/firestore';
import type { CrdtDocRow } from '$lib/types';
import { CrdtOpenError, createDocManager, type CrdtDeps, type DocManager } from './doc';
import type { CrdtPersistence } from './persistence';
import { groupUpdates } from './policy';
import type { CrdtTransport, RemoteUpdate, SnapshotData } from './transport';

// ---------- 模擬サーバー(Firestore の代わり) ----------

class FakeServer {
	snapshot: SnapshotData | null = null;
	updates = new Map<string, RemoteUpdate>();
	pushCalls = 0;
	compactCalls: { baseRev: number; deleteIds: string[] }[] = [];
	failPush: (Error & { code?: string }) | null = null;
	private nextId = 0;
	private updateListeners = new Set<(u: RemoteUpdate[]) => void>();
	private snapshotListeners = new Set<(s: SnapshotData) => void>();

	transport(): CrdtTransport {
		return {
			getSnapshot: async () => this.snapshot,
			initSnapshotIfAbsent: async (_db, _pid, _scene, buildState) => {
				if (this.snapshot) return { created: false, snapshot: this.snapshot };
				this.snapshot = { state: buildState(), updatedAt: 0, rev: 0 };
				return { created: true, snapshot: this.snapshot };
			},
			pushUpdates: async (_db, _pid, _scene, updates, meta) => {
				this.pushCalls++;
				if (this.failPush) throw this.failPush;
				const ids: string[] = [];
				const added: RemoteUpdate[] = [];
				let createdAt = meta.createdAt;
				for (const g of groupUpdates(updates)) {
					const id = `u${this.nextId++}`;
					const u = {
						id,
						update: g.update,
						createdAt: createdAt++,
						by: meta.by,
						clientId: meta.clientId
					};
					this.updates.set(id, u);
					ids.push(id);
					added.push(u);
				}
				for (const l of [...this.updateListeners]) l(added);
				return ids;
			},
			listenUpdates: (_db, _pid, _scene, since, onUpdates) => {
				const existing = [...this.updates.values()].filter((u) => u.createdAt > since);
				if (existing.length > 0) onUpdates(existing);
				this.updateListeners.add(onUpdates);
				return () => void this.updateListeners.delete(onUpdates);
			},
			listenSnapshot: (_db, _pid, _scene, onSnap) => {
				if (this.snapshot) onSnap(this.snapshot);
				this.snapshotListeners.add(onSnap);
				return () => void this.snapshotListeners.delete(onSnap);
			},
			compact: async (_db, _pid, _scene, args) => {
				this.compactCalls.push({ baseRev: args.baseRev, deleteIds: [...args.deleteIds] });
				if ((this.snapshot?.rev ?? 0) !== args.baseRev) return { ok: false, reason: 'stale' };
				const rev = args.baseRev + 1;
				this.snapshot = { state: args.state, updatedAt: 0, rev };
				for (const id of args.deleteIds) this.updates.delete(id);
				for (const l of [...this.snapshotListeners]) l(this.snapshot);
				return { ok: true, rev };
			}
		};
	}
}

// ---------- 端末(マネージャ + Dexie 相当の永続化 + シーンの行) ----------

const PROJECT = (role: 'owner' | 'editor' | 'viewer' = 'owner') => ({
	id: 'p1',
	sharing: {
		pid: 'p1',
		role,
		visibility: 'private' as const,
		status: 'active' as const,
		startedAt: 1
	}
});

class Device {
	rows = new Map<string, CrdtDocRow>();
	content: string;
	online = true;
	mirrored: string[] = [];
	backups = 0;
	denied = 0;
	errors: string[] = [];
	onlineCallbacks = new Set<() => void>();
	manager: DocManager;

	constructor(
		readonly server: FakeServer,
		content: string
	) {
		this.content = content;
		const persistence: CrdtPersistence = {
			load: async (id) => this.rows.get(id),
			save: async (row) => void this.rows.set(row.sceneId, row),
			remove: async (id) => void this.rows.delete(id),
			listWithPending: async () => [...this.rows.values()].filter((r) => r.pending !== null)
		};
		const deps: CrdtDeps = {
			transport: server.transport(),
			persistence,
			resolveDb: async () => ({}) as Firestore,
			getScene: async () => ({ content: this.content, projectId: 'p1' }),
			mirrorContent: async (_id, text) => {
				this.content = text;
				this.mirrored.push(text);
			},
			backupScene: async () => void this.backups++,
			currentUid: () => 'uid',
			onPermissionDenied: () => void this.denied++,
			onError: (m) => void this.errors.push(m),
			isOnline: () => this.online,
			onOnline: (cb) => {
				this.onlineCallbacks.add(cb);
				return () => void this.onlineCallbacks.delete(cb);
			},
			now: () => Date.now()
		};
		this.manager = createDocManager(deps);
	}

	goOnline() {
		this.online = true;
		for (const cb of [...this.onlineCallbacks]) cb();
	}
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_000_000);
});
afterEach(() => {
	vi.useRealTimers();
});

describe('初期化', () => {
	it('最初の端末が現在の content から snapshot を作り、2 台目はそれを読み込む(二重にならない)', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'こんにちは');
		const b = new Device(server, 'こんにちは');
		const [ha, hb] = await Promise.all([
			a.manager.openScene('s1', PROJECT()),
			b.manager.openScene('s1', PROJECT('editor'))
		]);
		expect(ha.ytext.toString()).toBe('こんにちは');
		expect(hb.ytext.toString()).toBe('こんにちは');
		expect(server.snapshot).not.toBeNull();
		// 互いに編集しても二重にならない
		ha.setText('こんにちは、世界');
		await tick(2600);
		expect(hb.ytext.toString()).toBe('こんにちは、世界');
	});

	it('負けた側のローカル content が CRDT の本文と違えば、上書きの前に退避してから採用する', async () => {
		const server = new FakeServer();
		const a = new Device(server, '最初の本文');
		await a.manager.openScene('s1', PROJECT());
		const b = new Device(server, 'B で書き足した本文');
		const hb = await b.manager.openScene('s1', PROJECT('editor'));
		expect(b.backups).toBe(1);
		expect(hb.ytext.toString()).toBe('最初の本文');
		await tick(2000);
		expect(b.content).toBe('最初の本文'); // ミラーで採用された
	});

	it('保存済みの状態があればオフラインでも開け、無ければ理由つきで失敗する', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'abc');
		const h = await a.manager.openScene('s1', PROJECT());
		await h.destroy();

		a.online = false;
		const again = await a.manager.openScene('s1', PROJECT());
		expect(again.ytext.toString()).toBe('abc');

		const fresh = new Device(server, 'abc');
		fresh.online = false;
		await expect(fresh.manager.openScene('s1', PROJECT())).rejects.toMatchObject({
			reason: 'offline'
		});
		await expect(fresh.manager.openScene('s1', PROJECT())).rejects.toBeInstanceOf(CrdtOpenError);
	});

	it('閲覧権限で snapshot が無ければ no-snapshot', async () => {
		const viewer = new Device(new FakeServer(), 'abc');
		await expect(viewer.manager.openScene('s1', PROJECT('viewer'))).rejects.toMatchObject({
			reason: 'no-snapshot'
		});
	});

	it('共有されていないプロジェクトは not-shared', async () => {
		const a = new Device(new FakeServer(), 'abc');
		await expect(a.manager.openScene('s1', { id: 'p1' })).rejects.toMatchObject({
			reason: 'not-shared'
		});
	});

	it('同じシーンを複数回開いても 1 つの文書を共有し、最後の参照で閉じる', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'abc');
		const h1 = await a.manager.openScene('s1', PROJECT());
		const h2 = await a.manager.openScene('s1', PROJECT());
		expect(h1.ydoc).toBe(h2.ydoc);
		await h1.destroy();
		expect(a.manager.isOpen('s1')).toBe(true);
		h2.setText('abcd');
		await h2.destroy();
		expect(a.manager.isOpen('s1')).toBe(false);
		expect(a.rows.get('s1')).toBeTruthy();
	});
});

describe('送受信', () => {
	it('ローカルの変更は 2.5 秒でまとめて 1 件の updates として送られ、相手に届く', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'x');
		const b = new Device(server, 'x');
		const ha = await a.manager.openScene('s1', PROJECT());
		const hb = await b.manager.openScene('s1', PROJECT('editor'));
		const remote = vi.fn();
		hb.onRemoteChange(remote);

		ha.setText('xy');
		ha.setText('xyz');
		ha.setText('xyz!');
		await tick(1000);
		expect(server.updates.size).toBe(0);
		await tick(1600);
		expect(server.updates.size).toBe(1);
		expect(server.pushCalls).toBe(1);
		expect(hb.ytext.toString()).toBe('xyz!');
		expect(remote).toHaveBeenCalledWith('xyz!');
	});

	it('同時編集が収束し、ミラーが Scene.content に反映される', async () => {
		const server = new FakeServer();
		const a = new Device(server, '吾輩は猫である');
		const b = new Device(server, '吾輩は猫である');
		const ha = await a.manager.openScene('s1', PROJECT());
		const hb = await b.manager.openScene('s1', PROJECT('editor'));

		ha.setText('吾輩は黒い猫である');
		hb.setText('吾輩は猫である。名前はまだ無い。');
		await tick(5000);
		expect(ha.ytext.toString()).toBe(hb.ytext.toString());
		expect(ha.ytext.toString()).toContain('黒い');
		expect(ha.ytext.toString()).toContain('名前はまだ無い');
		expect(a.content).toBe(ha.ytext.toString());
		expect(b.content).toBe(hb.ytext.toString());
	});

	it('オフラインの編集は pending に蓄積・永続化され、再接続で送られる', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'abc');
		const h = await a.manager.openScene('s1', PROJECT());
		a.online = false;
		h.setText('abcd');
		await tick(3000);
		h.setText('abcde');
		await tick(3000);
		expect(server.pushCalls).toBe(0);
		await tick(600);
		const row = a.rows.get('s1')!;
		expect(row.pending).not.toBeNull();
		// pending は 1 つにまとまっていて、適用すると編集後の本文になる
		const check = new Y.Doc();
		Y.applyUpdate(check, row.state);
		expect(check.getText('content').toString()).toBe('abcde');

		const b = new Device(server, 'abc');
		const hb = await b.manager.openScene('s1', PROJECT('editor'));
		a.goOnline();
		await tick(100);
		expect(server.updates.size).toBe(1);
		expect(hb.ytext.toString()).toBe('abcde');
		await tick(600);
		expect(a.rows.get('s1')!.pending).toBeNull();
	});

	it('起動後(新しいマネージャ)に永続化された state と pending から復元できる', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'abc');
		const h = await a.manager.openScene('s1', PROJECT());
		a.online = false;
		h.setText('abcdef');
		await tick(600);
		const rows = a.rows;

		const restarted = new Device(server, 'abc');
		restarted.rows = rows;
		restarted.online = false;
		const h2 = await restarted.manager.openScene('s1', PROJECT());
		expect(h2.ytext.toString()).toBe('abcdef');
		restarted.goOnline();
		await tick(100);
		expect(server.updates.size).toBe(1);
	});

	it('送信の失敗は pending に残して再試行し、成功したら消える', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'abc');
		const h = await a.manager.openScene('s1', PROJECT());
		server.failPush = Object.assign(new Error('unavailable'), { code: 'unavailable' });
		h.setText('abcd');
		await tick(2600);
		expect(server.pushCalls).toBe(1);
		expect(server.updates.size).toBe(0);
		server.failPush = null;
		await tick(3100);
		expect(server.pushCalls).toBe(2);
		expect(server.updates.size).toBe(1);
	});

	it('permission-denied は再試行せず、読み取り専用にして通知する', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'abc');
		const h = await a.manager.openScene('s1', PROJECT('editor'));
		const states: boolean[] = [];
		h.onReadOnlyChange((r) => states.push(r));
		server.failPush = Object.assign(new Error('denied'), { code: 'permission-denied' });
		h.setText('abcd');
		await tick(2600);
		expect(server.pushCalls).toBe(1);
		await tick(120_000);
		expect(server.pushCalls).toBe(1);
		expect(h.readOnly).toBe(true);
		expect(states).toEqual([true]);
		expect(a.denied).toBe(1);
		expect(h.setText('zzz')).toBe(false);
	});

	it('閲覧権限は送信せず、受信だけ行う', async () => {
		const server = new FakeServer();
		const a = new Device(server, 'abc');
		const v = new Device(server, 'abc');
		const ha = await a.manager.openScene('s1', PROJECT());
		const hv = await v.manager.openScene('s1', PROJECT('viewer'));
		expect(hv.readOnly).toBe(true);
		expect(hv.setText('hack')).toBe(false);
		// UI が止め損ねて Y を直接書いても送らない
		hv.ytext.insert(0, 'X');
		await tick(5000);
		expect(server.updates.size).toBe(0);

		ha.setText('abcd');
		await tick(2600);
		expect(hv.ytext.toString()).toContain('abcd');
	});

	it('ミラーは 1〜2 秒のデバウンスで 1 回にまとまる', async () => {
		const a = new Device(new FakeServer(), 'abc');
		const h = await a.manager.openScene('s1', PROJECT());
		h.setText('abc1');
		h.setText('abc12');
		h.setText('abc123');
		await tick(1600);
		expect(a.mirrored).toEqual(['abc123']);
	});
});

describe('圧縮', () => {
	async function edit(h: { setText(t: string): boolean }, text: string) {
		h.setText(text);
		await tick(2600);
	}

	it('適用済みの updates が 50 件になったら圧縮し、自分が適用済みのものだけ消す', async () => {
		const server = new FakeServer();
		const a = new Device(server, '');
		const h = await a.manager.openScene('s1', PROJECT());
		// 他端末が書いたが、A がまだ受信していない update(購読を介さず直接置く)
		const foreign = new Y.Doc();
		foreign.getText('content').insert(0, 'foreign');
		server.updates.set('foreign', {
			id: 'foreign',
			update: Y.encodeStateAsUpdate(foreign),
			createdAt: 1,
			by: 'x',
			clientId: 1
		});

		let text = '';
		for (let i = 0; i < 49; i++) {
			text += String.fromCharCode(0x3042 + (i % 20));
			await edit(h, text);
		}
		expect(server.compactCalls).toHaveLength(0);
		await edit(h, text + 'あ');
		expect(server.compactCalls).toHaveLength(1);
		const call = server.compactCalls[0];
		expect(call.deleteIds).toHaveLength(50);
		expect(call.deleteIds).not.toContain('foreign');
		expect(server.updates.has('foreign')).toBe(true);
		expect(server.updates.size).toBe(1);
		expect(server.snapshot!.rev).toBe(1);

		// 新しい端末は snapshot と残りの updates から同じ本文を復元する
		const c = new Device(server, 'ignored');
		const hc = await c.manager.openScene('s1', PROJECT('editor'));
		expect(hc.ytext.toString()).toContain(text + 'あ');
		expect(hc.ytext.toString()).toContain('foreign');
	});

	it('閉じる時は 10 件以上で圧縮する(9 件では圧縮しない)', async () => {
		const server = new FakeServer();
		const a = new Device(server, '');
		const h = await a.manager.openScene('s1', PROJECT());
		let text = '';
		for (let i = 0; i < 9; i++) {
			text += 'a';
			await edit(h, text);
		}
		await h.destroy();
		expect(server.compactCalls).toHaveLength(0);

		const h2 = await a.manager.openScene('s1', PROJECT());
		await edit(h2, text + 'b');
		await h2.destroy();
		expect(server.compactCalls).toHaveLength(1);
		expect(server.updates.size).toBe(0);
	});

	it('古い rev の圧縮は stale となり、snapshot を上書きしない', async () => {
		const server = new FakeServer();
		const a = new Device(server, '');
		const h = await a.manager.openScene('s1', PROJECT());
		await h.destroy();
		server.snapshot = { state: server.snapshot!.state, updatedAt: 0, rev: 5 };
		const before = server.snapshot;
		// rev 0 のつもりの端末が圧縮を試みても拒否される(サーバー側の判定)
		const result = await server
			.transport()
			.compact({} as Firestore, 'p1', 's1', { state: new Uint8Array(), baseRev: 0, deleteIds: [] });
		expect(result).toEqual({ ok: false, reason: 'stale' });
		expect(server.snapshot).toBe(before);
	});
});
