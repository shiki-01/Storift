import type { Table } from 'dexie';
import {
	db,
	historyDB,
	projectsDB,
	chaptersDB,
	scenesDB,
	charactersDB,
	plotsDB,
	worldbuildingDB
} from '$lib/db';
import {
	syncToFirestore,
	syncFromFirestore,
	syncAllFromFirestore,
	commitBatchOps,
	setupRealtimeSync,
	type BatchOp,
	monitorOnlineStatus,
	type EntityType,
	type SyncableEntity
} from '$lib/firebase/sync';
import { prepareConflictData, type ConflictData } from '$lib/firebase/conflict';
import { reconcile, type ReconcileAction } from '$lib/firebase/reconcile';
import {
	getBase,
	setBase,
	removeBase,
	loadPendingChanges,
	savePendingChanges,
	loadPendingConflicts,
	savePendingConflicts,
	loadSyncState,
	saveSyncState,
	flushSyncMeta,
	type PendingChange
} from '$lib/firebase/syncMeta';
import {
	planDownload,
	classifyLocalOnly,
	chunkBatches,
	canDetectRemoteDeletion,
	type DownloadTrigger,
	type TypePlan
} from '$lib/firebase/syncPlan';
import { syncStore } from '$lib/stores/sync.svelte';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { startNetworkMonitoring, onNetworkStatusChange } from '$lib/utils/offline';
import { debounceAsync } from '$lib/utils/debounce';
import { measureSync, recordSyncMetric } from '$lib/utils/syncMetrics';
import { Mutex, withTimeout, mapLimit } from '$lib/utils/asyncControl';
import { classifyError, RetryGate } from '$lib/utils/syncErrors';
import type { ConflictResolutionPolicy, History } from '$lib/types';
import type { Unsubscribe } from 'firebase/firestore';

interface PendingConflict {
	type: EntityType;
	id: string;
	local: SyncableEntity;
	remote: SyncableEntity;
	conflictData: ConflictData<SyncableEntity>;
}

const ENTITY_TYPES: EntityType[] = [
	'projects',
	'chapters',
	'scenes',
	'characters',
	'plots',
	'worldbuilding'
];
const PROJECT_SCOPED_TYPES: EntityType[] = [
	'chapters',
	'scenes',
	'characters',
	'plots',
	'worldbuilding'
];

const HISTORY_ENTITY_TYPE: Partial<Record<EntityType, History['entityType']>> = {
	chapters: 'chapter',
	scenes: 'scene',
	characters: 'character',
	plots: 'plot',
	worldbuilding: 'worldbuilding'
};
const ENTITY_TYPE_OF_HISTORY: Record<History['entityType'], EntityType> = {
	chapter: 'chapters',
	scene: 'scenes',
	character: 'characters',
	plot: 'plots',
	worldbuilding: 'worldbuilding'
};

// 他端末の変更を取り込む最短間隔(成功・失敗に関わらず、取得を試みた時刻から数える)
const REMOTE_REFRESH_INTERVAL = 60 * 1000;
// 取得・送信それぞれの全体タイムアウト(Firestore 呼び出し自体は中断できない)
const OPERATION_TIMEOUT = 90 * 1000;
// 型内でリモートの1件ずつを突き合わせるときの並列数と、1回にまとめて処理する件数
const RECONCILE_CONCURRENCY = 8;
const RECONCILE_CHUNK_SIZE = 100;
// アップロード準備(ローカル読み出し+リモート取得)の並列数
const UPLOAD_PREPARE_CONCURRENCY = 5;

type SyncKind = 'upload' | 'download';

const changeKey = (c: { type: EntityType; id: string }) => `${c.type}/${c.id}`;

// 未アップロードの変更(再読み込みで失われないよう localStorage にも保存する)。キーは type/id
let pendingChanges = new Map<string, PendingChange>(
	loadPendingChanges().map((c) => [changeKey(c), c])
);
// アップロード処理中の変更(リアルタイム同期で巻き戻されないよう保護する)
let inFlight = new Map<string, PendingChange>();
// 手動解決待ちの競合(localStorage にも保存し、再読み込み後も復元する)
const pendingConflicts: PendingConflict[] = loadPendingConflicts<PendingConflict>();
syncStore.conflictCount = pendingConflicts.length;
// processPendingChanges の実行中フラグ(二重起動を防ぐ)
let isProcessing = false;
// 取得と送信を同時に走らせないための排他
const syncMutex = new Mutex();
// 進行中の処理の数(isSyncing / status を正確に保つ)
let activeCount = 0;
// 種別ごとの直近のエラー(あれば status は error になる)
const runErrors: Record<string, string | null> = { upload: null, download: null, project: null };
// 再試行(指数バックオフ)の状態
const gates: Record<SyncKind, RetryGate> = { upload: new RetryGate(), download: new RetryGate() };
const retryTimers: Record<SyncKind, ReturnType<typeof setTimeout> | null> = {
	upload: null,
	download: null
};
let syncInterval: number | null = null;
let visibilityHandler: (() => void) | null = null;
let unsubscribeNetwork: (() => void) | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;
let initPromiseGeneration = 0;
// stopSync で増やし、停止後に初期化の続きが走らないようにする
let initGeneration = 0;
let currentProjectUnsubscribers: Unsubscribe[] = [];
let downloadPromise: Promise<void> | null = null;
let downloadTrigger: DownloadTrigger | null = null;
// 取得を試みた時刻(失敗でも更新する。成功時刻とは別)
let lastDownloadAttemptAt = 0;

// デバウンスされた同期処理（3秒）
const debouncedProcessPendingChanges = debounceAsync(processPendingChanges, 3000);

/** 同期を予約する(完了は待たない。失敗はログに残す) */
function scheduleProcess(): void {
	debouncedProcessPendingChanges().catch((error) => {
		console.error('Scheduled sync failed:', error);
	});
}

function tableOf(type: EntityType): Table<SyncableEntity, string> {
	return db[type] as unknown as Table<SyncableEntity, string>;
}

async function getPolicy(): Promise<ConflictResolutionPolicy> {
	const { settingsDB } = await import('$lib/db');
	const settings = await settingsDB.get();
	return settings.conflictResolution || 'manual';
}

function settledStatus(): 'synced' | 'conflict' {
	return pendingConflicts.length > 0 ? 'conflict' : 'synced';
}

/** 処理の開始を記録する(並行して走っても isSyncing が正確になる) */
function beginActivity(): void {
	activeCount++;
	syncStore.isSyncing = true;
	syncStore.status = 'syncing';
}

/** 処理の終了を記録し、全ての処理が終わっていれば status を確定する */
function endActivity(): void {
	activeCount = Math.max(0, activeCount - 1);
	if (activeCount > 0) return;
	syncStore.isSyncing = false;
	syncStore.progress = { phase: null, done: 0, total: 0 };
	const message = Object.values(runErrors).find((m) => m !== null) ?? null;
	syncStore.error = message;
	syncStore.status = message !== null ? 'error' : settledStatus();
}

function setProgress(phase: 'upload' | 'download', done: number, total: number): void {
	syncStore.progress = { phase, done, total };
}

function findPending(type: EntityType, id: string): PendingChange | undefined {
	const key = `${type}/${id}`;
	return pendingChanges.get(key) ?? inFlight.get(key);
}

function persistPending(): void {
	savePendingChanges([...pendingChanges.values()]);
}

function enqueueInMemory(change: PendingChange): void {
	const existing = pendingChanges.get(changeKey(change));
	if (existing) {
		existing.action = change.action;
	} else {
		pendingChanges.set(changeKey(change), change);
	}
}

function enqueue(change: PendingChange): void {
	enqueueInMemory(change);
	persistPending();
}

/**
 * 保存済みの変更をキューに載せて、同期を予約する(同期完了は待たない)
 */
function enqueueAndSchedule(change: PendingChange): void {
	enqueue(change);
	if (navigator.onLine) {
		scheduleProcess();
	}
}

/** 複数の変更をまとめてキューに載せる(保存は1回。キューの内容を失わない側に倒すため即時に書く) */
function enqueueManyAndSchedule(changes: PendingChange[]): void {
	if (changes.length === 0) return;
	for (const change of changes) enqueueInMemory(change);
	persistPending();
	if (navigator.onLine) {
		scheduleProcess();
	}
}

/**
 * 上書き・削除される版を復元用に保存する(失敗しても同期は止めない)
 */
async function backupEntity(
	type: EntityType,
	entity: SyncableEntity,
	changeType: 'conflict' | 'remote-delete'
): Promise<void> {
	const entityType = HISTORY_ENTITY_TYPE[type];
	if (!entityType) return;
	try {
		const projectId = 'projectId' in entity ? entity.projectId : '';
		await historyDB.create(entityType, entity.id, projectId, entity, changeType);
	} catch (error) {
		console.error(`Failed to back up ${type}/${entity.id}:`, error);
	}
}

const META_KEYS = new Set(['updatedAt', '_version', 'syncedAt']);

function contentDiffers(a: SyncableEntity, b: SyncableEntity): boolean {
	const strip = (e: SyncableEntity) =>
		JSON.stringify(
			Object.entries(e)
				.filter(([key]) => !META_KEYS.has(key))
				.sort(([x], [y]) => x.localeCompare(y))
		);
	return strip(a) !== strip(b);
}

/**
 * 競合を処理する。
 * プロジェクトは更新日時が頻繁に変わるメタ情報なので常に新しい方を採用する。
 */
async function handleConflict(
	type: EntityType,
	local: SyncableEntity,
	remote: SyncableEntity,
	policy: ConflictResolutionPolicy
): Promise<Exclude<ReconcileAction, 'skip'>> {
	console.log(`⚠️ Conflict detected for ${type}: ${local.id} (policy: ${policy})`);

	if (type === 'projects') {
		return remote.updatedAt > local.updatedAt ? 'apply-remote' : 'push-local';
	}

	switch (policy) {
		case 'local':
			return 'push-local';
		case 'remote':
			return 'apply-remote';
		default: {
			const conflict: PendingConflict = {
				type,
				id: local.id,
				local,
				remote,
				conflictData: prepareConflictData(
					local as unknown as Record<string, unknown>,
					remote as unknown as Record<string, unknown>
				) as unknown as ConflictData<SyncableEntity>
			};
			const index = pendingConflicts.findIndex((c) => c.id === local.id);
			if (index >= 0) {
				pendingConflicts[index] = conflict;
			} else {
				pendingConflicts.push(conflict);
			}
			savePendingConflicts(pendingConflicts);
			syncStore.status = 'conflict';
			syncStore.conflictCount = pendingConflicts.length;
			return 'conflict';
		}
	}
}

/**
 * 保留中の競合を取得
 */
export function getPendingConflicts(): PendingConflict[] {
	return [...pendingConflicts];
}

/**
 * 競合を手動で解決
 */
export async function resolveManualConflict(
	conflictId: string,
	resolution: 'local' | 'remote'
): Promise<void> {
	const index = pendingConflicts.findIndex((c) => c.id === conflictId);
	if (index === -1) {
		console.warn(`Conflict not found: ${conflictId}`);
		return;
	}

	const conflict = pendingConflicts[index];
	pendingConflicts.splice(index, 1);
	savePendingConflicts(pendingConflicts);
	syncStore.conflictCount = pendingConflicts.length;

	// 採用しない側の版を、解決前にバックアップする
	await backupEntity(
		conflict.type,
		resolution === 'remote' ? conflict.local : conflict.remote,
		'conflict'
	);

	if (resolution === 'remote') {
		await tableOf(conflict.type).put(conflict.remote);
		setBase(conflict.type, conflict.id, conflict.remote.updatedAt);
		await refreshStores(new Set([conflict.type]));
		console.log(`✅ Conflict resolved: ${conflict.type}/${conflictId} (adopted remote)`);
	} else {
		// リモートの版を確認済みとして扱い、ローカルを次回アップロードで反映する
		setBase(conflict.type, conflict.id, conflict.remote.updatedAt);
		enqueueAndSchedule({ type: conflict.type, id: conflict.id, action: 'update' });
		console.log(`✅ Conflict resolved: ${conflict.type}/${conflictId} (kept local)`);
	}

	if (pendingConflicts.length === 0 && syncStore.status === 'conflict') {
		syncStore.status = 'synced';
	}
}

type RemoteDecision = 'write' | 'push' | 'none';

/**
 * リモートの1件について、ローカルをどう扱うか決める(DB への書き込みは呼び出し側で行う)。
 * 'write': リモートの版でローカルを置き換える / 'push': ローカルをアップロードする
 */
async function decideRemote(
	type: EntityType,
	remote: SyncableEntity,
	local: SyncableEntity | undefined,
	policy: ConflictResolutionPolicy
): Promise<RemoteDecision> {
	if (!local) {
		// この端末で削除済みでアップロード待ちのものは復活させない
		if (findPending(type, remote.id)?.action === 'delete') return 'none';
		return 'write';
	}

	const base = getBase(type, remote.id);
	let action = reconcile(local, remote, base);
	if (action === 'conflict') {
		action = await handleConflict(type, local, remote, policy);
	}

	switch (action) {
		case 'apply-remote':
			// 未同期のローカル編集を上書きする場合は、先にバックアップする
			if ((base === undefined || local.updatedAt > base) && contentDiffers(local, remote)) {
				await backupEntity(type, local, 'conflict');
			}
			return 'write';
		case 'push-local':
			return 'push';
		case 'skip':
			setBase(type, remote.id, remote.updatedAt);
			return 'none';
		default:
			return 'none';
	}
}

const sameVersion = (a: SyncableEntity | undefined, b: SyncableEntity | undefined) =>
	a === undefined || b === undefined
		? a === b
		: a.updatedAt === b.updatedAt && a._version === b._version;

/**
 * リモートの複数件をまとめてローカルに反映する。ローカルが書き換わった場合 true。
 *
 * 突き合わせは上限付きの並列で行い、IndexedDB への書き込みは1つのトランザクションで bulkPut する。
 * トランザクション内でローカルが判定時から変わっていないことを再確認し、
 * 判定中にユーザーが編集していた項目は上書きしない(その編集は通常の送信で3者比較される)。
 * 1件でも失敗した場合は、残りを処理したうえで最初のエラーを投げる。
 */
async function reconcileBatch(
	type: EntityType,
	remotes: SyncableEntity[],
	policy: ConflictResolutionPolicy
): Promise<boolean> {
	if (remotes.length === 0) return false;
	const table = tableOf(type);
	const locals = await table.bulkGet(remotes.map((r) => r.id));

	const writes: { remote: SyncableEntity; seen: SyncableEntity | undefined }[] = [];
	const pushes: PendingChange[] = [];
	const results = await mapLimit(remotes, RECONCILE_CONCURRENCY, async (remote, i) => {
		const local = locals[i];
		const decision = await decideRemote(type, remote, local, policy);
		if (decision === 'write') writes.push({ remote, seen: local });
		else if (decision === 'push') pushes.push({ type, id: remote.id, action: 'update' });
	});

	enqueueManyAndSchedule(pushes);

	let applied: typeof writes = [];
	if (writes.length > 0) {
		await db.transaction('rw', table, async () => {
			const current = await table.bulkGet(writes.map((w) => w.remote.id));
			applied = writes.filter((w, i) => sameVersion(current[i], w.seen));
			// updatedAt / _version を書き換えないよう DB の update ではなく put で保存する
			await table.bulkPut(applied.map((w) => w.remote));
		});
		for (const { remote } of applied) setBase(type, remote.id, remote.updatedAt);
	}

	const failed = results.find((r) => r.status === 'rejected');
	if (failed && failed.status === 'rejected') throw failed.reason;
	return applied.length > 0;
}

/**
 * 他端末で削除されたものをローカルから取り除く。
 * 削除後にこの端末で編集されていた場合は、削除せず再アップロードする。
 */
async function applyRemoteDeletion(type: EntityType, id: string): Promise<boolean> {
	if (findPending(type, id)) return false;

	const local = await tableOf(type).get(id);
	if (!local) {
		removeBase(type, id);
		return false;
	}

	const base = getBase(type, id);
	if (base !== undefined && local.updatedAt > base) {
		enqueueAndSchedule({ type, id, action: 'update' });
		return false;
	}

	if (type === 'projects') {
		// プロジェクトの子要素は削除前にバックアップする
		for (const childType of PROJECT_SCOPED_TYPES) {
			const children = await tableOf(childType).where('projectId').equals(id).toArray();
			for (const child of children) await backupEntity(childType, child, 'remote-delete');
		}
		await projectsDB.delete(id);
	} else {
		await backupEntity(type, local, 'remote-delete');
		await tableOf(type).delete(id);
	}
	removeBase(type, id);
	return true;
}

/**
 * バックアップ(競合・他端末の削除で失われた版)を復元する。
 * 復元した版は新しい編集として扱い、他端末にも反映される。
 */
export async function restoreBackup(historyId: string): Promise<void> {
	const history = await historyDB.get(historyId);
	if (!history) throw new Error('バックアップが見つかりません');

	const type = ENTITY_TYPE_OF_HISTORY[history.entityType];
	const snapshot = history.snapshot as SyncableEntity;

	if (!(await projectsDB.getById(history.projectId))) {
		throw new Error('所属するプロジェクトが存在しないため復元できません');
	}

	const existing = await tableOf(type).get(history.entityId);
	// 現在の版は、復元で上書きする前に退避する
	if (existing) await backupEntity(type, existing, 'conflict');

	await tableOf(type).put({
		...snapshot,
		updatedAt: Date.now(),
		_version: Math.max(existing?._version ?? 0, snapshot._version ?? 0) + 1
	});
	await refreshStores(new Set([type]));
	await queueChange(type, history.entityId, existing ? 'update' : 'create');
}

/**
 * ストアを最新のローカルDBの内容に更新する
 */
async function refreshStores(types: Set<EntityType>): Promise<void> {
	try {
		if (types.has('projects')) {
			const { projectsStore } = await import('$lib/stores/projects.svelte');
			projectsStore.projects = await projectsDB.getAll();
		}
		const projectId = currentProjectStore.project?.id;
		if (!projectId) return;
		if (types.has('chapters')) {
			currentProjectStore.chapters = await chaptersDB.getByProjectId(projectId);
		}
		if (types.has('scenes')) {
			currentProjectStore.scenes = await scenesDB.getByProjectId(projectId);
		}
	} catch (err) {
		console.debug('Stores not updated:', err);
	}
}

/**
 * 他端末の変更をまとめて取り込む(最小間隔つき・差分取得)。
 * 取得を試みた時刻から最小間隔を数えるので、失敗が続いても毎回のトリガでは再試行しない。
 * バックオフ中・再試行不可のエラー中は何もしない。
 */
function refreshFromRemoteIfNeeded(): void {
	if (!navigator.onLine) return;
	const now = Date.now();
	if (now - lastDownloadAttemptAt < REMOTE_REFRESH_INTERVAL) return;
	if (!gates.download.canRun(now)) return;
	downloadAllFromFirestore().catch((err) => console.warn('Remote refresh failed:', err));
}

/** 溜まった変更を送る(バックオフ中・再試行不可のエラー中は何もしない) */
function flushPendingIfNeeded(): void {
	if (pendingChanges.size === 0) return;
	if (!gates.upload.canRun(Date.now())) return;
	void processPendingChanges();
}

/** 再試行可のエラーの後、バックオフ時間が経ったら自動で再実行する */
function scheduleRetry(kind: SyncKind, delayMs: number): void {
	const existing = retryTimers[kind];
	if (existing) clearTimeout(existing);
	console.log(`⏳ Retry ${kind} in ${Math.round(delayMs / 1000)}s`);
	retryTimers[kind] = setTimeout(() => {
		retryTimers[kind] = null;
		if (!isInitialized || !navigator.onLine) return;
		if (kind === 'download') {
			downloadAllFromFirestore().catch((err) => console.warn('Download retry failed:', err));
		} else {
			void processPendingChanges();
		}
	}, delayMs);
}

/** 処理の失敗を分類して記録し、再試行可なら次回を予約する */
function recordFailure(kind: SyncKind, error: unknown): void {
	const info = classifyError(error);
	runErrors[kind] = info.message;
	const delay = gates[kind].onFailure(info, Date.now());
	if (delay !== null) {
		scheduleRetry(kind, delay);
	} else {
		console.error(`❌ ${kind} failed with a non-retryable error (${info.code}): ${info.message}`);
	}
}

function recordSuccess(kind: SyncKind): void {
	runErrors[kind] = null;
	gates[kind].onSuccess();
}

/** バックオフ・再試行不可の状態を解除する(手動の操作や再初期化のとき) */
function resetGates(): void {
	for (const kind of ['upload', 'download'] as const) {
		gates[kind].reset();
		const timer = retryTimers[kind];
		if (timer) clearTimeout(timer);
		retryTimers[kind] = null;
	}
}

/**
 * 同期システムの初期化。実行中なら同じ Promise を返す(複数箇所から呼ばれても1回だけ実行する)
 */
export function initializeSync(): Promise<void> {
	if (isInitialized) {
		console.log('⏭️ Sync already initialized, skipping...');
		return Promise.resolve();
	}
	if (initPromise && initPromiseGeneration === initGeneration) return initPromise;

	// stopSync の後の再初期化は、古い初期化の終了を待ってから始める
	const previous = initPromise;
	initPromiseGeneration = initGeneration;
	const current: Promise<void> = (previous ? previous.catch(() => {}) : Promise.resolve())
		.then(doInitializeSync)
		.finally(() => {
			if (initPromise === current) initPromise = null;
		});
	initPromise = current;
	return current;
}

async function doInitializeSync(): Promise<void> {
	const generation = initGeneration;
	const { isFirebaseInitialized } = await import('$lib/firebase');
	if (generation !== initGeneration) return;

	if (!isFirebaseInitialized()) {
		console.log('ℹ️ Firebase not configured, sync system will not be initialized');
		syncStore.status = 'offline';
		isInitialized = true; // 初期化済みフラグを立てて再実行を防ぐ
		return;
	}

	console.log('🚀 Initializing sync system...');
	resetGates();

	historyDB.deleteOldHistory().catch((err) => console.warn('Failed to prune history:', err));

	// オンライン状態の監視(登録は1回だけ)
	monitorOnlineStatus();
	startNetworkMonitoring();

	// オンライン復帰時: 溜まった変更を送り、他端末の変更を取り込む。
	// 購読直後の初回通知(現在の状態)は無視する(起動時の取得は下で行う)
	let armed = false;
	unsubscribeNetwork = onNetworkStatusChange((status) => {
		if (!armed) return;
		if (status === 'online') {
			flushPendingIfNeeded();
			refreshFromRemoteIfNeeded();
		}
	});
	armed = true;

	// アプリに戻ってきたとき、他端末の変更を取り込む
	visibilityHandler = () => {
		if (document.visibilityState === 'visible') refreshFromRemoteIfNeeded();
	};
	document.addEventListener('visibilitychange', visibilityHandler);

	// 定期同期（5分ごと）
	syncInterval = window.setInterval(
		() => {
			if (!navigator.onLine) return;
			flushPendingIfNeeded();
			refreshFromRemoteIfNeeded();
		},
		5 * 60 * 1000
	);

	// Firestore にあるデータをローカルに取り込む（別端末で作成・更新されたものを反映する）。
	// 前回の完全同期から時間が経っていれば完全取得になる
	if (navigator.onLine) {
		try {
			console.log('📥 Checking Firestore for remote data to download...');
			await downloadAllFromFirestore({ trigger: 'startup' });
		} catch (err) {
			console.warn('Failed to download initial data from Firestore:', err);
		}
	}

	// stopSync が呼ばれていたら、ここから先は行わない
	if (generation !== initGeneration) return;

	// 前回の起動で送れなかった変更を送る
	if (navigator.onLine) flushPendingIfNeeded();

	// 初期化完了フラグを設定
	isInitialized = true;

	// 初期化成功 - オンライン状態に設定
	if (navigator.onLine && syncStore.status !== 'error') {
		syncStore.status = settledStatus();
	}

	console.log('✅ Sync system initialized');
}

/**
 * 同期システムの停止
 */
export function stopSync(): void {
	initGeneration++;
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
	if (visibilityHandler) {
		document.removeEventListener('visibilitychange', visibilityHandler);
		visibilityHandler = null;
	}
	if (unsubscribeNetwork) {
		unsubscribeNetwork();
		unsubscribeNetwork = null;
	}
	for (const kind of ['upload', 'download'] as const) {
		const timer = retryTimers[kind];
		if (timer) clearTimeout(timer);
		retryTimers[kind] = null;
	}
	flushSyncMeta();
	isInitialized = false;
	console.log('🛑 Sync system stopped');
}

/**
 * 変更を同期キューに追加
 */
export async function queueChange(
	type: EntityType,
	id: string,
	action: 'create' | 'update' | 'delete'
): Promise<void> {
	console.log(`📝 Queueing change: ${type}/${id} (${action})`);

	// キューへの登録だけを待つ。アップロードは裏で予約し、完了は待たない
	enqueue({ type, id, action });
	void scheduleSyncIfReady();
}

async function scheduleSyncIfReady(): Promise<void> {
	try {
		const { isFirebaseInitialized } = await import('$lib/firebase');
		if (navigator.onLine && isFirebaseInitialized()) {
			// デバウンス処理で同期（連続した変更をまとめる）
			scheduleProcess();
		} else {
			console.log(`⏳ Sync deferred - will sync when conditions are met`);
		}
	} catch (error) {
		console.error('Failed to schedule sync:', error);
	}
}

/** 1回の処理の打ち切りフラグ(タイムアウト後に、残りの作業が続きを進めないようにする) */
interface RunContext {
	cancelled: boolean;
}

function throwIfCancelled(ctx: RunContext): void {
	if (ctx.cancelled) throw new Error('同期がタイムアウトしたため中断しました');
}

/**
 * ペンディング中の変更を処理
 */
async function processPendingChanges(): Promise<void> {
	// await より前に同期的にロックを取る(二重起動を防ぐ)。ロック中に積まれた変更は終了後に再予約される
	if (isProcessing || pendingChanges.size === 0) return;
	// バックオフ中・再試行不可のエラー中は送らない(変更はキューに残る)
	if (!gates.upload.canRun(Date.now())) return;
	isProcessing = true;

	try {
		// 取得(runDownload)と同時には走らせない
		await syncMutex.runExclusive(runUpload);
	} finally {
		isProcessing = false;
	}

	// 処理中に追加された変更があれば続けて処理する
	if (pendingChanges.size > 0 && gates.upload.canRun(Date.now()) && !runErrors.upload) {
		scheduleProcess();
	}
}

async function runUpload(): Promise<void> {
	if (pendingChanges.size === 0) return;

	// Firebaseが初期化されていない場合はスキップ
	const { isFirebaseInitialized } = await import('$lib/firebase');
	if (!isFirebaseInitialized()) {
		console.warn('⚠️ Firebase not initialized, skipping sync');
		return;
	}

	// ロック待ちの間に積まれた変更も含めて、ここで取り出す
	const changes = [...pendingChanges.values()];
	console.log(`📤 Processing ${changes.length} pending change(s)...`);

	beginActivity();
	setProgress('upload', 0, changes.length);
	pendingChanges = new Map();
	inFlight = new Map(changes.map((c) => [changeKey(c), c]));
	persistPending();

	const startedAt = performance.now();
	const ctx: RunContext = { cancelled: false };
	// 送信が完了した(キューから外してよい)変更
	const completed = new Set<string>();
	let ok = false;
	try {
		const policy = await getPolicy();
		await withTimeout(
			uploadChanges(changes, policy, ctx, completed),
			OPERATION_TIMEOUT,
			'送信',
			() => {
				ctx.cancelled = true;
			}
		);
		ok = true;
		console.log('✅ All changes synced successfully');
		syncStore.lastSyncTime = Date.now();
		recordSuccess('upload');
	} catch (error) {
		console.error('❌ Sync error:', error);
		// 失敗した変更だけをキューに戻す。処理中に積まれた新しい変更があればそちらを優先する
		for (const change of changes) {
			const key = changeKey(change);
			if (!completed.has(key) && !pendingChanges.has(key)) pendingChanges.set(key, change);
		}
		persistPending();
		recordFailure('upload', error);
	} finally {
		inFlight = new Map();
		endActivity();
		recordSyncMetric({
			kind: 'processPendingChanges',
			durationMs: performance.now() - startedAt,
			count: completed.size,
			ok
		});
	}
}

type UploadOp =
	| { kind: 'delete'; change: PendingChange }
	| { kind: 'set'; change: PendingChange; local: SyncableEntity };

/**
 * 変更をまとめて送る。
 * 1) 上限付き並列で、ローカルの読み出しとリモートの取得(3者比較)を行う
 * 2) 送信が必要なものを WriteBatch(件数・サイズの上限で分割)でコミットする
 * 同一ドキュメントの変更はキュー上で1件にまとまっているので、順序は保たれる。
 * 成功したものは completed に入れる。失敗があれば、可能な分を進めたうえで最初のエラーを投げる。
 */
async function uploadChanges(
	changes: PendingChange[],
	policy: ConflictResolutionPolicy,
	ctx: RunContext,
	completed: Set<string>
): Promise<void> {
	const total = changes.length;
	let done = 0;
	const refreshTypes = new Set<EntityType>();
	const ops: UploadOp[] = [];
	const errors: unknown[] = [];

	try {
		const results = await mapLimit(changes, UPLOAD_PREPARE_CONCURRENCY, async (change) => {
			throwIfCancelled(ctx);
			const op = await prepareUpload(change, policy, refreshTypes);
			if (op) {
				ops.push(op);
			} else {
				completed.add(changeKey(change));
				setProgress('upload', ++done, total);
			}
		});
		for (const r of results) if (r.status === 'rejected') errors.push(r.reason);

		// 元のキューの順序でコミットする
		const order = new Map(changes.map((c, i) => [changeKey(c), i]));
		ops.sort((x, y) => order.get(changeKey(x.change))! - order.get(changeKey(y.change))!);

		const sized = ops.map((op) => ({
			op,
			size: op.kind === 'set' ? JSON.stringify(op.local).length : 200
		}));
		for (const batch of chunkBatches(sized)) {
			throwIfCancelled(ctx);
			try {
				await commitBatchOps(
					batch.map(
						({ op }): BatchOp =>
							op.kind === 'delete'
								? { kind: 'delete', entityType: op.change.type, id: op.change.id }
								: { kind: 'set', entityType: op.change.type, entity: op.local }
					)
				);
			} catch (error) {
				// このバッチは全件失敗(原子的)。以降は同じ原因で失敗する可能性が高いので打ち切る
				errors.push(error);
				break;
			}
			for (const { op } of batch) {
				if (op.kind === 'delete') {
					removeBase(op.change.type, op.change.id);
				} else {
					setBase(op.change.type, op.change.id, op.local.updatedAt);
				}
				completed.add(changeKey(op.change));
			}
			done += batch.length;
			setProgress('upload', done, total);
		}
	} finally {
		if (refreshTypes.size > 0) await refreshStores(refreshTypes);
	}

	if (errors.length > 0) throw errors[0];
}

/**
 * 個別の変更を、送信してよいか判定する。送信が必要なら UploadOp を返し、
 * 送信不要(スキップ・競合・リモートを採用・対象なし)なら null を返す。
 */
async function prepareUpload(
	change: PendingChange,
	policy: ConflictResolutionPolicy,
	refreshTypes: Set<EntityType>
): Promise<UploadOp | null> {
	const { type, id, action } = change;

	if (action === 'delete') return { kind: 'delete', change };

	const local = await tableOf(type).get(id);
	if (!local) {
		// ローカルに無い create/update は、リモートにも無いと確認できた場合だけキューから外す。
		// 確認できない場合(通信エラー等)は例外のまま伝播し、変更はキューに残る。
		const remoteExisting = await syncFromFirestore(type, id);
		if (!remoteExisting) {
			console.warn(
				`Dropping ${action} for ${type}/${id}: not found locally nor in Firestore (nothing to upload)`
			);
		} else {
			console.warn(
				`Dropping ${action} for ${type}/${id}: deleted locally without a queued delete; ` +
					'the Firestore copy is left untouched and may be re-downloaded'
			);
		}
		return null;
	}

	// リモートデータを取得して競合チェック
	const remote = await syncFromFirestore(type, id);
	if (remote) {
		let result = reconcile(local, remote, getBase(type, id));
		if (result === 'conflict') {
			result = await handleConflict(type, local, remote, policy);
		}

		if (result === 'apply-remote') {
			if (contentDiffers(local, remote)) await backupEntity(type, local, 'conflict');
			await tableOf(type).put(remote);
			setBase(type, id, remote.updatedAt);
			refreshTypes.add(type);
			return null;
		}
		if (result === 'conflict') return null; // 手動解決待ち(アップロードしない)
		if (result === 'skip') {
			setBase(type, id, local.updatedAt);
			return null;
		}
	}

	console.log(`📤 Uploading ${type}/${id} to Firestore...`);
	return { kind: 'set', change, local };
}

/**
 * リアルタイム同期で受信したデータを反映する
 */
function applyRealtimeEntities(type: EntityType, entities: SyncableEntity[]): Promise<void> {
	return measureSync(
		'applyRealtime',
		type,
		() => applyRealtimeEntitiesInner(type, entities),
		() => entities.length
	);
}

async function applyRealtimeEntitiesInner(
	type: EntityType,
	entities: SyncableEntity[]
): Promise<void> {
	const policy = await getPolicy();
	let changed = false;
	// 変化のあった分(初回スナップショットは全件)を、チャンクごとにまとめて反映する
	for (let i = 0; i < entities.length; i += RECONCILE_CHUNK_SIZE) {
		const chunk = entities.slice(i, i + RECONCILE_CHUNK_SIZE);
		try {
			if (await reconcileBatch(type, chunk, policy)) changed = true;
		} catch (error) {
			console.error(`Failed to apply ${chunk.length} ${type} document(s):`, error);
		}
	}
	if (changed) await refreshStores(new Set([type]));
}

async function applyRealtimeRemovals(type: EntityType, ids: string[]): Promise<void> {
	let changed = false;
	for (const id of ids) {
		try {
			if (await applyRemoteDeletion(type, id)) changed = true;
		} catch (error) {
			console.error(`Failed to remove ${type}/${id}:`, error);
		}
	}
	if (changed) await refreshStores(new Set([type]));
}

/**
 * 現在のプロジェクトのリアルタイム同期を開始
 * プロジェクトを開いた時に呼び出す
 */
export async function startCurrentProjectSync(projectId: string): Promise<void> {
	console.log(`🚀 Starting realtime sync for project: ${projectId}`);

	// 設定で同期が無効化されているか確認
	const { settingsDB } = await import('$lib/db');
	const settings = await settingsDB.get();

	if (!settings.syncEnabled) {
		console.log('⏭️ Sync is disabled in settings, skipping project sync');
		return;
	}

	// Firebaseが初期化されているか確認
	const { isFirebaseInitialized } = await import('$lib/firebase');
	if (!isFirebaseInitialized()) {
		console.warn('⚠️ Firebase not initialized, skipping project sync');
		return;
	}

	// 既存の監視を停止
	stopCurrentProjectSync();

	currentProjectUnsubscribers = PROJECT_SCOPED_TYPES.map((type) =>
		setupRealtimeSync(
			type,
			(entities) => {
				void applyRealtimeEntities(type, entities);
			},
			(error) => {
				console.error(`${type} realtime sync error:`, error);
				syncStore.error = error.message;
			},
			projectId,
			(ids) => {
				void applyRealtimeRemovals(type, ids);
			}
		)
	);
	console.log(`✅ Realtime sync started for project: ${projectId}`);
}

/**
 * 現在のプロジェクトのリアルタイム同期を停止
 */
export function stopCurrentProjectSync(): void {
	if (currentProjectUnsubscribers.length > 0) {
		console.log(`🛑 Stopping realtime sync for current project`);
		currentProjectUnsubscribers.forEach((unsub) => unsub());
		currentProjectUnsubscribers = [];
	}
}

/**
 * 現在のプロジェクトの全データを同期(ローカルの内容をそのままアップロード)
 */
export async function syncCurrentProject(projectId: string): Promise<void> {
	beginActivity();

	try {
		const upload = async (type: EntityType, entity: SyncableEntity) => {
			await syncToFirestore(type, entity);
			setBase(type, entity.id, entity.updatedAt);
		};

		const project = await projectsDB.getById(projectId);
		if (project) await upload('projects', project);

		for (const chapter of await chaptersDB.getByProjectId(projectId)) {
			await upload('chapters', chapter);
		}
		for (const scene of await scenesDB.getByProjectId(projectId)) {
			await upload('scenes', scene);
		}
		for (const character of await charactersDB.getByProjectId(projectId)) {
			await upload('characters', character);
		}
		for (const plot of await plotsDB.getByProjectId(projectId)) {
			await upload('plots', plot);
		}
		for (const worldbuilding of await worldbuildingDB.getByProjectId(projectId)) {
			await upload('worldbuilding', worldbuilding);
		}

		syncStore.lastSyncTime = Date.now();
		runErrors.project = null;
	} catch (error) {
		console.error('Project sync error:', error);
		runErrors.project = error instanceof Error ? error.message : 'Unknown error';
		throw error;
	} finally {
		endActivity();
	}
}

interface DownloadTypeResult {
	changed: boolean;
	fetched: number;
	skipped: number;
}

/**
 * 1種類のエンティティについて、Firestore との差分をローカルに反映する。
 * plan が差分取得のときは、更新されたものだけを取得し、削除の判定(リモートに無い＝削除)は行わない。
 */
async function downloadType(
	type: EntityType,
	plan: TypePlan,
	policy: ConflictResolutionPolicy,
	ctx: RunContext,
	progress: { done: number; total: number }
): Promise<DownloadTypeResult> {
	const started = performance.now();
	let fetched = 0;
	let skipped = 0;
	let ok = false;
	try {
		const remotes = await syncAllFromFirestore(
			type,
			undefined,
			plan.mode === 'diff' ? plan.since : undefined
		);
		fetched = remotes.length;
		progress.total += remotes.length;
		setProgress('download', progress.done, progress.total);
		console.log(`📦 Found ${remotes.length} ${type} in Firestore (${plan.mode})`);
		let changed = false;

		for (let i = 0; i < remotes.length; i += RECONCILE_CHUNK_SIZE) {
			throwIfCancelled(ctx);
			const chunk = remotes.slice(i, i + RECONCILE_CHUNK_SIZE);
			if (await reconcileBatch(type, chunk, policy)) changed = true;
			progress.done += chunk.length;
			setProgress('download', progress.done, progress.total);
		}

		const table = tableOf(type);
		if (canDetectRemoteDeletion(plan)) {
			// Firestore に無いローカルデータ(完全取得のときだけ判定する):
			//  同期済みだったもの → 他端末で削除された。未同期のもの → 未アップロードなので送る
			throwIfCancelled(ctx);
			const remoteIds = new Set(remotes.map((r) => r.id));
			const { removals, uploads } = classifyLocalOnly(
				plan,
				(await table.toCollection().primaryKeys()) as string[],
				remoteIds,
				(id) => findPending(type, id) !== undefined,
				(id) => getBase(type, id) !== undefined
			);
			for (const id of removals) {
				if (await applyRemoteDeletion(type, id)) changed = true;
			}
			enqueueManyAndSchedule(uploads.map((id) => ({ type, id, action: 'create' as const })));
		} else {
			skipped = Math.max(0, (await table.count()) - remotes.length);
		}

		ok = true;
		return { changed, fetched, skipped };
	} finally {
		recordSyncMetric({
			kind: 'download',
			label: `${type}:${plan.mode}`,
			durationMs: performance.now() - started,
			count: fetched,
			skipped: plan.mode === 'diff' ? skipped : undefined,
			ok
		});
	}
}

/**
 * Firestoreから取り込む。
 * 通常(trigger 省略 / 'periodic')は型ごとの最終同期時刻以降の差分だけを取得する。
 * 'startup' は前回の完全同期から一定時間が経っていれば、'manual-full' は常に、完全取得(削除の検知を含む)を行う。
 * 同時実行は1つにまとめる。
 */
export function downloadAllFromFirestore(
	options: { trigger?: DownloadTrigger } = {}
): Promise<void> {
	const trigger = options.trigger ?? 'periodic';
	if (downloadPromise) {
		// 実行中の取得が完全同期でなければ、手動の完全同期はその後に改めて実行する
		if (trigger === 'manual-full' && downloadTrigger !== 'manual-full') {
			return downloadPromise.catch(() => {}).then(() => downloadAllFromFirestore(options));
		}
		return downloadPromise;
	}
	downloadTrigger = trigger;
	downloadPromise = runDownload(trigger).finally(() => {
		downloadPromise = null;
		downloadTrigger = null;
	});
	return downloadPromise;
}

/**
 * 完全同期(全件を取得して照合し、他端末での削除も検知する)。設定画面の手動ボタンから呼ぶ
 */
export function runFullSync(): Promise<void> {
	resetGates();
	return downloadAllFromFirestore({ trigger: 'manual-full' });
}

function runDownload(trigger: DownloadTrigger): Promise<void> {
	let downloaded = 0;
	return measureSync(
		'download',
		trigger === 'manual-full' ? 'full-sync' : undefined,
		// 取得と送信は同時に走らせない
		() =>
			syncMutex.runExclusive(() =>
				runDownloadInner(trigger, (fetched) => {
					downloaded += fetched;
				})
			),
		() => downloaded
	);
}

async function runDownloadInner(
	trigger: DownloadTrigger,
	addCount: (fetched: number) => void
): Promise<void> {
	console.log(`📥 Downloading data from Firestore (${trigger})...`);
	// 失敗しても「試行時刻」を残し、最小間隔の判定に使う
	lastDownloadAttemptAt = Date.now();
	beginActivity();
	setProgress('download', 0, 0);

	const ctx: RunContext = { cancelled: false };
	try {
		await withTimeout(downloadAllTypes(trigger, ctx, addCount), OPERATION_TIMEOUT, '取得', () => {
			ctx.cancelled = true;
		});
		syncStore.lastSyncTime = Date.now();
		recordSuccess('download');
		console.log('✅ Download completed successfully');
	} catch (error) {
		console.error('❌ Download error:', error);
		recordFailure('download', error);
		throw error;
	} finally {
		endActivity();
	}
}

async function downloadAllTypes(
	trigger: DownloadTrigger,
	ctx: RunContext,
	addCount: (fetched: number) => void
): Promise<void> {
	const startedAt = Date.now();
	const policy = await getPolicy();
	console.log(`🔧 Conflict resolution policy: ${policy}`);

	const state = loadSyncState();
	const counts = await Promise.all(ENTITY_TYPES.map((type) => tableOf(type).count()));
	const plan = planDownload({
		now: startedAt,
		trigger,
		types: ENTITY_TYPES,
		lastFullSyncAt: state.lastFullSyncAt,
		lastSyncTimes: state.lastSyncTimes,
		localCounts: Object.fromEntries(ENTITY_TYPES.map((t, i) => [t, counts[i]]))
	});

	const progress = { done: 0, total: 0 };
	const changedTypes = new Set<EntityType>();
	const succeeded = new Set<EntityType>();
	const errors: unknown[] = [];

	const run = async (type: EntityType) => {
		try {
			const result = await downloadType(type, plan[type], policy, ctx, progress);
			if (result.changed) changedTypes.add(type);
			succeeded.add(type);
			addCount(result.fetched);
		} catch (error) {
			errors.push(error);
		}
	};

	// プロジェクトを先に処理し、子要素は並列に処理する
	await run('projects');
	if (succeeded.has('projects')) {
		await Promise.all(PROJECT_SCOPED_TYPES.map(run));
	}

	// 成功した型の取得時刻を記録する(取得開始時刻。次回は安全マージンを引いて使う)
	if (!ctx.cancelled && succeeded.size > 0) {
		const lastSyncTimes = { ...state.lastSyncTimes };
		for (const type of succeeded) lastSyncTimes[type] = startedAt;
		const fullDone = ENTITY_TYPES.every((t) => succeeded.has(t) && plan[t].mode === 'full');
		saveSyncState({
			lastFullSyncAt: fullDone ? startedAt : state.lastFullSyncAt,
			lastSyncTimes
		});
	}

	// 変化のあった型だけ、全体で1回だけストアを更新する
	if (changedTypes.size > 0) await refreshStores(changedTypes);

	if (errors.length > 0) throw errors[0];
}
