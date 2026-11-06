import type { Table } from 'dexie';
import {
	db,
	connectionsDB,
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
	targetFromKey,
	type BatchOp,
	monitorOnlineStatus,
	type EntityType,
	type SyncableEntity
} from '$lib/firebase/sync';
import { prepareConflictData, type ConflictData } from '$lib/firebase/conflict';
import {
	adoptOwnedFields,
	reconcile,
	reconcileOwned,
	reconcileReadOnly,
	type ReconcileAction
} from '$lib/firebase/reconcile';
import { crdtSceneIdsIn } from '$lib/crdt/persistence';
import { isFirebaseInitialized } from '$lib/firebase/config';
import {
	awaitConnectionReady,
	hasRegisteredConnections,
	isConnectionRegistered,
	unregisterConnection
} from '$lib/firebase/connection';
import { isPermissionDeniedError } from '$lib/firebase/joinPolicy';
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
	pendingKey,
	targetOf,
	getTargetState,
	withTargetState,
	withoutTargetState,
	type PendingChange
} from '$lib/firebase/syncMeta';
import {
	PRIMARY_KEY,
	effectiveTargetKey,
	isExcludedFromPrimary,
	isGuestSharing,
	isReadOnlySharing,
	isRevokedSharing,
	isSharedStatus,
	parseTargetKey,
	pidOfTargetKey,
	primaryExcludedIds,
	sharedTargetKey,
	targetKeyForEntity,
	targetKeyForProject,
	withoutSharedChildren,
	type SyncTarget
} from '$lib/firebase/syncTarget';
import { adoptSharing } from '$lib/firebase/sharingAdopt';
import {
	planDownload,
	classifyLocalOnly,
	chunkBatches,
	canDetectRemoteDeletion,
	type DownloadTrigger,
	type TypePlan
} from '$lib/firebase/syncPlan';
import { syncStore } from '$lib/stores/sync.svelte';
import { authStore, NEEDS_OWNER_MESSAGE } from '$lib/stores/auth.svelte';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { startNetworkMonitoring, onNetworkStatusChange } from '$lib/utils/offline';
import { debounceAsync } from '$lib/utils/debounce';
import { measureSync, recordSyncMetric } from '$lib/utils/syncMetrics';
import { Mutex, withTimeout, mapLimit } from '$lib/utils/asyncControl';
import { classifyError, RetryGate } from '$lib/utils/syncErrors';
import type { AccessMode, ConflictResolutionPolicy, History, Project, Scene } from '$lib/types';
import type { Unsubscribe } from 'firebase/firestore';

interface PendingConflict {
	type: EntityType;
	id: string;
	/** 競合が起きたターゲット(旧形式は primary) */
	target?: string;
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

// pending / 処理中の変更のキー(ターゲットを含む。primary は従来どおり type/id)
const changeKey = pendingKey;

// 未アップロードの変更(再読み込みで失われないよう localStorage にも保存する)。キーは type/id
const pendingChanges = new Map<string, PendingChange>(
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
const runErrors: Record<string, string | null> = {
	upload: null,
	download: null,
	project: null,
	// アクセスモード(needs-owner)による停止。同期の処理自体は走らせないので、別枠で持つ
	access: null
};
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
// 定期同期・復帰時の取得などの仕組みを起動済みか(Firebase 未設定のまま isInitialized だけ立てた場合は false)
let syncLoopsStarted = false;
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

// ---------- ゲスト(招待で参加した共有プロジェクト) ----------
// ゲストのプロジェクトは、ホストの Firebase(ゲスト接続)または主 Firebase のインスタンス(接続なし)の
// shared/{pid} とだけ同期する。主 Firebase の同期設定(未設定・無効・オーナー未登録)とは独立して動く。

// ゲストとして主 Firebase のインスタンスを使うプロジェクトの数(接続を持たないゲスト)。起動時と参加・退出で更新する
let primaryGuestCount = 0;

/** 主 Firebase とは独立して動かすゲスト同期があるか */
function hasGuestWork(): boolean {
	return hasRegisteredConnections() || primaryGuestCount > 0;
}

async function refreshGuestFlags(): Promise<void> {
	const projects = await db.projects.toArray();
	primaryGuestCount = projects.filter(
		(p) => isGuestSharing(p.sharing) && !p.sharing.connectionId && !isRevokedSharing(p.sharing)
	).length;
}

/** このターゲットへ今、送信・取得できるか(送れないものはキューに残す) */
function isTargetUsable(key: string): boolean {
	const ref = parseTargetKey(key);
	if (!ref) return false;
	if (ref.connectionId) return isConnectionRegistered(ref.connectionId);
	if (!isFirebaseInitialized()) return false;
	// 最上位はオーナー未登録の間は使えない。主 Firebase の shared は、ゲストの分もあるので権限はサーバー側に任せる
	return ref.kind === 'primary' ? !isAccessBlocked() : true;
}

function hasProcessablePending(): boolean {
	for (const change of pendingChanges.values()) {
		if (isTargetUsable(targetOf(change))) return true;
	}
	return false;
}

/** ターゲットが読み取り専用(閲覧権限・失効)のゲストのプロジェクトか */
async function isReadOnlyTarget(key: string): Promise<boolean> {
	const pid = pidOfTargetKey(key);
	if (!pid) return false;
	return isReadOnlySharing((await db.projects.get(pid))?.sharing);
}

// 削除された「主 Firebase に送らないプロジェクト」(ゲスト・ローカル専用)の ID。
// 削除後は sharing を引けないため、削除の行き先の解決(主 Firebase への削除を積まない)に使う
const EXCLUDED_PROJECT_CACHE_MAX = 500;
const deletedExcludedProjects = new Set<string>();
db.projects.hook('deleting', (primKey, obj) => {
	if (!isExcludedFromPrimary(obj)) return;
	const id = String(primKey);
	deletedExcludedProjects.delete(id);
	deletedExcludedProjects.add(id);
	if (deletedExcludedProjects.size > EXCLUDED_PROJECT_CACHE_MAX) {
		const oldest = deletedExcludedProjects.values().next().value;
		if (oldest !== undefined) deletedExcludedProjects.delete(oldest);
	}
});

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
	settleStatus();
}

/** 進行中の処理がないときの isSyncing / error / status を確定する */
function settleStatus(): void {
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

function findPending(
	type: EntityType,
	id: string,
	target: string = PRIMARY_KEY
): PendingChange | undefined {
	const key = pendingKey({ type, id, target });
	return pendingChanges.get(key) ?? inFlight.get(key);
}

function persistPending(): void {
	savePendingChanges([...pendingChanges.values()]);
}

function enqueueInMemory(input: PendingChange): void {
	const change: PendingChange = { ...input, target: targetOf(input) };
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

export function contentDiffers(a: SyncableEntity, b: SyncableEntity): boolean {
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
 * プロジェクトは更新日時が頻繁に変わるメタ情報なので常に新しい方を採用する(newestWins で CRDT 化したシーンも同様)。
 */
async function handleConflict(
	type: EntityType,
	local: SyncableEntity,
	remote: SyncableEntity,
	policy: ConflictResolutionPolicy,
	target: string = PRIMARY_KEY,
	newestWins = false
): Promise<Exclude<ReconcileAction, 'skip'>> {
	console.log(`⚠️ Conflict detected for ${type}: ${local.id} (policy: ${policy})`);

	// CRDT 化したシーンは、本文を比べないので残る差(題名・並び順など)は軽微。ダイアログを出さず新しい方を採用する
	if (type === 'projects' || newestWins) {
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
				target,
				local,
				remote,
				conflictData: prepareConflictData(
					local as unknown as Record<string, unknown>,
					remote as unknown as Record<string, unknown>
				) as unknown as ConflictData<SyncableEntity>
			};
			const index = pendingConflicts.findIndex((c) => c.id === local.id && targetOf(c) === target);
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
	const target = targetOf(conflict);
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
		setBase(conflict.type, conflict.id, conflict.remote.updatedAt, target);
		await refreshStores(new Set([conflict.type]));
		console.log(`✅ Conflict resolved: ${conflict.type}/${conflictId} (adopted remote)`);
	} else {
		// リモートの版を確認済みとして扱い、ローカルを次回アップロードで反映する
		setBase(conflict.type, conflict.id, conflict.remote.updatedAt, target);
		enqueueAndSchedule({ type: conflict.type, id: conflict.id, action: 'update', target });
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
	policy: ConflictResolutionPolicy,
	target: string,
	readOnly = false,
	crdt = false
): Promise<RemoteDecision> {
	// 読み取り専用(閲覧権限・失効)は、競合ポリシーに関わらずリモートが勝つ。混入したローカルの変更は退避して上書きする
	if (readOnly) {
		if (!local) return 'write';
		const differs = contentDiffers(local, remote);
		// CRDT 化したシーンは、本文のミラーで updatedAt がずれるだけなら何もしない(remote は本文をローカルの値に揃えてある)
		if (crdt && !differs) {
			setBase(type, remote.id, remote.updatedAt, target);
			return 'none';
		}
		if (reconcileReadOnly(local, remote, !differs) === 'skip') {
			setBase(type, remote.id, remote.updatedAt, target);
			return 'none';
		}
		if (differs) await backupEntity(type, local, 'conflict');
		return 'write';
	}

	if (!local) {
		// この端末で削除済みでアップロード待ちのものは復活させない
		if (findPending(type, remote.id, target)?.action === 'delete') return 'none';
		return 'write';
	}

	const base = getBase(type, remote.id, target);
	let action = crdt
		? reconcileOwned(local, remote, base, contentDiffers(local, remote))
		: reconcile(local, remote, base);
	if (action === 'conflict') {
		action = await handleConflict(type, local, remote, policy, target, crdt);
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
			setBase(type, remote.id, remote.updatedAt, target);
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
	policy: ConflictResolutionPolicy,
	target: string = PRIMARY_KEY
): Promise<boolean> {
	if (remotes.length === 0) return false;
	const table = tableOf(type);
	const locals = await table.bulkGet(remotes.map((r) => r.id));
	const readOnly = await isReadOnlyTarget(target);
	// CRDT 化したシーンは本文(content)を比較せず、リモートの content でローカル(= Y のミラー)を上書きしない
	const crdtIds =
		type === 'scenes'
			? await crdtSceneIdsIn(
					remotes.map((r) => r.id),
					target
				)
			: new Set<string>();

	const writes: { remote: SyncableEntity; seen: SyncableEntity | undefined }[] = [];
	const pushes: PendingChange[] = [];
	const results = await mapLimit(remotes, RECONCILE_CONCURRENCY, async (original, i) => {
		const local = locals[i];
		const crdt = !!local && crdtIds.has(original.id);
		const remote = crdt ? adoptOwnedFields(local, original) : original;
		const decision = await decideRemote(type, remote, local, policy, target, readOnly, crdt);
		if (decision === 'write') writes.push({ remote, seen: local });
		else if (decision === 'push') pushes.push({ type, id: remote.id, action: 'update', target });
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
		for (const { remote } of applied) setBase(type, remote.id, remote.updatedAt, target);
	}

	// プロジェクト文書は sharing だけが通常の突き合わせとは別に決まる(他端末の共有開始・停止の反映)
	let adopted = false;
	if (type === 'projects') {
		const written = new Set(applied.map((w) => w.remote.id));
		adopted = await adoptRemoteSharing(
			remotes.filter((r) => !written.has(r.id)) as Project[],
			locals as (Project | undefined)[],
			remotes
		);
	}

	const failed = results.find((r) => r.status === 'rejected');
	if (failed && failed.status === 'rejected') throw failed.reason;
	return applied.length > 0 || adopted;
}

// この端末が共有の開始・停止を実行している最中のプロジェクト ID(ダウンロードで状態を巻き戻さないため)
const sharingBusy = new Set<string>();

/** sharing.service が、移行の実行中に呼ぶ */
export function setSharingBusy(pid: string, busy: boolean): void {
	if (busy) sharingBusy.add(pid);
	else sharingBusy.delete(pid);
}

/**
 * 取得したポインタ文書の sharing を、書き換えなかったローカルのプロジェクトへ取り込む(sharingAdopt.ts の規則)。
 * updatedAt は変えない(他端末の操作の反映であり、この端末の編集ではないため)。
 */
async function adoptRemoteSharing(
	remotes: Project[],
	locals: (Project | undefined)[],
	all: SyncableEntity[]
): Promise<boolean> {
	const localById = new Map(all.map((r, i) => [r.id, locals[i]]));
	const updates: { id: string; sharing: Project['sharing'] }[] = [];
	for (const remote of remotes) {
		const local = localById.get(remote.id);
		if (!local) continue;
		const result = adoptSharing(local.sharing, remote.sharing, sharingBusy.has(remote.id));
		if (result.adopt) updates.push({ id: remote.id, sharing: result.sharing });
	}
	if (updates.length === 0) return false;

	await db.transaction('rw', db.projects, async () => {
		for (const { id, sharing } of updates) {
			const current = await db.projects.get(id);
			// 判定中にこの端末で共有の操作が始まっていたら触らない
			if (!current || sharingBusy.has(id)) continue;
			const next = { ...current };
			if (sharing) next.sharing = sharing;
			else delete next.sharing;
			await db.projects.put(next);
		}
	});
	return true;
}

/**
 * 他端末で削除されたものをローカルから取り除く。
 * 削除後にこの端末で編集されていた場合は、削除せず再アップロードする。
 */
async function applyRemoteDeletion(
	type: EntityType,
	id: string,
	target: string = PRIMARY_KEY
): Promise<boolean> {
	if (findPending(type, id, target)) return false;

	const local = await tableOf(type).get(id);
	if (!local) {
		removeBase(type, id, target);
		return false;
	}

	// 共有の移行中に起きる削除(最上位の子要素の削除・共有側の全削除)は、データの移動であって削除ではない
	if (await isMovedByMigration(type, local, target)) return false;

	// 読み取り専用のゲストは、ローカルの編集を理由に削除を拒まない(リモートが勝つ。退避はこの下で行う)
	const base = getBase(type, id, target);
	if (base !== undefined && local.updatedAt > base && !(await isReadOnlyTarget(target))) {
		enqueueAndSchedule({ type, id, action: 'update', target });
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
	removeBase(type, id, target);
	return true;
}

/**
 * リモートでの削除が、共有の移行によるデータの移動のためのものか。
 * - primary の子要素: 所属プロジェクトが共有中(開始の移行で最上位から消える)
 * - shared: 共有の停止の移行中(共有側が全削除される)
 */
async function isMovedByMigration(
	type: EntityType,
	local: SyncableEntity,
	target: string
): Promise<boolean> {
	const ref = parseTargetKey(target);
	if (ref?.kind === 'shared') {
		const project = ref.pid ? await db.projects.get(ref.pid) : undefined;
		return project?.sharing?.status === 'migrating' && project.sharing.migration === 'stop';
	}
	if (type === 'projects' || !('projectId' in local)) return false;
	const project = await db.projects.get(local.projectId);
	return isSharedStatus(project?.sharing);
}

/**
 * 共同編集(CRDT)のシーンなら、現在の本文を履歴に退避し、復元する本文を applySceneText で反映する(true)。
 * 共同編集のシーンでなければ何もしない(false)。反映できなければ理由つきで例外を投げる(何も書き換えない)。
 */
async function restoreSceneTextViaCrdt(
	existing: SyncableEntity,
	snapshot: SyncableEntity
): Promise<boolean> {
	const { applySceneText, getSceneText, isCrdtScene } = await import(
		'$lib/services/sceneText.service'
	);
	if (!(await isCrdtScene(existing.id))) return false;
	const scene = existing as Scene;
	const content = (snapshot as Scene).content;
	if (typeof content !== 'string') return false;
	const current = (await getSceneText(scene.id)) ?? scene.content;
	// 復元の前の本文を履歴に残す
	await backupEntity('scenes', { ...scene, content: current }, 'conflict');
	const result = await applySceneText(scene.id, content);
	if (!result.ok) throw new Error(result.message);
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
	// 共有プロジェクトのシーンの本文は共同編集(Y)が正。現在の本文を退避してから、復元する本文を Y に適用する
	// (循環 import を避けるため動的に読み込む)
	const restoredAsCrdt =
		existing && type === 'scenes' && (await restoreSceneTextViaCrdt(existing, snapshot));
	// 現在の版は、復元で上書きする前に退避する
	if (existing && !restoredAsCrdt) await backupEntity(type, existing, 'conflict');

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
	if (!hasProcessablePending()) return;
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

/** 新ルールで、この端末がオーナー未登録(従来コレクションにアクセスできない)か */
function isAccessBlocked(): boolean {
	return authStore.accessMode === 'needs-owner';
}

/**
 * アクセスモードの変化を同期に反映する。
 * - 'needs-owner': 同期を止め、案内を syncStore のエラーとして表示する(無限リトライしない)
 * - それ以外: 停止中だった場合(または新ルールでの権限エラーで止まっていた場合)は、
 *   バックオフ・停止状態を解除して同期を自動で再開する
 */
export function applyAccessMode(mode: AccessMode | null): void {
	if (mode === 'needs-owner') {
		// ゲストのプロジェクトの購読は、主 Firebase のアクセス状態に関係なく続ける
		if (!isGuestSharing(currentProjectStore.project?.sharing)) stopCurrentProjectSync();
		for (const kind of ['upload', 'download'] as const) {
			const timer = retryTimers[kind];
			if (timer) clearTimeout(timer);
			retryTimers[kind] = null;
		}
		runErrors.access = NEEDS_OWNER_MESSAGE;
		settleStatus();
		return;
	}

	const wasBlocked = runErrors.access !== null;
	runErrors.access = null;
	// 登録前に走った処理が permission-denied で止まっている場合も、登録できたので再開する
	const stuck = mode === 'owner' && (gates.upload.isBlocked || gates.download.isBlocked);
	if (!wasBlocked && !stuck) return;

	resetGates();
	runErrors.upload = null;
	runErrors.download = null;
	// オフライン表示は上書きしない(復帰時に通常どおり更新される)
	if (navigator.onLine) settleStatus();
	void resumeSync();
}

/** アクセスモードが使える状態になったあとの同期再開(同期が無効な設定なら何もしない) */
async function resumeSync(): Promise<void> {
	try {
		const { settingsDB } = await import('$lib/db');
		const settings = await settingsDB.get();
		if (!settings.syncEnabled) return;
		if (isAccessBlocked()) return;

		if (!isInitialized) {
			await initializeSync();
		} else if (navigator.onLine) {
			void downloadAllFromFirestore().catch((err) => console.warn('Resume download failed:', err));
			flushPendingIfNeeded();
			startSharingResume();
		}
		const projectId = currentProjectStore.project?.id;
		if (projectId) await startCurrentProjectSync(projectId);
	} catch (error) {
		console.warn('Failed to resume sync:', error);
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
	await refreshGuestFlags();
	if (generation !== initGeneration) return;
	const guestWork = hasGuestWork();

	if (!isFirebaseInitialized() && !guestWork) {
		console.log('ℹ️ Firebase not configured, sync system will not be initialized');
		syncStore.status = 'offline';
		syncLoopsStarted = false;
		isInitialized = true; // 初期化済みフラグを立てて再実行を防ぐ(ゲスト接続が増えたら notifyConnectionsChanged で解除する)
		return;
	}

	// 新ルールでオーナー未登録なら、同期を始めない(isInitialized は立てず、登録後に改めて初期化する)。
	// ゲストの同期があるときは、主 Firebase の分だけを止めて続ける
	if (isFirebaseInitialized() && isAccessBlocked()) {
		console.log('⏸️ Owner registration required, primary sync is paused');
		applyAccessMode('needs-owner');
		if (!guestWork) return;
	}
	syncLoopsStarted = true;

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

	// 前回の起動で途中になった共有の開始・停止を再開する(起動はブロックしない)
	if (navigator.onLine) startSharingResume();

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
	syncLoopsStarted = false;
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
	const targets = await resolveQueueTargets(type, id, action);
	for (const target of targets) enqueue({ type, id, action, target });
	void scheduleSyncIfReady();
}

/** 複数の変更をまとめてキューに載せる(行き先はそれぞれ解決する。保存は1回) */
export async function queueChanges(
	changes: { type: EntityType; id: string; action: 'create' | 'update' | 'delete' }[]
): Promise<void> {
	const queued: PendingChange[] = [];
	for (const c of changes) {
		for (const target of await resolveQueueTargets(c.type, c.id, c.action)) {
			queued.push({ ...c, target });
		}
	}
	enqueueManyAndSchedule(queued);
}

// 子要素を削除した時点の所属プロジェクト(削除後はローカルから引けないため。削除の行き先の解決に使う)
const DELETED_PROJECT_CACHE_MAX = 5000;
const deletedProjectOf = new Map<string, string>();

function rememberDeletedProject(id: string, projectId: unknown): void {
	if (typeof projectId !== 'string') return;
	deletedProjectOf.delete(id);
	deletedProjectOf.set(id, projectId);
	if (deletedProjectOf.size > DELETED_PROJECT_CACHE_MAX) {
		const oldest = deletedProjectOf.keys().next().value;
		if (oldest !== undefined) deletedProjectOf.delete(oldest);
	}
}

for (const type of PROJECT_SCOPED_TYPES) {
	// Dexie の削除フック: 削除される行の projectId を覚えておく(sync の取り込みによる削除も含む。害はない)
	tableOf(type).hook('deleting', (primKey, obj) => {
		rememberDeletedProject(String(primKey), (obj as { projectId?: unknown }).projectId);
	});
}

/**
 * 変更の行き先(ターゲットのキー)を決める。行き先が無い(積まない)場合は空配列。
 * - projects 型: 常に primary(ポインタ文書)。ただしゲストのプロジェクトとローカル専用のものは積まない
 * - 子要素: 所属プロジェクトの共有状態(共有中なら shared、そうでなければ primary)。
 *   読み取り専用(閲覧権限・失効)のゲスト、ローカル専用のプロジェクトは積まない(同期層の安全網)
 * - 削除でエンティティが既にローカルに無い場合: 削除時に覚えた所属プロジェクトから決める。
 *   それも分からなければ、primary と、ローカルの共有中プロジェクトすべてへ送る(存在しない文書の削除は無害)
 */
async function resolveQueueTargets(
	type: EntityType,
	id: string,
	action: 'create' | 'update' | 'delete'
): Promise<string[]> {
	if (type === 'projects') {
		const project = await db.projects.get(id);
		const excluded = project ? isExcludedFromPrimary(project) : deletedExcludedProjects.has(id);
		return excluded ? [] : [PRIMARY_KEY];
	}

	let projectId: string | undefined;
	const local = (await tableOf(type).get(id)) as { projectId?: string } | undefined;
	if (local) {
		projectId = local.projectId;
	} else if (action === 'delete') {
		projectId = deletedProjectOf.get(id);
	}

	if (projectId) {
		const project = await db.projects.get(projectId);
		if (!project && deletedExcludedProjects.has(projectId)) return [];
		if (project?.localOnly || isReadOnlySharing(project?.sharing)) return [];
		return [targetKeyForEntity(type, project)];
	}
	if (action !== 'delete') return [PRIMARY_KEY];

	const keys = new Set<string>([PRIMARY_KEY]);
	for (const project of await db.projects.toArray()) {
		if (isReadOnlySharing(project.sharing)) continue;
		const key = targetKeyForProject(project);
		if (key !== PRIMARY_KEY) keys.add(key);
	}
	return [...keys];
}

async function scheduleSyncIfReady(): Promise<void> {
	try {
		if (navigator.onLine && (isFirebaseInitialized() || hasGuestWork())) {
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
	// await より前に同期的にロックを取る(二重起動を防ぐ)。ロック中に積まれた変更は終了後に再予約される。
	// 送れない行き先(Firebase 未設定・オーナー未登録・未登録のゲスト接続)の変更はキューに残し、送れるものだけ送る
	if (isProcessing || !hasProcessablePending()) return;
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
	if (hasProcessablePending() && gates.upload.canRun(Date.now()) && !runErrors.upload) {
		scheduleProcess();
	}
}

async function runUpload(): Promise<void> {
	// ロック待ちの間に積まれた変更も含めて、ここで取り出す(送れない行き先のものはキューに残す)
	const changes = [...pendingChanges.values()].filter((c) => isTargetUsable(targetOf(c)));
	if (changes.length === 0) return;
	console.log(`📤 Processing ${changes.length} pending change(s)...`);

	beginActivity();
	setProgress('upload', 0, changes.length);
	for (const change of changes) pendingChanges.delete(changeKey(change));
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

/** change は積まれたときの変更(キーの管理用)。target は実際に送る先(積んだ後の共有状態の変化を反映する) */
type UploadOp =
	| { kind: 'delete'; change: PendingChange; target: SyncTarget }
	| { kind: 'set'; change: PendingChange; local: SyncableEntity; target: SyncTarget };

/**
 * 変更の実際の行き先を決める。
 * - エンティティがローカルにあれば、所属プロジェクトの今の共有状態(積んだ後に共有が始まった/止まった場合に追随する)
 * - 無ければ(削除など)積んだときの行き先。ただしそのプロジェクトがもう共有されていなければ primary
 * 接続先が使えない(未登録のゲスト接続など)場合は null。その変更は送らずキューに残す。
 */
async function resolveUploadTarget(
	change: PendingChange,
	local: SyncableEntity | undefined
): Promise<SyncTarget | null> {
	let key: string;
	if (local && change.type !== 'projects' && 'projectId' in local) {
		key = targetKeyForEntity(change.type, await db.projects.get(local.projectId));
	} else {
		const stored = targetOf(change);
		const ref = parseTargetKey(stored);
		const project = ref?.pid && !ref.connectionId ? await db.projects.get(ref.pid) : undefined;
		key = effectiveTargetKey(stored, () => project);
	}
	// ゲスト接続は、匿名サインインの完了を待つ(オフラインで新規にサインインできない場合は送らず残す)
	const connectionId = parseTargetKey(key)?.connectionId;
	if (connectionId) {
		try {
			await awaitConnectionReady(connectionId);
		} catch (error) {
			console.warn(`Guest connection not ready (${connectionId}):`, error);
			return null;
		}
	}
	return targetFromKey(key);
}

/**
 * 送ってはいけない変更か(同期層の安全網。UI で止め損ねた変更や、権限が変わる前に積まれた変更を送らない)。
 * - 読み取り専用(閲覧権限・失効)のゲストのプロジェクト宛て
 * - 主 Firebase 宛てで、ゲストのプロジェクト・ローカル専用のもの(他人のデータを自分のクラウドへ複製しない)
 */
async function mustNotUpload(
	change: PendingChange,
	target: SyncTarget,
	local: SyncableEntity | undefined
): Promise<boolean> {
	if (await isReadOnlyTarget(target.key)) return true;
	if (target.kind !== 'primary') return false;

	const projectId =
		change.type === 'projects'
			? change.id
			: ((local as { projectId?: string } | undefined)?.projectId ??
				deletedProjectOf.get(change.id));
	if (!projectId) return false;
	const project = await db.projects.get(projectId);
	return project ? isExcludedFromPrimary(project) : deletedExcludedProjects.has(projectId);
}

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
			if (op === 'defer') {
				// 送り先が使えない: 完了扱いにせず、キューに残す
				errors.push(new Error(`送信先を利用できません(${targetOf(change)})`));
			} else if (op) {
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

		// 送信先(ターゲット)ごとにまとめてコミットする(Firestore インスタンスが違うことがある)
		const byTarget = new Map<string, UploadOp[]>();
		for (const op of ops) {
			const list = byTarget.get(op.target.key) ?? [];
			list.push(op);
			byTarget.set(op.target.key, list);
		}
		outer: for (const targetOps of byTarget.values()) {
			const sized = targetOps.map((op) => ({
				op,
				size: op.kind === 'set' ? JSON.stringify(op.local).length : 200
			}));
			for (const batch of chunkBatches(sized)) {
				throwIfCancelled(ctx);
				const target = batch[0].op.target;
				try {
					await commitBatchOps(
						batch.map(
							({ op }): BatchOp =>
								op.kind === 'delete'
									? { kind: 'delete', entityType: op.change.type, id: op.change.id }
									: { kind: 'set', entityType: op.change.type, entity: op.local }
						),
						target
					);
				} catch (error) {
					// ゲストのプロジェクトでの権限エラーは、アクセス権の失効として扱う(他のターゲットの送信は続ける)
					if (await handleGuestDenied(target, error)) {
						for (const op of targetOps) completed.add(changeKey(op.change));
						continue outer;
					}
					// このバッチは全件失敗(原子的)。以降は同じ原因で失敗する可能性が高いので打ち切る
					errors.push(error);
					break outer;
				}
				for (const { op } of batch) {
					if (op.kind === 'delete') {
						removeBase(op.change.type, op.change.id, op.target.key);
					} else {
						setBase(op.change.type, op.change.id, op.local.updatedAt, op.target.key);
					}
					completed.add(changeKey(op.change));
				}
				done += batch.length;
				setProgress('upload', done, total);
			}
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
): Promise<UploadOp | 'defer' | null> {
	const { type, id, action } = change;

	if (action === 'delete') {
		const target = await resolveUploadTarget(change, undefined);
		if (!target) return 'defer';
		if (await mustNotUpload(change, target, undefined)) return null;
		return { kind: 'delete', change, target };
	}

	const local = await tableOf(type).get(id);
	const target = await resolveUploadTarget(change, local);
	if (!target) return 'defer';
	if (await mustNotUpload(change, target, local)) return null;
	if (!local) {
		// ローカルに無い create/update は、リモートにも無いと確認できた場合だけキューから外す。
		// 確認できない場合(通信エラー等)は例外のまま伝播し、変更はキューに残る。
		const remoteExisting = await syncFromFirestore(type, id, target);
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
	const remote = await syncFromFirestore(type, id, target);
	if (remote) {
		// CRDT 化したシーンは本文を比較しない(リモートの content で上書きせず、ミラー更新を競合にしない)
		const crdt = type === 'scenes' && (await crdtSceneIdsIn([id], target.key)).has(id);
		const effective = crdt ? adoptOwnedFields(local, remote) : remote;
		const base = getBase(type, id, target.key);
		let result = crdt
			? reconcileOwned(local, effective, base, contentDiffers(local, effective))
			: reconcile(local, remote, base);
		if (result === 'conflict') {
			result = await handleConflict(type, local, effective, policy, target.key, crdt);
		}

		if (result === 'apply-remote') {
			if (contentDiffers(local, effective)) await backupEntity(type, local, 'conflict');
			await tableOf(type).put(effective);
			setBase(type, id, remote.updatedAt, target.key);
			refreshTypes.add(type);
			return null;
		}
		if (result === 'conflict') return null; // 手動解決待ち(アップロードしない)
		if (result === 'skip') {
			setBase(
				type,
				id,
				crdt ? Math.max(local.updatedAt, remote.updatedAt) : local.updatedAt,
				target.key
			);
			return null;
		}
	}

	console.log(
		`📤 Uploading ${type}/${id} to Firestore${target.kind === 'shared' ? ` (${target.key})` : ''}...`
	);
	return { kind: 'set', change, local, target };
}

/**
 * リアルタイム同期で受信したデータを反映する
 */
function applyRealtimeEntities(
	type: EntityType,
	entities: SyncableEntity[],
	target: string
): Promise<void> {
	return measureSync(
		'applyRealtime',
		type,
		() => applyRealtimeEntitiesInner(type, entities, target),
		() => entities.length
	);
}

async function applyRealtimeEntitiesInner(
	type: EntityType,
	entities: SyncableEntity[],
	target: string
): Promise<void> {
	const policy = await getPolicy();
	let changed = false;
	// 変化のあった分(初回スナップショットは全件)を、チャンクごとにまとめて反映する
	for (let i = 0; i < entities.length; i += RECONCILE_CHUNK_SIZE) {
		const chunk = entities.slice(i, i + RECONCILE_CHUNK_SIZE);
		try {
			if (await reconcileBatch(type, chunk, policy, target)) changed = true;
		} catch (error) {
			console.error(`Failed to apply ${chunk.length} ${type} document(s):`, error);
		}
	}
	if (changed) await refreshStores(new Set([type]));
}

async function applyRealtimeRemovals(
	type: EntityType,
	ids: string[],
	target: string
): Promise<void> {
	let changed = false;
	for (const id of ids) {
		try {
			if (await applyRemoteDeletion(type, id, target)) changed = true;
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

	const project = await db.projects.get(projectId);
	// ゲストのプロジェクトは、主 Firebase の設定(同期の有効・無効、オーナー登録)とは独立して購読する
	const guest = isGuestSharing(project?.sharing);

	if (guest) {
		if (isRevokedSharing(project?.sharing)) {
			stopCurrentProjectSync();
			console.log('⏭️ Guest access is revoked, skipping project sync');
			return;
		}
		const connectionId = project?.sharing?.connectionId;
		if (connectionId) {
			if (!isConnectionRegistered(connectionId)) {
				console.warn('⚠️ Guest connection not registered, skipping project sync');
				return;
			}
			try {
				await awaitConnectionReady(connectionId);
			} catch (error) {
				console.warn('⚠️ Guest connection not ready, skipping project sync:', error);
				return;
			}
		} else if (!isFirebaseInitialized()) {
			console.warn('⚠️ Firebase not initialized, skipping project sync');
			return;
		}
	} else {
		// 設定で同期が無効化されているか確認
		const { settingsDB } = await import('$lib/db');
		const settings = await settingsDB.get();

		if (!settings.syncEnabled) {
			console.log('⏭️ Sync is disabled in settings, skipping project sync');
			return;
		}

		// Firebaseが初期化されているか確認
		if (!isFirebaseInitialized()) {
			console.warn('⚠️ Firebase not initialized, skipping project sync');
			return;
		}

		if (isAccessBlocked()) {
			console.warn('⏸️ Owner registration required, skipping project sync');
			return;
		}
	}

	// 既存の監視を停止
	stopCurrentProjectSync();

	// ローカル専用(ゲストから退出して残したコピー)はどこにも同期しない
	if (project?.localOnly) {
		console.log('⏭️ Project is local-only, skipping project sync');
		return;
	}

	// 共有中のプロジェクトは shared/{pid} を購読する(停止の移行中は共有側が消えるので購読しない)
	if (project?.sharing?.status === 'migrating' && project.sharing.migration === 'stop') {
		console.log('⏸️ Sharing is being stopped, skipping realtime sync');
		return;
	}
	const targetKey = targetKeyForProject(project);
	const target = targetFromKey(targetKey);
	if (!target) {
		console.warn(`⚠️ Sync target unavailable (${targetKey}), skipping project sync`);
		return;
	}

	currentProjectUnsubscribers = PROJECT_SCOPED_TYPES.map((type) =>
		setupRealtimeSync(
			type,
			(entities) => {
				void applyRealtimeEntities(type, entities, targetKey);
			},
			(error) => {
				console.error(`${type} realtime sync error:`, error);
				// ゲストの権限エラーはアクセス権の失効として扱う(全体のエラーにはしない)
				if (guest && isPermissionDeniedError(error)) {
					void revokeGuestAccess(projectId);
					return;
				}
				syncStore.error = error.message;
			},
			projectId,
			(ids) => {
				void applyRealtimeRemovals(type, ids, targetKey);
			},
			target
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
	const guestProject = await projectsDB.getById(projectId);
	// 読み取り専用(閲覧権限・失効)・ローカル専用は何も送らない
	if (guestProject?.localOnly || isReadOnlySharing(guestProject?.sharing)) return;
	if (!isGuestSharing(guestProject?.sharing) && isAccessBlocked()) {
		throw new Error(NEEDS_OWNER_MESSAGE);
	}
	beginActivity();

	try {
		const project = guestProject;
		const childKey = targetKeyForProject(project);
		const childTarget = targetFromKey(childKey);
		if (!childTarget) throw new Error(`送信先を利用できません(${childKey})`);

		const upload = async (type: EntityType, entity: SyncableEntity) => {
			// プロジェクト文書(ポインタ)は常に primary。子要素は所属プロジェクトの行き先
			const key = type === 'projects' ? PRIMARY_KEY : childKey;
			await syncToFirestore(type, entity, type === 'projects' ? undefined : childTarget);
			setBase(type, entity.id, entity.updatedAt, key);
		};

		// プロジェクト文書(ポインタ)は主 Firebase のもの。ゲストのプロジェクトは送らない
		if (project && !isExcludedFromPrimary(project)) await upload('projects', project);

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

/** 取得の対象(ターゲット)。primary では、共有中のプロジェクトの子要素を扱わない */
interface DownloadScope {
	key: string;
	target: SyncTarget;
	/** shared のとき、対象プロジェクトの ID */
	pid?: string;
	/** primary のとき、子要素を除外するプロジェクト(共有中・ゲスト・ローカル専用。子要素は shared 側または端末内にだけある) */
	excludePids: ReadonlySet<string>;
	/** primary の projects 型で、扱わない文書の ID(ゲストのプロジェクト・ローカル専用。ポインタは primary にない/送らない) */
	excludeProjectDocs?: ReadonlySet<string>;
	/** ゲストのプロジェクト(取得で権限エラーになったら、失効として扱う) */
	guest?: boolean;
	/** 読み取り専用(閲覧権限)。ローカルにしか無いものはアップロードせず、リモートに合わせて取り除く */
	readOnly?: boolean;
}

/** 取得の対象で、ローカルにあるものの主キー(リモートに無い＝削除/未アップロードの判定の母集団) */
async function localIdsInScope(type: EntityType, scope: DownloadScope): Promise<string[]> {
	const table = tableOf(type);
	if (scope.pid) {
		return (await table.where('projectId').equals(scope.pid).primaryKeys()) as string[];
	}
	if (type === 'projects' && scope.excludeProjectDocs && scope.excludeProjectDocs.size > 0) {
		const ids = (await table.toCollection().primaryKeys()) as string[];
		return ids.filter((id) => !scope.excludeProjectDocs!.has(id));
	}
	if (type !== 'projects' && scope.excludePids.size > 0) {
		return (await table
			.where('projectId')
			.noneOf([...scope.excludePids])
			.primaryKeys()) as string[];
	}
	return (await table.toCollection().primaryKeys()) as string[];
}

async function localCountInScope(type: EntityType, scope: DownloadScope): Promise<number> {
	if (scope.pid) return tableOf(type).where('projectId').equals(scope.pid).count();
	if (type === 'projects' && scope.excludeProjectDocs && scope.excludeProjectDocs.size > 0) {
		return Math.max(0, (await tableOf(type).count()) - scope.excludeProjectDocs.size);
	}
	if (type !== 'projects' && scope.excludePids.size > 0) {
		return tableOf(type)
			.where('projectId')
			.noneOf([...scope.excludePids])
			.count();
	}
	return tableOf(type).count();
}

/** 読み取り専用のゲストで、リモートに無いローカルのデータを退避してから取り除く */
async function discardLocalOnly(type: EntityType, id: string, target: string): Promise<boolean> {
	const local = await tableOf(type).get(id);
	if (!local) return false;
	await backupEntity(type, local, 'remote-delete');
	await tableOf(type).delete(id);
	removeBase(type, id, target);
	return true;
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
	progress: { done: number; total: number },
	scope: DownloadScope
): Promise<DownloadTypeResult> {
	const started = performance.now();
	let fetched = 0;
	let skipped = 0;
	let ok = false;
	try {
		let remotes = await syncAllFromFirestore(
			type,
			undefined,
			plan.mode === 'diff' ? plan.since : undefined,
			scope.target
		);
		// primary に残っている、共有中プロジェクトの子要素(古い端末が書いたものなど)は取り込まない
		if (!scope.pid && type !== 'projects') {
			remotes = withoutSharedChildren(remotes, scope.excludePids);
		}
		// ゲストのプロジェクト・ローカル専用のものと同じ ID の文書は、主 Firebase から取り込まない
		if (!scope.pid && type === 'projects' && scope.excludeProjectDocs?.size) {
			remotes = remotes.filter((r) => !scope.excludeProjectDocs!.has(r.id));
		}
		fetched = remotes.length;
		progress.total += remotes.length;
		setProgress('download', progress.done, progress.total);
		console.log(`📦 Found ${remotes.length} ${type} in Firestore ${scope.key} (${plan.mode})`);
		let changed = false;

		for (let i = 0; i < remotes.length; i += RECONCILE_CHUNK_SIZE) {
			throwIfCancelled(ctx);
			const chunk = remotes.slice(i, i + RECONCILE_CHUNK_SIZE);
			if (await reconcileBatch(type, chunk, policy, scope.key)) changed = true;
			progress.done += chunk.length;
			setProgress('download', progress.done, progress.total);
		}

		if (canDetectRemoteDeletion(plan)) {
			// Firestore に無いローカルデータ(完全取得のときだけ判定する):
			//  同期済みだったもの → 他端末で削除された。未同期のもの → 未アップロードなので送る
			throwIfCancelled(ctx);
			const remoteIds = new Set(remotes.map((r) => r.id));
			const { removals, uploads } = classifyLocalOnly(
				plan,
				await localIdsInScope(type, scope),
				remoteIds,
				(id) => findPending(type, id, scope.key) !== undefined,
				(id) => getBase(type, id, scope.key) !== undefined
			);
			for (const id of removals) {
				if (await applyRemoteDeletion(type, id, scope.key)) changed = true;
			}
			if (scope.readOnly) {
				// 閲覧権限: ローカルにしか無いもの(混入した変更)は送らず、リモートに合わせて取り除く
				for (const id of uploads) {
					if (await discardLocalOnly(type, id, scope.key)) changed = true;
				}
			} else {
				enqueueManyAndSchedule(
					uploads.map((id) => ({ type, id, action: 'create' as const, target: scope.key }))
				);
			}
		} else {
			skipped = Math.max(0, (await localCountInScope(type, scope)) - remotes.length);
		}

		ok = true;
		return { changed, fetched, skipped };
	} finally {
		recordSyncMetric({
			kind: 'download',
			label: `${scope.key === PRIMARY_KEY ? '' : `${scope.key}:`}${type}:${plan.mode}`,
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
	if (isAccessBlocked() && !hasGuestWork()) {
		// 手動の完全同期は、成功したように見せず理由を返す
		if (trigger === 'manual-full') return Promise.reject(new Error(NEEDS_OWNER_MESSAGE));
		return Promise.resolve();
	}
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

	let state = loadSyncState();
	const progress = { done: 0, total: 0 };
	const changedTypes = new Set<EntityType>();
	const errors: unknown[] = [];
	// 取得で権限エラーになったゲストのプロジェクト(アクセス権の失効として扱い、全体のエラーにはしない)
	const deniedGuests = new Set<string>();

	/** 1つのターゲットの1種類を取得する。成功した型を succeeded に入れる */
	const runType = async (
		type: EntityType,
		plan: TypePlan,
		scope: DownloadScope,
		succeeded: Set<EntityType>
	) => {
		try {
			const result = await downloadType(type, plan, policy, ctx, progress, scope);
			if (result.changed) changedTypes.add(type);
			succeeded.add(type);
			addCount(result.fetched);
		} catch (error) {
			if (scope.guest && scope.pid && isPermissionDeniedError(error)) deniedGuests.add(scope.pid);
			else errors.push(error);
		}
	};

	/** 共有ターゲット(オーナーの shared、またはゲストのプロジェクト)の全子要素を取得し、同期状態を記録する。全型が成功したら true */
	const runSharedScope = async (scope: DownloadScope): Promise<boolean> => {
		const targetState = getTargetState(state, scope.key);
		const counts = await Promise.all(
			PROJECT_SCOPED_TYPES.map((type) => localCountInScope(type, scope))
		);
		const plan = planDownload({
			now: startedAt,
			trigger,
			types: PROJECT_SCOPED_TYPES,
			lastFullSyncAt: targetState.lastFullSyncAt,
			lastSyncTimes: targetState.lastSyncTimes,
			localCounts: Object.fromEntries(PROJECT_SCOPED_TYPES.map((t, i) => [t, counts[i]]))
		}) as Record<EntityType, TypePlan>;

		const succeeded = new Set<EntityType>();
		await Promise.all(
			PROJECT_SCOPED_TYPES.map((type) => runType(type, plan[type], scope, succeeded))
		);
		if (scope.guest && scope.pid && deniedGuests.has(scope.pid)) return false;

		if (!ctx.cancelled && succeeded.size > 0) {
			const current = getTargetState(state, scope.key);
			const lastSyncTimes = { ...current.lastSyncTimes };
			for (const type of succeeded) lastSyncTimes[type] = startedAt;
			const fullDone = PROJECT_SCOPED_TYPES.every(
				(t) => succeeded.has(t) && plan[t].mode === 'full'
			);
			state = withTargetState(state, scope.key, {
				lastFullSyncAt: fullDone ? startedAt : current.lastFullSyncAt,
				lastSyncTimes
			});
		}
		return succeeded.size === PROJECT_SCOPED_TYPES.length;
	};

	const initialProjects = await db.projects.toArray();
	const guestProjects = initialProjects.filter((p) => isGuestSharing(p.sharing));
	// ゲストのプロジェクト(失効済みを含む)のターゲット。同期状態の掃除で消さない
	const guestKeys = new Set(
		guestProjects.map((p) => sharedTargetKey(p.sharing!.pid, p.sharing!.connectionId))
	);

	// ---- primary: プロジェクト(ポインタ文書)を先に処理し、続けて共有中でない子要素を並列に処理する。
	// Firebase 未設定・オーナー未登録のときは行わない(ゲストの同期だけを行う)
	const primarySucceeded = new Set<EntityType>();
	const primaryPlans = new Map<EntityType, TypePlan>();
	const primaryState = getTargetState(state, PRIMARY_KEY);
	let projectPlan: TypePlan = { mode: 'full' };

	if (isFirebaseInitialized() && !isAccessBlocked()) {
		// ゲストのプロジェクト・ローカル専用の文書は、主 Firebase の取得・突き合わせの対象にしない
		const excludeProjectDocs = new Set(
			initialProjects.filter((p) => isExcludedFromPrimary(p)).map((p) => p.id)
		);
		const primaryScope: DownloadScope = {
			key: PRIMARY_KEY,
			target: targetFromKey(PRIMARY_KEY)!,
			excludePids: new Set(),
			excludeProjectDocs
		};
		projectPlan = planDownload({
			now: startedAt,
			trigger,
			types: ['projects'],
			lastFullSyncAt: primaryState.lastFullSyncAt,
			lastSyncTimes: primaryState.lastSyncTimes,
			localCounts: { projects: await localCountInScope('projects', primaryScope) }
		}).projects;
		await runType('projects', projectPlan, primaryScope, primarySucceeded);

		if (primarySucceeded.has('projects')) {
			// 取得したポインタ文書の sharing が反映されたあとのローカルのプロジェクトから、共有中のものを決める
			const projects = await db.projects.toArray();
			const excludePids = primaryExcludedIds(projects);
			const scopedPrimary: DownloadScope = { ...primaryScope, excludePids };

			const counts = await Promise.all(
				PROJECT_SCOPED_TYPES.map((type) => localCountInScope(type, scopedPrimary))
			);
			const plan = planDownload({
				now: startedAt,
				trigger,
				types: PROJECT_SCOPED_TYPES,
				lastFullSyncAt: primaryState.lastFullSyncAt,
				lastSyncTimes: primaryState.lastSyncTimes,
				localCounts: Object.fromEntries(PROJECT_SCOPED_TYPES.map((t, i) => [t, counts[i]]))
			});
			for (const type of PROJECT_SCOPED_TYPES) primaryPlans.set(type, plan[type]);

			// 共有中のプロジェクト(主 Firebase のオーナー分。停止の移行中は共有側が消えるので除く)の shared ターゲット
			const ownerScopes: DownloadScope[] = [];
			for (const project of projects) {
				const sharing = project.sharing;
				if (!isSharedStatus(sharing) || sharing.connectionId || sharing.role !== 'owner') continue;
				if (sharing.status === 'migrating' && sharing.migration === 'stop') continue;
				const key = sharedTargetKey(sharing.pid);
				const target = targetFromKey(key);
				if (!target) continue;
				ownerScopes.push({ key, target, pid: sharing.pid, excludePids: new Set() });
			}

			await Promise.all([
				...PROJECT_SCOPED_TYPES.map((type) =>
					runType(type, primaryPlans.get(type)!, scopedPrimary, primarySucceeded)
				),
				// 共有中のプロジェクトは数が少ないので順に処理する(型は並列)
				(async () => {
					for (const scope of ownerScopes) await runSharedScope(scope);
				})()
			]);

			// 共有でなくなったターゲットの状態を取り除く(ゲスト接続・ゲストのプロジェクトのものは残す)
			const live = new Set(ownerScopes.map((scope) => scope.key));
			for (const key of Object.keys(state.targets)) {
				if (!live.has(key) && !guestKeys.has(key) && !parseTargetKey(key)?.connectionId) {
					state = {
						...state,
						targets: Object.fromEntries(Object.entries(state.targets).filter(([k]) => k !== key))
					};
				}
			}
		}

		// 成功した型の取得時刻を記録する(取得開始時刻。次回は安全マージンを引いて使う)
		if (!ctx.cancelled && primarySucceeded.size > 0) {
			const lastSyncTimes = { ...primaryState.lastSyncTimes };
			for (const type of primarySucceeded) lastSyncTimes[type] = startedAt;
			const fullDone = ENTITY_TYPES.every(
				(t) =>
					primarySucceeded.has(t) &&
					(t === 'projects' ? projectPlan : primaryPlans.get(t)!).mode === 'full'
			);
			state = withTargetState(state, PRIMARY_KEY, {
				lastFullSyncAt: fullDone ? startedAt : primaryState.lastFullSyncAt,
				lastSyncTimes
			});
		}
	}

	// ---- ゲスト: 主 Firebase の同期設定とは独立して、各プロジェクトの接続先の shared/{pid} を取得する。
	// 失効済み・接続が使えないもの(未登録・オフラインでサインインできない)は飛ばす
	for (const project of guestProjects) {
		const sharing = project.sharing!;
		if (ctx.cancelled) break;
		if (isRevokedSharing(sharing) || !isSharedStatus(sharing)) continue;

		const key = sharedTargetKey(sharing.pid, sharing.connectionId);
		if (sharing.connectionId) {
			if (!isConnectionRegistered(sharing.connectionId)) continue;
			try {
				await awaitConnectionReady(sharing.connectionId);
			} catch (error) {
				console.warn(`Guest connection not ready (${sharing.connectionId}):`, error);
				continue;
			}
		} else if (!isFirebaseInitialized()) {
			continue;
		}
		const target = targetFromKey(key);
		if (!target) continue;

		const complete = await runSharedScope({
			key,
			target,
			pid: sharing.pid,
			excludePids: new Set(),
			guest: true,
			readOnly: sharing.role === 'viewer'
		});
		if (deniedGuests.has(sharing.pid)) {
			await revokeGuestAccess(sharing.pid);
		} else if (complete && sharing.connectionId) {
			connectionsDB
				.update(sharing.connectionId, { lastSyncAt: startedAt })
				.catch((error) => console.warn('Failed to record connection sync time:', error));
		}
	}
	saveSyncState(state);

	// 変化のあった型だけ、全体で1回だけストアを更新する
	if (changedTypes.size > 0) await refreshStores(changedTypes);

	if (errors.length > 0) throw errors[0];
}

/** 共有の移行の再開をバックグラウンドで始める(sharing.service は sync.service を使うので動的に読み込む) */
function startSharingResume(): void {
	void import('$lib/services/sharing.service')
		.then((m) => m.resumeSharingMigrations())
		.catch((error) => console.warn('Failed to resume sharing migrations:', error));
}

// ---------- 共有(sharing.service)向けの操作 ----------

/** 送信待ち・送信中の変更(共有の開始前に「未送信が残っていないか」を確認するため) */
export function getPendingSnapshot(): PendingChange[] {
	return [...pendingChanges.values(), ...inFlight.values()].map((c) => ({
		...c,
		target: targetOf(c)
	}));
}

/**
 * 保留中の変更を送る。実行中の取得・送信の終了を待ってから送る。
 * 送れなかった変更はキューに残るので、完了後に getPendingSnapshot で確認すること。
 */
export async function flushPendingChanges(): Promise<void> {
	await syncMutex.runExclusive(async () => {});
	await processPendingChanges();
}

/**
 * 共有プロジェクト(主 Firebase の shared/{pid})を完全取得してローカルに取り込む。
 * 共有の停止の前に、他の参加者の編集をローカルに取り込むために使う(停止の移行中でも実行する)。
 * 失敗したら例外を投げる。
 */
export async function pullSharedProject(pid: string): Promise<void> {
	const key = sharedTargetKey(pid);
	const target = targetFromKey(key);
	if (!target) throw new Error('共有の取得先を利用できません');
	const policy = await getPolicy();

	await syncMutex.runExclusive(async () => {
		beginActivity();
		const ctx: RunContext = { cancelled: false };
		const scope: DownloadScope = { key, target, pid, excludePids: new Set() };
		const progress = { done: 0, total: 0 };
		const changed = new Set<EntityType>();
		try {
			await withTimeout(
				(async () => {
					for (const type of PROJECT_SCOPED_TYPES) {
						const result = await downloadType(type, { mode: 'full' }, policy, ctx, progress, scope);
						if (result.changed) changed.add(type);
					}
				})(),
				OPERATION_TIMEOUT,
				'共有データの取得',
				() => {
					ctx.cancelled = true;
				}
			);
			if (changed.size > 0) await refreshStores(changed);
		} finally {
			endActivity();
		}
	});
}

// ---------- ゲスト接続の管理(join.service / connection.service 向け) ----------

/** 権限エラーが、ゲストのプロジェクトでのアクセス権の失効なら、失効として処理して true を返す */
async function handleGuestDenied(
	target: { kind: string; pid?: string },
	error: unknown
): Promise<boolean> {
	if (!isPermissionDeniedError(error) || target.kind !== 'shared' || !target.pid) return false;
	const project = await db.projects.get(target.pid);
	if (!isGuestSharing(project?.sharing)) return false;
	await revokeGuestAccess(target.pid);
	return true;
}

const revoking = new Set<string>();

/**
 * ゲストのアクセス権が無効になった(メンバー削除・秘密無効・共有停止)ときの処理。
 * 接続を revoked にして同期を止める。ローカルのコピーは削除しない(読み取り専用になり、再参加で復帰できる)。
 */
export async function revokeGuestAccess(pid: string): Promise<void> {
	if (revoking.has(pid)) return;
	revoking.add(pid);
	try {
		const revokedAt = Date.now();
		const connectionId = await db.transaction('rw', db.projects, async () => {
			const project = await db.projects.get(pid);
			if (!project || !isGuestSharing(project.sharing) || project.sharing.revokedAt !== undefined) {
				return null;
			}
			await db.projects.put({ ...project, sharing: { ...project.sharing, revokedAt } });
			return project.sharing.connectionId ?? '';
		});
		if (connectionId === null) return;

		console.warn(`🚫 Guest access revoked for project ${pid}`);
		if (connectionId) {
			await connectionsDB.update(connectionId, { status: 'revoked' });
			unregisterConnection(connectionId);
		}
		stopProjectRealtime(pid);
		discardPendingForPid(pid);
		// 共同編集の状態(crdtDocs)を捨てる(本文は Scene.content に残り、読み取り専用で見られる)。循環 import を避けて動的に読み込む
		await import('$lib/services/sceneText.service')
			.then((m) => m.discardProjectCrdtState(pid))
			.catch((e) => console.warn('Failed to discard CRDT state:', e));
		await refreshGuestFlags();
		await refreshProjectStores();
	} catch (error) {
		console.error(`Failed to revoke guest access for ${pid}:`, error);
	} finally {
		revoking.delete(pid);
	}
}

/** ゲストの状態(接続なしのゲストの有無)を数え直す。退出のあとなどに呼ぶ */
export const refreshGuestState = refreshGuestFlags;

/** そのプロジェクトの共有ターゲット宛ての送信待ちを捨てる(ローカルの内容は残す。再参加時は突き合わせで再送される) */
function discardPendingForPid(pid: string): void {
	let removed = false;
	for (const [key, change] of [...pendingChanges]) {
		if (pidOfTargetKey(targetOf(change)) === pid) {
			pendingChanges.delete(key);
			removed = true;
		}
	}
	if (removed) persistPending();
}

/** 参加・退出のあとの後始末(ターゲットの送信待ちと同期状態を捨てる)。ローカルのデータは触らない */
export function discardGuestTarget(pid: string, connectionId?: string): void {
	discardPendingForPid(pid);
	saveSyncState(withoutTargetState(loadSyncState(), sharedTargetKey(pid, connectionId)));
}

/**
 * ゲスト接続が増えた/減った/復帰したときに呼ぶ。
 * 同期システムが未起動(Firebase 未設定のまま)なら起動し、起動済みなら取得を始める。開いているプロジェクトの購読もやり直す。
 */
export async function notifyConnectionsChanged(): Promise<void> {
	await refreshGuestFlags();
	if (!isInitialized || !syncLoopsStarted) {
		isInitialized = false;
		await initializeSync();
	} else if (navigator.onLine) {
		void downloadAllFromFirestore().catch((err) =>
			console.warn('Download after join failed:', err)
		);
		flushPendingIfNeeded();
	}
	const current = currentProjectStore.project;
	if (current && isGuestSharing(current.sharing)) await startCurrentProjectSync(current.id);
}

/** 開いているプロジェクトが pid なら、リアルタイム同期をやり直す(共有の開始・停止で購読先が変わるため) */
export async function restartProjectRealtime(pid: string): Promise<void> {
	if (currentProjectStore.project?.id !== pid) return;
	await startCurrentProjectSync(pid);
}

/** 開いているプロジェクトが pid なら、リアルタイム同期を止める */
export function stopProjectRealtime(pid: string): void {
	if (currentProjectStore.project?.id === pid) stopCurrentProjectSync();
}

/** ストアを(sharing の変更を含めて)ローカルDBの内容に更新する */
export async function refreshProjectStores(): Promise<void> {
	await refreshStores(new Set<EntityType>(['projects']));
	const current = currentProjectStore.project;
	if (current) {
		const latest = await projectsDB.getById(current.id);
		if (latest) currentProjectStore.project = latest;
	}
}
