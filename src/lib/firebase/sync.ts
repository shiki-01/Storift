import {
	collection,
	doc,
	setDoc,
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
import { getFirestoreInstance } from './index';
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
	entity: T
): Promise<void> {
	const db = getFirestoreInstance();
	// 共有コレクションを使用（ユーザー別ではない）
	const docRef = doc(db, `${entityType}/${entity.id}`);

	const firestoreData = {
		...entity,
		syncedAt: serverTimestamp()
	};

	await setDoc(docRef, firestoreData, { merge: true });
}

export type BatchOp =
	| { kind: 'set'; entityType: EntityType; entity: SyncableEntity }
	| { kind: 'delete'; entityType: EntityType; id: string };

/**
 * 複数の書き込み・削除を1回の WriteBatch でコミットする(原子的: 全部成功か全部失敗)。
 * 呼び出し側で 500 件・サイズの上限に収まるよう分割すること(chunkBatches)。
 */
export async function commitBatchOps(ops: BatchOp[]): Promise<void> {
	if (ops.length === 0) return;
	const db = getFirestoreInstance();
	const batch = writeBatch(db);
	for (const op of ops) {
		if (op.kind === 'delete') {
			batch.delete(doc(db, `${op.entityType}/${op.id}`));
		} else {
			batch.set(
				doc(db, `${op.entityType}/${op.entity.id}`),
				{ ...op.entity, syncedAt: serverTimestamp() },
				{ merge: true }
			);
		}
	}
	await batch.commit();
}

/**
 * Firestoreからローカルへの同期（ダウンロード）
 */
export async function syncFromFirestore<T extends SyncableEntity>(
	entityType: EntityType,
	entityId: string
): Promise<T | null> {
	const db = getFirestoreInstance();
	// 共有コレクションを使用
	const docRef = doc(db, `${entityType}/${entityId}`);
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
	lastSyncTime?: number
): Promise<SyncableEntity[]> {
	const db = getFirestoreInstance();
	const collectionRef = collection(db, entityType);

	// クエリ条件を構築
	const constraints = [];

	// プロジェクトIDでフィルタリング（プロジェクト以外）
	if (projectId && entityType !== 'projects') {
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
		`📥 Fetched ${snapshot.docs.length} ${entityType} documents${projectId ? ` for project ${projectId}` : ''}${lastSyncTime ? ' (diff sync)' : ''}`
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
export async function deleteFromFirestore(entityType: EntityType, entityId: string): Promise<void> {
	const db = getFirestoreInstance();
	// 共有コレクションを使用
	const docRef = doc(db, `${entityType}/${entityId}`);
	await deleteDoc(docRef);
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
	onRemoved?: (ids: string[]) => void
): Unsubscribe {
	const db = getFirestoreInstance();
	const collectionRef = collection(db, entityType);

	// プロジェクトIDでフィルタリング（プロジェクト以外）
	let q: ReturnType<typeof query> | typeof collectionRef = collectionRef;
	if (projectId && entityType !== 'projects') {
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
