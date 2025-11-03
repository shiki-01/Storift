import type { SyncStatus } from '$lib/types';

// ブラウザの実際のオンライン状態から初期値を設定
const initialStatus: SyncStatus = typeof navigator !== 'undefined' && navigator.onLine ? 'synced' : 'offline';

let status = $state<SyncStatus>(initialStatus);
let lastSyncTime = $state<number | null>(null);
let isSyncing = $state(false);
let error = $state<string | null>(null);

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
	get isOnline() {
		return status !== 'offline';
	}
};
