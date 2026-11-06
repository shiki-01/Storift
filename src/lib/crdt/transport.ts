import {
	Bytes,
	addDoc,
	collection,
	doc,
	getDoc,
	onSnapshot,
	orderBy,
	query,
	runTransaction,
	where,
	writeBatch,
	type Firestore,
	type Unsubscribe
} from 'firebase/firestore';
import { HARD_UPDATE_BYTES, MAX_SNAPSHOT_BYTES, groupUpdates } from './policy';

/**
 * CRDT の Firestore 操作。Firestore インスタンスと pid / sceneId を引数に取る関数だけで構成する
 * (SyncTarget から解決した接続先をそのまま渡せる。Emulator で直接テストできる)。
 *
 * 配置(docs/SHARING_RULES.md「シーン本文の CRDT」):
 *   shared/{pid}/scenes/{sceneId}/crdt/snapshot    { state, updatedAt, rev }
 *   shared/{pid}/scenes/{sceneId}/updates/{autoId} { update, by, clientId, createdAt, n }
 */

export interface SnapshotData {
	state: Uint8Array;
	updatedAt: number;
	rev: number;
}

export interface RemoteUpdate {
	id: string;
	update: Uint8Array;
	createdAt: number;
	by: string;
	clientId: number;
}

export interface PushMeta {
	by: string;
	clientId: number;
	/** クライアント時刻(ms)。複数件を送るときは 1 件ごとに +1 して順序を保つ */
	createdAt: number;
}

export type CompactResult = { ok: true; rev: number } | { ok: false; reason: 'stale' };

/** 送れない大きさ(Firestore の 1 文書の上限)を超えた */
export class CrdtTooLargeError extends Error {
	constructor(
		readonly kind: 'update' | 'snapshot',
		readonly bytes: number
	) {
		super(
			`CRDT の${kind === 'update' ? '更新' : 'スナップショット'}が大きすぎます(${bytes} バイト)`
		);
		this.name = 'CrdtTooLargeError';
	}
}

const sceneDocPath = (pid: string, sceneId: string) => `shared/${pid}/scenes/${sceneId}`;
const snapshotRef = (db: Firestore, pid: string, sceneId: string) =>
	doc(db, `${sceneDocPath(pid, sceneId)}/crdt/snapshot`);
const updatesCol = (db: Firestore, pid: string, sceneId: string) =>
	collection(db, `${sceneDocPath(pid, sceneId)}/updates`);

/** Firestore の Bytes か(SDK のコピーが複数あっても判定できるよう、メソッドの有無で見る) */
function bytesOf(value: unknown): Uint8Array | null {
	return value instanceof Bytes ||
		typeof (value as { toUint8Array?: unknown } | null)?.toUint8Array === 'function'
		? (value as Bytes).toUint8Array()
		: null;
}

function readSnapshot(data: Record<string, unknown> | undefined): SnapshotData | null {
	const state = data ? bytesOf(data.state) : null;
	if (!data || !state) return null;
	return {
		state,
		updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
		rev: typeof data.rev === 'number' ? data.rev : 0
	};
}

function assertSnapshotSize(state: Uint8Array): void {
	if (state.length > MAX_SNAPSHOT_BYTES) throw new CrdtTooLargeError('snapshot', state.length);
}

export async function getSnapshot(
	db: Firestore,
	pid: string,
	sceneId: string
): Promise<SnapshotData | null> {
	const snap = await getDoc(snapshotRef(db, pid, sceneId));
	return snap.exists() ? readSnapshot(snap.data()) : null;
}

/**
 * snapshot が無ければ buildState() の状態で作る(トランザクション)。既にあれば作らず、それを返す。
 * 複数端末が同時に呼んでも、作るのは 1 つだけで、全員が同じ状態を受け取る。
 * buildState はトランザクションの再試行で複数回呼ばれることがある(結果は使い捨てても構わないこと)。
 */
export async function initSnapshotIfAbsent(
	db: Firestore,
	pid: string,
	sceneId: string,
	buildState: () => Uint8Array,
	now: () => number = Date.now
): Promise<{ created: boolean; snapshot: SnapshotData }> {
	const ref = snapshotRef(db, pid, sceneId);
	return runTransaction(db, async (tx) => {
		const existing = readSnapshot((await tx.get(ref)).data());
		if (existing) return { created: false, snapshot: existing };

		const state = buildState();
		assertSnapshotSize(state);
		const snapshot: SnapshotData = { state, updatedAt: now(), rev: 0 };
		tx.set(ref, {
			state: Bytes.fromUint8Array(state),
			updatedAt: snapshot.updatedAt,
			rev: snapshot.rev
		});
		return { created: true, snapshot };
	});
}

/** 更新を 1 つの updates 文書として書く。書いた文書の ID を返す */
export async function pushUpdate(
	db: Firestore,
	pid: string,
	sceneId: string,
	update: Uint8Array,
	meta: PushMeta,
	n = 1
): Promise<string> {
	if (update.length > HARD_UPDATE_BYTES) throw new CrdtTooLargeError('update', update.length);
	const ref = await addDoc(updatesCol(db, pid, sceneId), {
		update: Bytes.fromUint8Array(update),
		by: meta.by,
		clientId: meta.clientId,
		createdAt: meta.createdAt,
		n
	});
	return ref.id;
}

/**
 * 複数の更新を、ペイロード 500KB 以下の文書にまとめて順に書く。書いた文書の ID を返す。
 * 途中で失敗したら例外(書けた分は残る。更新は冪等なので、呼び出し側が全件を再送して構わない)。
 */
export async function pushUpdates(
	db: Firestore,
	pid: string,
	sceneId: string,
	updates: readonly Uint8Array[],
	meta: PushMeta
): Promise<string[]> {
	const ids: string[] = [];
	let createdAt = meta.createdAt;
	for (const group of groupUpdates(updates)) {
		ids.push(await pushUpdate(db, pid, sceneId, group.update, { ...meta, createdAt }, group.n));
		createdAt += 1;
	}
	return ids;
}

/**
 * updates を createdAt > since で購読する。added のみを onUpdates に渡す(変更・削除は無視)。
 * 返り値で購読を解除する。
 */
export function listenUpdates(
	db: Firestore,
	pid: string,
	sceneId: string,
	since: number,
	onUpdates: (updates: RemoteUpdate[]) => void,
	onError: (error: unknown) => void
): Unsubscribe {
	const q = query(
		updatesCol(db, pid, sceneId),
		where('createdAt', '>', since),
		orderBy('createdAt')
	);
	return onSnapshot(
		q,
		(snap) => {
			const added: RemoteUpdate[] = [];
			for (const change of snap.docChanges()) {
				if (change.type !== 'added') continue;
				const data = change.doc.data();
				const update = bytesOf(data.update);
				if (!update) continue;
				added.push({
					id: change.doc.id,
					update,
					createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
					by: typeof data.by === 'string' ? data.by : '',
					clientId: typeof data.clientId === 'number' ? data.clientId : 0
				});
			}
			if (added.length > 0) onUpdates(added);
		},
		onError
	);
}

/**
 * snapshot 文書を購読する(他端末の圧縮で消された updates を取りこぼしていても、ここから追いつける)。
 * 初回の現在値も通知される。
 */
export function listenSnapshot(
	db: Firestore,
	pid: string,
	sceneId: string,
	onSnapshotData: (snapshot: SnapshotData) => void,
	onError: (error: unknown) => void
): Unsubscribe {
	return onSnapshot(
		snapshotRef(db, pid, sceneId),
		(snap) => {
			const data = snap.exists() ? readSnapshot(snap.data()) : null;
			if (data) onSnapshotData(data);
		},
		onError
	);
}

/** 1 回のトランザクション・バッチで消す件数(上限 500 書き込みに余裕を持たせる) */
const DELETE_CHUNK = 400;

/**
 * 圧縮。state(自分の Y 文書の全状態)を snapshot に書き(rev + 1)、deleteIds の updates 文書を消す。
 * - トランザクションで現在の rev が baseRev と一致することを確認する。一致しなければ書かず stale を返す
 *   (他端末が先に圧縮した。古い圧縮が新しい snapshot を上書きしない)。
 * - deleteIds は呼び出し側が「自分が適用済み」のものだけを渡すこと。ここでは渡されたものだけを消す。
 * - 最初の DELETE_CHUNK 件は snapshot と同じトランザクションで消し、残りは snapshot の書き込み後に消す
 *   (snapshot に含まれたあとなので、失敗してもデータは失われない)。
 */
export async function compact(
	db: Firestore,
	pid: string,
	sceneId: string,
	args: { state: Uint8Array; baseRev: number; deleteIds: readonly string[] },
	now: () => number = Date.now
): Promise<CompactResult> {
	assertSnapshotSize(args.state);
	const ref = snapshotRef(db, pid, sceneId);
	const col = updatesCol(db, pid, sceneId);
	const first = args.deleteIds.slice(0, DELETE_CHUNK);
	const rest = args.deleteIds.slice(DELETE_CHUNK);

	const result = await runTransaction<CompactResult>(db, async (tx) => {
		const current = readSnapshot((await tx.get(ref)).data());
		const currentRev = current?.rev ?? 0;
		if (currentRev !== args.baseRev) return { ok: false, reason: 'stale' };
		const rev = currentRev + 1;
		tx.set(ref, { state: Bytes.fromUint8Array(args.state), updatedAt: now(), rev });
		for (const id of first) tx.delete(doc(col, id));
		return { ok: true, rev };
	});

	if (result.ok) {
		for (let i = 0; i < rest.length; i += DELETE_CHUNK) {
			const batch = writeBatch(db);
			for (const id of rest.slice(i, i + DELETE_CHUNK)) batch.delete(doc(col, id));
			await batch.commit();
		}
	}
	return result;
}

/** 実装を差し替えられるようにするためのインターフェース(doc.ts はこれに依存する) */
export interface CrdtTransport {
	getSnapshot: typeof getSnapshot;
	initSnapshotIfAbsent: typeof initSnapshotIfAbsent;
	pushUpdates: typeof pushUpdates;
	listenUpdates: typeof listenUpdates;
	listenSnapshot: typeof listenSnapshot;
	compact: typeof compact;
}

export const firestoreTransport: CrdtTransport = {
	getSnapshot,
	initSnapshotIfAbsent,
	pushUpdates,
	listenUpdates,
	listenSnapshot,
	compact
};
