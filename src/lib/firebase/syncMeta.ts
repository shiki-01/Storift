import type { EntityType } from './sync';
import { PRIMARY_KEY } from './syncTarget';

export interface PendingChange {
	type: EntityType;
	id: string;
	action: 'create' | 'update' | 'delete';
	/**
	 * 行き先の SyncTarget のキー。削除時にエンティティがローカルに無くても行き先が分かるよう、積む時点で決めて持つ。
	 * 旧形式(未設定)は primary として扱う。
	 */
	target?: string;
}

/** 行き先を補った PendingChange(旧形式は primary) */
export const targetOf = (c: { target?: string; type?: EntityType }): string =>
	c.target ?? PRIMARY_KEY;

/**
 * キュー・突き合わせ用のキー。primary は従来どおり `type/id`(旧形式の保存データと同じ)、
 * それ以外は `{target}|type/id`。同じ id が別ターゲットに出ても衝突しない。
 */
export const pendingKey = (c: { type: EntityType; id: string; target?: string }): string => {
	const target = targetOf(c);
	return target === PRIMARY_KEY ? `${c.type}/${c.id}` : `${target}|${c.type}/${c.id}`;
};

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

/** base のキー。ターゲットごとに区別する(primary は従来のキーと同じ) */
export const baseKey = (type: EntityType, id: string, target: string = PRIMARY_KEY) =>
	pendingKey({ type, id, target });

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
export function getBase(
	type: EntityType,
	id: string,
	target: string = PRIMARY_KEY
): number | undefined {
	return loadBases()[baseKey(type, id, target)];
}

export function setBase(
	type: EntityType,
	id: string,
	updatedAt: number,
	target: string = PRIMARY_KEY
): void {
	const map = loadBases();
	const key = baseKey(type, id, target);
	if (map[key] === updatedAt) return;
	map[key] = updatedAt;
	scheduleBaseFlush();
}

export function removeBase(type: EntityType, id: string, target: string = PRIMARY_KEY): void {
	const map = loadBases();
	const key = baseKey(type, id, target);
	if (!(key in map)) return;
	delete map[key];
	scheduleBaseFlush();
}

export function loadPendingChanges(): PendingChange[] {
	return read<PendingChange[]>(PENDING_KEY, []).map((c) => ({ ...c, target: targetOf(c) }));
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

/** 差分取得のための状態(ターゲット1つぶん: 型ごとの最終同期時刻と、最後に完全同期した時刻) */
export interface TargetSyncState {
	lastFullSyncAt?: number;
	lastSyncTimes: Partial<Record<EntityType, number>>;
}

/**
 * 全体の状態。primary は従来どおりトップレベルのフィールド(旧形式の保存データと互換)、
 * 共有ターゲットは targets[キー] に持つ。
 */
export interface SyncState extends TargetSyncState {
	targets: Record<string, TargetSyncState>;
}

export function loadSyncState(): SyncState {
	const state = read<Partial<SyncState>>(STATE_KEY, {});
	return {
		lastFullSyncAt: state.lastFullSyncAt,
		lastSyncTimes: state.lastSyncTimes ?? {},
		targets: state.targets ?? {}
	};
}

export function saveSyncState(state: SyncState): void {
	write(STATE_KEY, state);
}

/** ターゲットごとの同期状態(primary はトップレベル) */
export function getTargetState(state: SyncState, target: string): TargetSyncState {
	if (target === PRIMARY_KEY) {
		return { lastFullSyncAt: state.lastFullSyncAt, lastSyncTimes: state.lastSyncTimes };
	}
	return state.targets[target] ?? { lastSyncTimes: {} };
}

/** ターゲットごとの同期状態を反映した新しい状態を返す(元は変更しない) */
export function withTargetState(
	state: SyncState,
	target: string,
	next: TargetSyncState
): SyncState {
	if (target === PRIMARY_KEY) {
		return { ...state, lastFullSyncAt: next.lastFullSyncAt, lastSyncTimes: next.lastSyncTimes };
	}
	return { ...state, targets: { ...state.targets, [target]: next } };
}

/** 存在しなくなったターゲットの状態を取り除く(共有の停止・削除のあと) */
export function withoutTargetState(state: SyncState, target: string): SyncState {
	if (!(target in state.targets)) return state;
	const targets = { ...state.targets };
	delete targets[target];
	return { ...state, targets };
}
