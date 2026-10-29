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
	deleteFromFirestore,
	setupRealtimeSync,
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
	type PendingChange
} from '$lib/firebase/syncMeta';
import { syncStore } from '$lib/stores/sync.svelte';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { startNetworkMonitoring, onNetworkStatusChange } from '$lib/utils/offline';
import { debounceAsync } from '$lib/utils/debounce';
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

// 他端末の変更を取り込む最短間隔
const REMOTE_REFRESH_INTERVAL = 60 * 1000;

// 未アップロードの変更(再読み込みで失われないよう localStorage にも保存する)
let pendingChanges: PendingChange[] = loadPendingChanges();
// アップロード処理中の変更(リアルタイム同期で巻き戻されないよう保護する)
let inFlight: PendingChange[] = [];
const pendingConflicts: PendingConflict[] = [];
let syncInterval: number | null = null;
let visibilityHandler: (() => void) | null = null;
let isInitialized = false;
let currentProjectUnsubscribers: Unsubscribe[] = [];
let downloadPromise: Promise<void> | null = null;
let lastDownloadAt = 0;

// デバウンスされた同期処理（3秒）
const debouncedProcessPendingChanges = debounceAsync(processPendingChanges, 3000);

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

function findPending(type: EntityType, id: string): PendingChange | undefined {
	return (
		pendingChanges.find((c) => c.type === type && c.id === id) ??
		inFlight.find((c) => c.type === type && c.id === id)
	);
}

function enqueue(change: PendingChange): void {
	const existing = pendingChanges.find((c) => c.type === change.type && c.id === change.id);
	if (existing) {
		existing.action = change.action;
	} else {
		pendingChanges.push(change);
	}
	savePendingChanges(pendingChanges);
}

/**
 * 保存済みの変更をキューに載せて、同期を予約する(同期完了は待たない)
 */
function enqueueAndSchedule(change: PendingChange): void {
	enqueue(change);
	if (navigator.onLine) {
		void debouncedProcessPendingChanges();
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

/**
 * リモートの1件をローカルに反映する。ローカルが書き換わった場合 true。
 */
async function reconcileRemote(
	type: EntityType,
	remote: SyncableEntity,
	policy: ConflictResolutionPolicy
): Promise<boolean> {
	const local = await tableOf(type).get(remote.id);

	if (!local) {
		// この端末で削除済みでアップロード待ちのものは復活させない
		if (findPending(type, remote.id)?.action === 'delete') return false;
		await tableOf(type).put(remote);
		setBase(type, remote.id, remote.updatedAt);
		return true;
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
			// updatedAt / _version を書き換えないよう DB の update ではなく put で保存する
			await tableOf(type).put(remote);
			setBase(type, remote.id, remote.updatedAt);
			return true;
		case 'push-local':
			enqueueAndSchedule({ type, id: remote.id, action: 'update' });
			return false;
		case 'skip':
			setBase(type, remote.id, remote.updatedAt);
			return false;
		default:
			return false;
	}
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
 * 他端末の変更をまとめて取り込む(最小間隔つき)
 */
function refreshFromRemoteIfNeeded(): void {
	if (!navigator.onLine) return;
	if (Date.now() - lastDownloadAt < REMOTE_REFRESH_INTERVAL) return;
	downloadAllFromFirestore().catch((err) => console.warn('Remote refresh failed:', err));
}

/**
 * 同期システムの初期化
 */
export async function initializeSync(): Promise<void> {
	// 既に初期化済みの場合はスキップ
	if (isInitialized) {
		console.log('⏭️ Sync already initialized, skipping...');
		return;
	}

	const { isFirebaseInitialized } = await import('$lib/firebase');

	if (!isFirebaseInitialized()) {
		console.log('ℹ️ Firebase not configured, sync system will not be initialized');
		syncStore.status = 'offline';
		isInitialized = true; // 初期化済みフラグを立てて再実行を防ぐ
		return;
	}

	console.log('🚀 Initializing sync system...');

	historyDB.deleteOldHistory().catch((err) => console.warn('Failed to prune history:', err));

	// オンライン状態の監視
	monitorOnlineStatus();
	startNetworkMonitoring();

	// オンライン復帰時: 溜まった変更を送り、他端末の変更を取り込む
	onNetworkStatusChange((status) => {
		if (status === 'online') {
			if (pendingChanges.length > 0) void processPendingChanges();
			refreshFromRemoteIfNeeded();
		}
	});

	// アプリに戻ってきたとき、他端末の変更を取り込む
	visibilityHandler = () => {
		if (document.visibilityState === 'visible') refreshFromRemoteIfNeeded();
	};
	document.addEventListener('visibilitychange', visibilityHandler);

	// 定期同期（5分ごと）
	syncInterval = window.setInterval(
		() => {
			if (!navigator.onLine) return;
			if (pendingChanges.length > 0) void processPendingChanges();
			refreshFromRemoteIfNeeded();
		},
		5 * 60 * 1000
	);

	// Firestore にあるデータをローカルに取り込む（別端末で作成・更新されたものを反映する）
	if (navigator.onLine) {
		try {
			console.log('📥 Checking Firestore for remote data to download...');
			await downloadAllFromFirestore();
		} catch (err) {
			console.warn('Failed to download initial data from Firestore:', err);
		}
	}

	// 前回の起動で送れなかった変更を送る
	if (navigator.onLine && pendingChanges.length > 0) {
		void processPendingChanges();
	}

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
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
	if (visibilityHandler) {
		document.removeEventListener('visibilitychange', visibilityHandler);
		visibilityHandler = null;
	}
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

	enqueue({ type, id, action });

	// Firebaseが初期化されていて、かつオンラインなら即座に同期
	const { isFirebaseInitialized } = await import('$lib/firebase');
	const firebaseReady = isFirebaseInitialized();
	const online = navigator.onLine;

	if (online && firebaseReady) {
		// デバウンス処理で同期（連続した変更をまとめる）
		await debouncedProcessPendingChanges();
	} else {
		console.log(`⏳ Sync deferred - will sync when conditions are met`);
	}
}

/**
 * ペンディング中の変更を処理
 */
async function processPendingChanges(): Promise<void> {
	if (pendingChanges.length === 0 || inFlight.length > 0) return;

	// Firebaseが初期化されていない場合はスキップ
	const { isFirebaseInitialized } = await import('$lib/firebase');
	if (!isFirebaseInitialized()) {
		console.warn('⚠️ Firebase not initialized, skipping sync');
		return;
	}

	console.log(`📤 Processing ${pendingChanges.length} pending change(s)...`);

	syncStore.isSyncing = true;
	syncStore.status = 'syncing';

	const changes = [...pendingChanges];
	pendingChanges = [];
	inFlight = changes;
	savePendingChanges(pendingChanges);

	// 失敗した変更以降は、処理中に積まれた新しい変更を優先しつつキューに戻す
	let processed = 0;
	try {
		const policy = await getPolicy();
		for (; processed < changes.length; processed++) {
			await processChange(changes[processed], policy);
		}
		console.log('✅ All changes synced successfully');
		syncStore.lastSyncTime = Date.now();
		syncStore.status = settledStatus();
		syncStore.error = null;
	} catch (error) {
		console.error('❌ Sync error:', error);
		for (const change of changes.slice(processed)) {
			if (!pendingChanges.some((c) => c.type === change.type && c.id === change.id)) {
				pendingChanges.push(change);
			}
		}
		savePendingChanges(pendingChanges);
		syncStore.error = error instanceof Error ? error.message : 'Unknown error';
		syncStore.status = 'error';
	} finally {
		inFlight = [];
		syncStore.isSyncing = false;
	}

	// 処理中に追加された変更があれば続けて処理する
	if (pendingChanges.length > 0 && syncStore.status !== 'error') {
		void debouncedProcessPendingChanges();
	}
}

/**
 * 個別の変更を処理
 */
async function processChange(
	change: PendingChange,
	policy: ConflictResolutionPolicy
): Promise<void> {
	const { type, id, action } = change;

	if (action === 'delete') {
		await deleteFromFirestore(type, id);
		removeBase(type, id);
		return;
	}

	const local = await tableOf(type).get(id);
	if (!local) {
		console.warn(`Local data not found for ${type}/${id}`);
		return;
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
			await refreshStores(new Set([type]));
			return;
		}
		if (result === 'conflict') return; // 手動解決待ち(アップロードしない)
		if (result === 'skip') {
			setBase(type, id, local.updatedAt);
			return;
		}
	}

	console.log(`📤 Uploading ${type}/${id} to Firestore...`);
	await syncToFirestore(type, local);
	setBase(type, id, local.updatedAt);
}

/**
 * リアルタイム同期で受信したデータを反映する
 */
async function applyRealtimeEntities(type: EntityType, entities: SyncableEntity[]): Promise<void> {
	const policy = await getPolicy();
	let changed = false;
	for (const remote of entities) {
		try {
			if (await reconcileRemote(type, remote, policy)) changed = true;
		} catch (error) {
			console.error(`Failed to apply ${type}/${remote.id}:`, error);
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
	syncStore.isSyncing = true;
	syncStore.status = 'syncing';

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
		syncStore.status = settledStatus();
		syncStore.error = null;
	} catch (error) {
		console.error('Project sync error:', error);
		syncStore.error = error instanceof Error ? error.message : 'Unknown error';
		syncStore.status = 'error';
		throw error;
	} finally {
		syncStore.isSyncing = false;
	}
}

/**
 * 1種類のエンティティについて、Firestore との差分をローカルに反映する
 */
async function downloadType(type: EntityType, policy: ConflictResolutionPolicy): Promise<boolean> {
	const remotes = await syncAllFromFirestore(type);
	console.log(`📦 Found ${remotes.length} ${type} in Firestore`);
	const remoteIds = new Set(remotes.map((r) => r.id));
	let changed = false;

	for (const remote of remotes) {
		if (await reconcileRemote(type, remote, policy)) changed = true;
	}

	// Firestore に無いローカルデータ:
	//  同期済みだったもの → 他端末で削除された。未同期のもの → 未アップロードなので送る
	for (const local of await tableOf(type).toArray()) {
		if (remoteIds.has(local.id) || findPending(type, local.id)) continue;

		if (getBase(type, local.id) !== undefined) {
			if (await applyRemoteDeletion(type, local.id)) changed = true;
		} else {
			enqueueAndSchedule({ type, id: local.id, action: 'create' });
		}
	}

	return changed;
}

/**
 * 全データをFirestoreからダウンロード
 */
export function downloadAllFromFirestore(): Promise<void> {
	// 同時実行は1つにまとめる
	if (!downloadPromise) {
		downloadPromise = runDownload().finally(() => {
			downloadPromise = null;
		});
	}
	return downloadPromise;
}

async function runDownload(): Promise<void> {
	console.log('📥 Downloading all data from Firestore...');
	syncStore.isSyncing = true;
	syncStore.status = 'syncing';

	try {
		const policy = await getPolicy();
		console.log(`🔧 Conflict resolution policy: ${policy}`);

		const changedTypes = new Set<EntityType>();
		// プロジェクト → 子要素の順に処理する
		for (const type of ENTITY_TYPES) {
			if (await downloadType(type, policy)) changedTypes.add(type);
		}

		console.log('✅ Download completed successfully');
		await refreshStores(changedTypes.add('projects'));

		lastDownloadAt = Date.now();
		syncStore.lastSyncTime = Date.now();
		syncStore.status = settledStatus();
		syncStore.error = null;
	} catch (error) {
		console.error('❌ Download error:', error);
		syncStore.error = error instanceof Error ? error.message : 'Unknown error';
		syncStore.status = 'error';
		throw error;
	} finally {
		syncStore.isSyncing = false;
	}
}
