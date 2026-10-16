import type { SyncStatus } from '$lib/types';

// ブラウザの実際のオンライン状態から初期値を設定
const initialStatus: SyncStatus =
	typeof navigator !== 'undefined' && navigator.onLine ? 'synced' : 'offline';

let status = $state<SyncStatus>(initialStatus);
let lastSyncTime = $state<number | null>(null);
let isSyncing = $state(false);
let error = $state<string | null>(null);
let conflictCount = $state(0);
let conflictDialogOpen = $state(false);

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
	get isOnline() {
		return status !== 'offline';
	}
};
