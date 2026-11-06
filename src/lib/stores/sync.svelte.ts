import type { SyncStatus } from '$lib/types';

// ブラウザの実際のオンライン状態から初期値を設定
const initialStatus: SyncStatus =
	typeof navigator !== 'undefined' && navigator.onLine ? 'synced' : 'offline';

export interface SyncProgress {
	phase: 'upload' | 'download' | null;
	done: number;
	total: number;
}

let status = $state<SyncStatus>(initialStatus);
let lastSyncTime = $state<number | null>(null);
let isSyncing = $state(false);
let error = $state<string | null>(null);
let progress = $state<SyncProgress>({ phase: null, done: 0, total: 0 });
let conflictCount = $state(0);
let conflictDialogOpen = $state(false);
// Firebase の設定が読み込まれて初期化済みか(同期の有無の表示に使う)
let configured = $state(false);

export const syncStore = {
	get status() {
		return status;
	},
	set status(value: SyncStatus) {
		status = value;
	},
	get lastSyncTime() {
		return lastSyncTime;
	},
	set lastSyncTime(value: number | null) {
		lastSyncTime = value;
	},
	get isSyncing() {
		return isSyncing;
	},
	set isSyncing(value: boolean) {
		isSyncing = value;
	},
	get error() {
		return error;
	},
	set error(value: string | null) {
		error = value;
	},
	/** 同期中の進捗(phase が null のときは進捗なし) */
	get progress() {
		return progress;
	},
	set progress(value: SyncProgress) {
		progress = value;
	},
	/** 手動解決待ちの競合の数 */
	get conflictCount() {
		return conflictCount;
	},
	set conflictCount(value: number) {
		conflictCount = value;
	},
	get conflictDialogOpen() {
		return conflictDialogOpen;
	},
	set conflictDialogOpen(value: boolean) {
		conflictDialogOpen = value;
	},
	/** Firebase が初期化済み(= 同期の対象になっている)か */
	get isConfigured() {
		return configured;
	},
	set isConfigured(value: boolean) {
		configured = value;
	},
	get isOnline() {
		return status !== 'offline';
	}
};
