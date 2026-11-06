import type { EntityType } from './sync';

export interface PendingChange {
	type: EntityType;
	id: string;
	action: 'create' | 'update' | 'delete';
}

const BASE_KEY = 'storift_sync_base';
const PENDING_KEY = 'storift_sync_pending';

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (error) {
		console.warn('Failed to persist sync metadata:', error);
	}
}

const keyOf = (type: EntityType, id: string) => `${type}/${id}`;

let bases: Record<string, number> | null = null;
let basesDirty = false;
let baseFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** base の永続化をまとめる間隔。この間の更新は1回の書き込みになる */
const BASE_FLUSH_DELAY = 800;

function loadBases(): Record<string, number> {
	if (!bases) bases = read<Record<string, number>>(BASE_KEY, {});
	return bases;
}

/**
 * 未保存の base を localStorage に書き込む。
 * クラッシュで書き損ねた場合、base は古い値のまま残る。base が古い側にずれても
 * 「競合と判定されやすくなる」だけで、データが消える方向には働かない。
 */
export function flushSyncMeta(): void {
	if (baseFlushTimer) {
		clearTimeout(baseFlushTimer);
		baseFlushTimer = null;
	}
	if (basesDirty && bases) {
		basesDirty = false;
		write(BASE_KEY, bases);
	}
}

function scheduleBaseFlush(): void {
	basesDirty = true;
	if (!baseFlushTimer) baseFlushTimer = setTimeout(flushSyncMeta, BASE_FLUSH_DELAY);
}

// ページを閉じる/隠すときは、待たずに保存する
if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', flushSyncMeta);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flushSyncMeta();
	});
}

/** 両端末が最後に一致していた版の updatedAt */
export function getBase(type: EntityType, id: string): number | undefined {
	return loadBases()[keyOf(type, id)];
}

export function setBase(type: EntityType, id: string, updatedAt: number): void {
	const map = loadBases();
	const key = keyOf(type, id);
	if (map[key] === updatedAt) return;
	map[key] = updatedAt;
	scheduleBaseFlush();
}

export function removeBase(type: EntityType, id: string): void {
	const map = loadBases();
	const key = keyOf(type, id);
	if (!(key in map)) return;
	delete map[key];
	scheduleBaseFlush();
}

export function loadPendingChanges(): PendingChange[] {
	return read<PendingChange[]>(PENDING_KEY, []);
}

export function savePendingChanges(changes: PendingChange[]): void {
	write(PENDING_KEY, changes);
}

const CONFLICT_KEY = 'storift_sync_conflicts';

/** 手動解決待ちの競合(再読み込みで失われないよう保存する) */
export function loadPendingConflicts<T>(): T[] {
	return read<T[]>(CONFLICT_KEY, []);
}

export function savePendingConflicts<T>(conflicts: T[]): void {
	write(CONFLICT_KEY, conflicts);
}

const STATE_KEY = 'storift_sync_state';

/** 差分取得のための状態(型ごとの最終同期時刻と、最後に完全同期した時刻) */
export interface SyncState {
	lastFullSyncAt?: number;
	lastSyncTimes: Partial<Record<EntityType, number>>;
}

export function loadSyncState(): SyncState {
	const state = read<Partial<SyncState>>(STATE_KEY, {});
	return { lastFullSyncAt: state.lastFullSyncAt, lastSyncTimes: state.lastSyncTimes ?? {} };
}

export function saveSyncState(state: SyncState): void {
	write(STATE_KEY, state);
}
