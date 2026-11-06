import {
	collection,
	doc,
	getDoc,
	getDocs,
	deleteDoc,
	query,
	where,
	onSnapshot,
	serverTimestamp,
	writeBatch,
	type Unsubscribe
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getFirestoreInstance } from './index';
import {
	createTarget,
	mirrorPidOf,
	parseTargetKey,
	primaryRef,
	sharedProjectCopyPath,
	sharedRef,
	withoutSecrets,
	type SyncTarget
} from './syncTarget';
import { syncStore } from '$lib/stores/sync.svelte';
import type { Project, Chapter, Scene, Character, Plot, Worldbuilding } from '$lib/types';

export type SyncableEntity = Project | Chapter | Scene | Character | Plot | Worldbuilding;
export type EntityType =
	| 'projects'
	| 'chapters'
	| 'scenes'
	| 'characters'
	| 'plots'
	| 'worldbuilding';

let unsubscribers: Unsubscribe[] = [];

// ゲスト接続(別の Firebase)の Firestore。段階2b-3 で接続を作るときに登録する
const connectionDbs = new Map<string, Firestore>();

export function registerConnectionDb(connectionId: string, db: Firestore): void {
	connectionDbs.set(connectionId, db);
}

export function unregisterConnectionDb(connectionId: string): void {
	connectionDbs.delete(connectionId);
}

/** 従来の最上位コレクション(主 Firebase) */
export function primaryTarget(): SyncTarget {
	return createTarget(primaryRef, getFirestoreInstance());
}

/** 主 Firebase 上の共有プロジェクト(shared/{pid}/…) */
export function sharedTarget(pid: string, db: Firestore = getFirestoreInstance()): SyncTarget {
	return createTarget(sharedRef(pid), db);
}

/**
 * キーから SyncTarget を作る。解釈できないキー、または接続の Firestore が登録されていない場合は null
 * (呼び出し側は、その変更を送らずに残す)。
 */
export function targetFromKey(key: string): SyncTarget | null {
	const ref = parseTargetKey(key);
	if (!ref) return null;
	if (ref.connectionId) {
		const db = connectionDbs.get(ref.connectionId);
		return db ? createTarget(ref, db) : null;
	}
	return createTarget(ref, getFirestoreInstance());
}

/**
 * Firestore は undefined のフィールドを受け付けないので、取り除く(プレーンなオブジェクトと配列だけを辿る)。
 */
export function stripUndefined<T>(value: T): T {
	if (Array.isArray(value)) return value.map(stripUndefined) as T;
	if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (v !== undefined) out[k] = stripUndefined(v);
		}
		return out as T;
	}
	return value;
}

/** 共有中プロジェクトのポインタ文書を送るときに、共有側へも書くコピー(secrets 除く、projectId 付き) */
function sharedCopyOf(project: Project, pid: string): Record<string, unknown> {
	return stripUndefined({ ...withoutSecrets(project), projectId: pid });
}

// 最終同期時刻を保存（差分同期用）
const LAST_SYNC_KEY = 'storift_last_sync_time';

function getLastSyncTime(): number {
	const stored = localStorage.getItem(LAST_SYNC_KEY);
	return stored ? parseInt(stored, 10) : 0;
}

function setLastSyncTime(time: number): void {
	localStorage.setItem(LAST_SYNC_KEY, time.toString());
}

/**
 * ローカルからFirestoreへの同期（アップロード）
 */
export async function syncToFirestore<T extends SyncableEntity>(
	entityType: EntityType,
	entity: T,
	target: SyncTarget = primaryTarget()
): Promise<void> {
	await commitBatchOps([{ kind: 'set', entityType, entity }], target);
}

export type BatchOp =
	| { kind: 'set'; entityType: EntityType; entity: SyncableEntity }
	| { kind: 'delete'; entityType: EntityType; id: string };

/**
 * 最上位に書くデータ。プロジェクト文書(ポインタ)の sharing は、共有の開始・停止などの専用の処理だけが書く。
 * 通常のアップロードで送ると、共有の状態を知らない古い端末が sharing を書き戻してしまうため送らない。
 */
function primaryData(entityType: EntityType, entity: SyncableEntity) {
	const data = stripUndefined({ ...entity }) as Record<string, unknown>;
	if (entityType === 'projects') delete data.sharing;
	return data;
}

/** 共有側の文書に必要な projectId を補う(shared のルール: projectId == pid。projects 型にも必要) */
function sharedData(target: SyncTarget, entityType: EntityType, entity: SyncableEntity) {
	if (target.kind !== 'shared') return stripUndefined({ ...entity });
	const base = entityType === 'projects' ? withoutSecrets(entity as Project) : entity;
	return stripUndefined({ ...base, projectId: target.pid });
}

/**
 * 複数の書き込み・削除を1回の WriteBatch でコミットする(原子的: 全部成功か全部失敗)。
 * 呼び出し側で 500 件・サイズの上限に収まるよう分割すること(chunkBatches)。
 * primary に共有中プロジェクトの文書(ポインタ)を書くときは、同じバッチで共有側のコピー
 * (shared/{pid}/projects/{pid}。secrets 除く)とメタの name も更新する。
 * 件数はミラー分だけ増える(プロジェクト文書1件につき最大2件)ので、上限は余裕を持って分割すること。
 */
export async function commitBatchOps(
	ops: BatchOp[],
	target: SyncTarget = primaryTarget()
): Promise<void> {
	if (ops.length === 0) return;
	const db = target.db;
	const batch = writeBatch(db);
	for (const op of ops) {
		if (op.kind === 'delete') {
			batch.delete(doc(db, target.docPath(op.entityType, op.id)));
			continue;
		}
		const data = {
			...(target.kind === 'primary'
				? primaryData(op.entityType, op.entity)
				: sharedData(target, op.entityType, op.entity)),
			syncedAt: serverTimestamp()
		};
		batch.set(doc(db, target.docPath(op.entityType, op.entity.id)), data, { merge: true });

		if (target.kind === 'primary' && op.entityType === 'projects') {
			const project = op.entity as Project;
			const pid = mirrorPidOf(project);
			if (pid) {
				batch.set(
					doc(db, sharedProjectCopyPath(pid)),
					{ ...sharedCopyOf(project, pid), syncedAt: serverTimestamp() },
					{ merge: true }
				);
				batch.set(doc(db, `shared/${pid}`), { name: project.title }, { merge: true });
			}
		}
	}
	await batch.commit();
}

/**
 * Firestoreからローカルへの同期（ダウンロード）
 */
export async function syncFromFirestore<T extends SyncableEntity>(
	entityType: EntityType,
	entityId: string,
	target: SyncTarget = primaryTarget()
): Promise<T | null> {
	const docRef = doc(target.db, target.docPath(entityType, entityId));
	const docSnap = await getDoc(docRef);

	if (docSnap.exists()) {
		const data = docSnap.data();
		// Timestamp型をnumberに変換
		if (data.syncedAt) {
			data.syncedAt = data.syncedAt.toMillis();
		}
		return data as T;
	}

	return null;
}

/**
 * すべてのエンティティを同期（最適化版: 差分同期対応）
 */
export async function syncAllFromFirestore(
	entityType: EntityType,
	projectId?: string,
	lastSyncTime?: number,
	target: SyncTarget = primaryTarget()
): Promise<SyncableEntity[]> {
	const collectionRef = collection(target.db, target.collectionPath(entityType));

	// クエリ条件を構築
	const constraints = [];

	// プロジェクトIDでフィルタリング（プロジェクト以外）。共有側はパスがプロジェクトを表すので不要
	if (projectId && entityType !== 'projects' && target.kind === 'primary') {
		constraints.push(where('projectId', '==', projectId));
	}

	// 差分同期: 最終同期時刻以降のデータのみ取得
	if (lastSyncTime) {
		constraints.push(where('updatedAt', '>', lastSyncTime));
	}

	const q = constraints.length > 0 ? query(collectionRef, ...constraints) : collectionRef;
	const snapshot = await getDocs(q);

	// キャッシュ由来の不完全な一覧は、リモート削除の判定を誤らせるため採用しない
	if (snapshot.metadata.fromCache) {
		throw Object.assign(new Error('Firestore から最新データを取得できませんでした(オフライン)'), {
			code: 'unavailable'
		});
	}

	console.log(
		`📥 Fetched ${snapshot.docs.length} ${entityType} documents${target.kind === 'shared' ? ` from ${target.key}` : ''}${projectId ? ` for project ${projectId}` : ''}${lastSyncTime ? ' (diff sync)' : ''}`
	);

	return snapshot.docs.map((doc) => {
		const data = doc.data();
		// Timestamp型をnumberに変換
		if (data.syncedAt) {
			data.syncedAt = data.syncedAt.toMillis();
		}
		return data as SyncableEntity;
	});
}

/**
 * プロジェクト用の差分同期
 */
export async function syncProjectsFromFirestore(lastSyncTime?: number): Promise<Project[]> {
	const entities = await syncAllFromFirestore(
		'projects',
		undefined,
		lastSyncTime || getLastSyncTime()
	);
	setLastSyncTime(Date.now());
	return entities as Project[];
}

/**
 * Firestoreから削除
 */
export async function deleteFromFirestore(
	entityType: EntityType,
	entityId: string,
	target: SyncTarget = primaryTarget()
): Promise<void> {
	await deleteDoc(doc(target.db, target.docPath(entityType, entityId)));
}

export interface RealtimeMeta {
	/** 最初のスナップショット(既存の全件が added として届く) */
	initial: boolean;
	/** キャッシュ由来のスナップショット */
	fromCache: boolean;
}

/**
 * リアルタイム同期のリスナーをセットアップ（最適化版）
 * onUpdate には変化のあった(added / modified)ドキュメントだけを渡す。削除は onRemoved で通知する。
 * @param entityType - エンティティタイプ
 * @param onUpdate - 更新時のコールバック
 * @param onError - エラー時のコールバック
 * @param projectId - プロジェクトID（指定した場合、そのプロジェクトのみ監視）
 */
export function setupRealtimeSync(
	entityType: EntityType,
	onUpdate: (entities: SyncableEntity[], meta: RealtimeMeta) => void,
	onError?: (error: Error) => void,
	projectId?: string,
	onRemoved?: (ids: string[]) => void,
	target: SyncTarget = primaryTarget()
): Unsubscribe {
	const collectionRef = collection(target.db, target.collectionPath(entityType));

	// プロジェクトIDでフィルタリング（プロジェクト以外）。共有側はパスがプロジェクトを表すので不要
	let q: ReturnType<typeof query> | typeof collectionRef = collectionRef;
	if (projectId && entityType !== 'projects' && target.kind === 'primary') {
		console.log(
			`🔍 Setting up realtime sync for ${entityType} filtered by projectId: ${projectId}`
		);
		q = query(collectionRef, where('projectId', '==', projectId));
	} else {
		console.log(`🔍 Setting up realtime sync for ${entityType} (all)`);
	}

	let initial = true;
	const unsubscribe = onSnapshot(
		q,
		(snapshot) => {
			const meta: RealtimeMeta = { initial, fromCache: snapshot.metadata.fromCache };
			initial = false;

			// 変化のあった(追加・更新された)ドキュメントだけを渡す。初回は全件が added として届く
			const changes = snapshot.docChanges();
			const entities = changes
				.filter((change) => change.type === 'added' || change.type === 'modified')
				.map((change) => {
					const data = change.doc.data() as SyncableEntity & {
						syncedAt?: { toMillis: () => number };
					};
					// Timestamp型をnumberに変換
					if (data.syncedAt && typeof data.syncedAt === 'object' && 'toMillis' in data.syncedAt) {
						(data as SyncableEntity & { syncedAt?: number }).syncedAt = data.syncedAt.toMillis();
					}
					return data as SyncableEntity;
				});
			if (entities.length > 0) {
				console.log(
					`📨 Realtime update: ${entities.length} ${entityType} changed${meta.initial ? ' (initial)' : ''}${meta.fromCache ? ' (from cache)' : ''}`
				);
				onUpdate(entities, meta);
			}

			if (onRemoved) {
				const removed = changes
					.filter((change) => change.type === 'removed')
					.map((change) => change.doc.id);
				if (removed.length > 0) onRemoved(removed);
			}
		},
		(error) => {
			console.error(`Realtime sync error for ${entityType}:`, error);
			if (onError) {
				onError(error);
			}
		}
	);

	unsubscribers.push(unsubscribe);
	return unsubscribe;
}

/**
 * すべてのリアルタイム同期を停止
 */
export function stopAllRealtimeSync(): void {
	unsubscribers.forEach((unsubscribe) => unsubscribe());
	unsubscribers = [];
}

/**
 * バッチ同期（変更のあったデータのみ）
 */
export async function batchSyncToFirestore(
	entities: { type: EntityType; data: SyncableEntity }[]
): Promise<void> {
	syncStore.isSyncing = true;
	syncStore.status = 'syncing';

	try {
		for (const { type, data } of entities) {
			await syncToFirestore(type, data);
		}
		syncStore.lastSyncTime = Date.now();
		syncStore.status = 'synced';
	} catch (error) {
		console.error('Batch sync error:', error);
		syncStore.error = error instanceof Error ? error.message : 'Unknown error';
		syncStore.status = 'error';
		throw error;
	} finally {
		syncStore.isSyncing = false;
	}
}

/**
 * オンライン状態の監視
 */
export function monitorOnlineStatus(): void {
	const updateStatus = () => {
		if (navigator.onLine) {
			if (syncStore.status === 'offline') {
				syncStore.status = 'synced';
			}
		} else {
			syncStore.status = 'offline';
		}
	};

	window.addEventListener('online', updateStatus);
	window.addEventListener('offline', updateStatus);
	updateStatus();
}
