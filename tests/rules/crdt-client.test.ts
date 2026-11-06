import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import * as Y from 'yjs';
import {
	CrdtTooLargeError,
	compact,
	getSnapshot,
	initSnapshotIfAbsent,
	listenSnapshot,
	listenUpdates,
	pushUpdate,
	pushUpdates,
	type RemoteUpdate
} from '../../src/lib/crdt/transport';
import { PID, baseSeed, createEnv, dbOf, seed } from './helpers';

// CRDT の Firestore 経路(transport.ts)を、実際のルールに対して直接呼ぶ。
// 配置: shared/{pid}/scenes/{sceneId}/crdt/snapshot と .../updates/{autoId}

const SCENE = 's1';
const fs = (env: RulesTestEnvironment, uid: string) => dbOf(env, uid) as unknown as Firestore;

let env: RulesTestEnvironment;

/** baseSeed から、他のテスト用の updates/crdt のダミー文書を除いたもの */
function freshSeed() {
	const docs: Record<string, Record<string, unknown>> = { ...baseSeed() };
	delete docs[`shared/${PID}/scenes/${SCENE}/updates/u1`];
	delete docs[`shared/${PID}/scenes/${SCENE}/crdt/c1`];
	return docs;
}

beforeAll(async () => {
	env = await createEnv();
});
beforeEach(async () => {
	await env.clearFirestore();
	await seed(env, freshSeed());
});
afterAll(async () => {
	await env?.cleanup();
});

/** 本文 text を持つ Y 文書の全状態 */
function stateOf(text: string): Uint8Array {
	const doc = new Y.Doc();
	doc.getText('content').insert(0, text);
	return Y.encodeStateAsUpdate(doc);
}

function textOfState(state: Uint8Array, ...updates: Uint8Array[]): string {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, state);
	for (const u of updates) Y.applyUpdate(doc, u);
	return doc.getText('content').toString();
}

/** doc を編集して、その更新(バイト列)を返す */
function edit(doc: Y.Doc, fn: (t: Y.Text) => void): Uint8Array {
	let captured: Uint8Array = new Uint8Array();
	const handler = (u: Uint8Array) => (captured = u);
	doc.on('update', handler);
	fn(doc.getText('content'));
	doc.off('update', handler);
	return captured;
}

const meta = (createdAt: number) => ({ by: 'u', clientId: 1, createdAt });

async function updateIds(db: Firestore): Promise<string[]> {
	const snap = await getDocs(collection(db, `shared/${PID}/scenes/${SCENE}/updates`));
	return snap.docs.map((d) => d.id).sort();
}

/** 購読して、条件が満たされるまで届いた更新を集める */
function collectUpdates(db: Firestore, since: number, until: (all: RemoteUpdate[]) => boolean) {
	return new Promise<RemoteUpdate[]>((resolve, reject) => {
		const all: RemoteUpdate[] = [];
		const unsubscribe = listenUpdates(
			db,
			PID,
			SCENE,
			since,
			(updates) => {
				all.push(...updates);
				if (until(all)) {
					unsubscribe();
					resolve(all);
				}
			},
			reject
		);
	});
}

describe('初期化(initSnapshotIfAbsent)', () => {
	it('2 クライアントが同時に呼んでも snapshot は 1 つだけで、両者が同じ状態になる', async () => {
		const a = fs(env, 'owner1');
		const b = fs(env, 'editor1');
		const [ra, rb] = await Promise.all([
			initSnapshotIfAbsent(a, PID, SCENE, () => stateOf('Aが作った本文')),
			initSnapshotIfAbsent(b, PID, SCENE, () => stateOf('Bが作った本文'))
		]);
		expect([ra.created, rb.created].filter(Boolean)).toHaveLength(1);
		expect(textOfState(ra.snapshot.state)).toBe(textOfState(rb.snapshot.state));
		expect(ra.snapshot.rev).toBe(0);

		const stored = await getSnapshot(a, PID, SCENE);
		expect(textOfState(stored!.state)).toBe(textOfState(ra.snapshot.state));

		// 既にあれば作り直さない
		const again = await initSnapshotIfAbsent(b, PID, SCENE, () => stateOf('別の本文'));
		expect(again.created).toBe(false);
		expect(textOfState(again.snapshot.state)).toBe(textOfState(stored!.state));
	});

	it('閲覧者は snapshot を読めるが、作れない', async () => {
		await initSnapshotIfAbsent(fs(env, 'editor1'), PID, SCENE, () => stateOf('本文'));
		const viewer = fs(env, 'viewer1');
		expect(textOfState((await getSnapshot(viewer, PID, SCENE))!.state)).toBe('本文');

		await env.clearFirestore();
		await seed(env, freshSeed());
		await expect(
			initSnapshotIfAbsent(viewer, PID, SCENE, () => stateOf('不正'))
		).rejects.toMatchObject({ code: 'permission-denied' });
	});
});

describe('更新の送受信', () => {
	it('更新が相互に届き、収束する(順不同・日本語・絵文字)', async () => {
		const a = fs(env, 'editor1');
		const b = fs(env, 'owner1');
		const base = stateOf('こんにちは');
		await initSnapshotIfAbsent(a, PID, SCENE, () => base);

		const docA = new Y.Doc();
		const docB = new Y.Doc();
		Y.applyUpdate(docA, base);
		Y.applyUpdate(docB, base);

		const ua = edit(docA, (t) => t.insert(5, '、世界😀'));
		const ub = edit(docB, (t) => t.insert(0, '【B】'));
		await pushUpdate(a, PID, SCENE, ua, { by: 'editor1', clientId: docA.clientID, createdAt: 10 });
		await pushUpdate(b, PID, SCENE, ub, { by: 'owner1', clientId: docB.clientID, createdAt: 20 });

		const received = await collectUpdates(a, 0, (all) => all.length >= 2);
		expect(received.map((u) => u.by).sort()).toEqual(['editor1', 'owner1']);
		// 逆順に適用しても同じ
		for (const u of received) Y.applyUpdate(docA, u.update, 'remote');
		for (const u of [...received].reverse()) Y.applyUpdate(docB, u.update, 'remote');
		expect(docA.getText('content').toString()).toBe(docB.getText('content').toString());
		expect(docA.getText('content').toString()).toContain('😀');
		expect(docA.getText('content').toString()).toContain('【B】');
	});

	it('createdAt > since の更新だけを購読する', async () => {
		const a = fs(env, 'editor1');
		const doc = new Y.Doc();
		await pushUpdate(
			a,
			PID,
			SCENE,
			edit(doc, (t) => t.insert(0, 'a')),
			meta(100)
		);
		await pushUpdate(
			a,
			PID,
			SCENE,
			edit(doc, (t) => t.insert(1, 'b')),
			meta(200)
		);
		await pushUpdate(
			a,
			PID,
			SCENE,
			edit(doc, (t) => t.insert(2, 'c')),
			meta(300)
		);
		const received = await collectUpdates(a, 150, (all) => all.length >= 2);
		expect(received.map((u) => u.createdAt)).toEqual([200, 300]);
	});

	it('pushUpdates は 500KB を超えないよう文書を分ける', async () => {
		const a = fs(env, 'editor1');
		const doc = new Y.Doc();
		const updates: Uint8Array[] = [];
		for (let i = 0; i < 4; i++) {
			// 圧縮されにくいランダムな文字列で、1 件あたり約 300KB
			const noise = Array.from({ length: 100_000 }, () =>
				String.fromCharCode(0x4e00 + Math.floor(Math.random() * 20000))
			).join('');
			updates.push(edit(doc, (t) => t.insert(t.length, noise)));
		}
		const ids = await pushUpdates(a, PID, SCENE, updates, meta(1000));
		expect(ids.length).toBeGreaterThanOrEqual(2);
		expect(await updateIds(a)).toHaveLength(ids.length);

		const received = await collectUpdates(a, 0, (all) => all.length >= ids.length);
		const restored = new Y.Doc();
		for (const u of received) Y.applyUpdate(restored, u.update);
		expect(restored.getText('content').toString()).toBe(doc.getText('content').toString());
	}, 60000);

	it('1 文書に収まらない大きさの更新は送らずにエラーにする', async () => {
		const huge = new Uint8Array(960_000);
		await expect(pushUpdate(fs(env, 'editor1'), PID, SCENE, huge, meta(1))).rejects.toBeInstanceOf(
			CrdtTooLargeError
		);
	});

	it('閲覧者の pushUpdate は拒否され、編集者・オーナーは成功する。閲覧者も購読(読み取り)はできる', async () => {
		const doc = new Y.Doc();
		const update = edit(doc, (t) => t.insert(0, 'x'));
		await expect(pushUpdate(fs(env, 'viewer1'), PID, SCENE, update, meta(1))).rejects.toMatchObject(
			{ code: 'permission-denied' }
		);
		await pushUpdate(fs(env, 'editor1'), PID, SCENE, update, meta(2));
		await pushUpdate(fs(env, 'owner1'), PID, SCENE, update, meta(3));
		const viewerSees = await collectUpdates(fs(env, 'viewer1'), 0, (all) => all.length >= 2);
		expect(viewerSees).toHaveLength(2);
	});

	it('メンバーでない人は更新を書けず、読めない', async () => {
		const stranger = fs(env, 'stranger');
		const update = edit(new Y.Doc(), (t) => t.insert(0, 'x'));
		await expect(pushUpdate(stranger, PID, SCENE, update, meta(1))).rejects.toMatchObject({
			code: 'permission-denied'
		});
		await expect(collectUpdates(stranger, 0, () => false)).rejects.toMatchObject({
			code: 'permission-denied'
		});
	});
});

describe('圧縮(compact)', () => {
	/** snapshot(rev 0)と、編集者 A の 3 件の更新を用意する */
	async function prepare() {
		const a = fs(env, 'editor1');
		const base = stateOf('はじめ');
		await initSnapshotIfAbsent(a, PID, SCENE, () => base);
		const doc = new Y.Doc();
		Y.applyUpdate(doc, base);
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			ids.push(
				await pushUpdate(
					a,
					PID,
					SCENE,
					edit(doc, (t) => t.insert(t.length, `[${i}]`)),
					meta(100 + i)
				)
			);
		}
		return { a, doc, ids };
	}

	it('圧縮後に新規クライアントが snapshot + 残りの updates から同じ本文を復元する', async () => {
		const { a, doc, ids } = await prepare();
		// 他端末(B)の更新が圧縮の直前に届いたが、A はまだ適用していない
		const docB = new Y.Doc();
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(doc));
		const foreignId = await pushUpdate(
			fs(env, 'owner1'),
			PID,
			SCENE,
			edit(docB, (t) => t.insert(0, '【B】')),
			meta(500)
		);

		const result = await compact(a, PID, SCENE, {
			state: Y.encodeStateAsUpdate(doc),
			baseRev: 0,
			deleteIds: ids
		});
		expect(result).toEqual({ ok: true, rev: 1 });

		// 新規クライアント
		const fresh = fs(env, 'viewer1');
		const snapshot = (await getSnapshot(fresh, PID, SCENE))!;
		expect(snapshot.rev).toBe(1);
		const remaining = await collectUpdates(fresh, 0, (all) => all.length >= 1);
		expect(remaining.map((u) => u.id)).toEqual([foreignId]);
		const restored = textOfState(snapshot.state, ...remaining.map((u) => u.update));
		expect(restored).toContain('はじめ[0][1][2]');
		expect(restored).toContain('【B】');
	});

	it('圧縮は渡された(適用済みの)updates だけを消し、未適用のものは消さない', async () => {
		const { a, doc, ids } = await prepare();
		const unapplied = ids[2];
		// A は ids[0], ids[1] だけ適用済みとして圧縮する(state にも ids[2] の内容は含まれない想定の状態)
		const partial = new Y.Doc();
		Y.applyUpdate(partial, stateOf('はじめ'));
		await compact(a, PID, SCENE, {
			state: Y.encodeStateAsUpdate(partial),
			baseRev: 0,
			deleteIds: [ids[0], ids[1]]
		});
		expect(await updateIds(a)).toEqual([unapplied]);
		expect(doc.getText('content').toString()).toContain('[2]');
	});

	it('400 件を超える削除も、snapshot の後にバッチで消える', async () => {
		const a = fs(env, 'editor1');
		await initSnapshotIfAbsent(a, PID, SCENE, () => stateOf(''));
		const doc = new Y.Doc();
		const ids: string[] = [];
		for (let i = 0; i < 405; i++) {
			ids.push(
				await pushUpdate(
					a,
					PID,
					SCENE,
					edit(doc, (t) => t.insert(t.length, 'a')),
					meta(i + 1)
				)
			);
		}
		const result = await compact(a, PID, SCENE, {
			state: Y.encodeStateAsUpdate(doc),
			baseRev: 0,
			deleteIds: ids
		});
		expect(result.ok).toBe(true);
		expect(await updateIds(a)).toEqual([]);
	}, 120000);

	it('古い rev の圧縮は新しい snapshot を上書きしない', async () => {
		const { a, doc, ids } = await prepare();
		// B が先に圧縮して rev 1 になる
		const newer = stateOf('新しい本文');
		const first = await compact(fs(env, 'owner1'), PID, SCENE, {
			state: newer,
			baseRev: 0,
			deleteIds: []
		});
		expect(first).toEqual({ ok: true, rev: 1 });

		// rev 0 を前提にした A の圧縮は拒否される(snapshot も updates も変わらない)
		const stale = await compact(a, PID, SCENE, {
			state: Y.encodeStateAsUpdate(doc),
			baseRev: 0,
			deleteIds: ids
		});
		expect(stale).toEqual({ ok: false, reason: 'stale' });
		const stored = (await getSnapshot(a, PID, SCENE))!;
		expect(stored.rev).toBe(1);
		expect(textOfState(stored.state)).toBe('新しい本文');
		expect(await updateIds(a)).toEqual([...ids].sort());

		// rev 1 を前提にすれば通る
		const ok = await compact(a, PID, SCENE, {
			state: Y.encodeStateAsUpdate(doc),
			baseRev: 1,
			deleteIds: ids
		});
		expect(ok).toEqual({ ok: true, rev: 2 });
	});

	it('閲覧者の圧縮は拒否される', async () => {
		const { ids } = await prepare();
		await expect(
			compact(fs(env, 'viewer1'), PID, SCENE, {
				state: stateOf('x'),
				baseRev: 0,
				deleteIds: ids
			})
		).rejects.toMatchObject({ code: 'permission-denied' });
	});
});

describe('snapshot の購読', () => {
	it('圧縮による新しい snapshot が通知される', async () => {
		const a = fs(env, 'editor1');
		await initSnapshotIfAbsent(a, PID, SCENE, () => stateOf('初期'));
		const revs: number[] = [];
		const done = new Promise<void>((resolve, reject) => {
			const unsubscribe = listenSnapshot(
				fs(env, 'viewer1'),
				PID,
				SCENE,
				(s) => {
					revs.push(s.rev);
					if (s.rev >= 1) {
						unsubscribe();
						resolve();
					}
				},
				reject
			);
		});
		await compact(a, PID, SCENE, { state: stateOf('圧縮後'), baseRev: 0, deleteIds: [] });
		await done;
		expect(revs[revs.length - 1]).toBe(1);
	});
});
