/**
 * デスクトップ版のアップデート。
 *
 * - 起動後に自動で確認し(設定でオフにできる)、新しい版があれば通知する。手動での確認もできる。
 * - 更新は自動では入れない。通知か設定画面から「更新」を押したときに、ダウンロードして入れる。
 * - 配布物には署名があり、アプリに埋め込んだ公開鍵と合わないものは入らない(tauri-plugin-updater)。
 */
import type { Update } from '@tauri-apps/plugin-updater';
import { toast } from '$lib/stores/toast.svelte';
import { isDesktop } from '$lib/desktop/platform';

export type UpdateStatus =
	| 'idle'
	| 'checking'
	| 'uptodate'
	| 'available'
	| 'downloading'
	| 'ready'
	| 'error';

const SETTINGS_KEY = 'storift:updater';
/** 起動直後は重いので、少し待ってから確認する */
const FIRST_CHECK_DELAY = 8_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function loadAutoCheck(): boolean {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (raw) return JSON.parse(raw).autoCheck !== false;
	} catch {
		// 読めなければ既定(オン)
	}
	return true;
}

let status = $state<UpdateStatus>('idle');
let version = $state<string | null>(null);
let notes = $state<string | null>(null);
/** ダウンロードの進み具合(0〜1)。サイズが分からなければ null */
let progress = $state<number | null>(null);
let error = $state<string | null>(null);
let lastChecked = $state<number | null>(null);
let autoCheck = $state(loadAutoCheck());

let pending: Update | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let notifiedVersion: string | null = null;

function fail(e: unknown) {
	error = e instanceof Error ? e.message : String(e);
	status = 'error';
}

export const updaterStore = {
	get status() {
		return status;
	},
	get version() {
		return version;
	},
	get notes() {
		return notes;
	},
	get progress() {
		return progress;
	},
	get error() {
		return error;
	},
	get lastChecked() {
		return lastChecked;
	},
	get autoCheck() {
		return autoCheck;
	},
	set autoCheck(value: boolean) {
		autoCheck = value;
		try {
			localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoCheck: value }));
		} catch {
			// 保存できなくても動作には影響しない
		}
		if (value) this.startAutoCheck();
		else this.stopAutoCheck();
	},
	get busy() {
		return status === 'checking' || status === 'downloading';
	},

	/**
	 * 新しい版を確認する。silent のときは「最新です」「失敗」を通知しない(自動確認用)。
	 * 戻り値は、新しい版があるか。
	 */
	async check(silent = false): Promise<boolean> {
		if (!isDesktop() || this.busy || status === 'ready') return status === 'ready';
		status = 'checking';
		error = null;
		try {
			const { check } = await import('@tauri-apps/plugin-updater');
			const update = await check();
			lastChecked = Date.now();
			pending = update;
			if (!update) {
				version = null;
				notes = null;
				status = 'uptodate';
				if (!silent) toast.success('最新のバージョンです');
				return false;
			}
			version = update.version;
			notes = update.body ?? null;
			status = 'available';
			// 同じ版を何度も知らせない(手動の確認では毎回知らせる)
			if (!silent || notifiedVersion !== update.version) {
				notifiedVersion = update.version;
				toast.info(`新しいバージョン ${update.version} があります`, {
					duration: 0,
					action: { label: '更新', onClick: () => void this.install() }
				});
			}
			return true;
		} catch (e) {
			fail(e);
			if (!silent) toast.error(`更新を確認できませんでした: ${error}`);
			return false;
		}
	},

	/** ダウンロードして入れる。macOS / Linux では入れ終わると再起動を案内する(Windows は自動で再起動) */
	async install(): Promise<void> {
		if (!pending || status === 'downloading') return;
		status = 'downloading';
		progress = null;
		error = null;
		try {
			let total = 0;
			let received = 0;
			await pending.downloadAndInstall((event) => {
				if (event.event === 'Started') {
					total = event.data.contentLength ?? 0;
					progress = total ? 0 : null;
				} else if (event.event === 'Progress') {
					received += event.data.chunkLength;
					if (total) progress = Math.min(1, received / total);
				} else if (event.event === 'Finished') {
					progress = 1;
				}
			});
			status = 'ready';
			toast.success('更新を入れました。再起動すると新しいバージョンになります', {
				duration: 0,
				action: { label: '再起動', onClick: () => void this.restart() }
			});
		} catch (e) {
			fail(e);
			toast.error(`更新できませんでした: ${error}`);
		}
	},

	async restart(): Promise<void> {
		try {
			const { relaunch } = await import('@tauri-apps/plugin-process');
			await relaunch();
		} catch (e) {
			fail(e);
			toast.error(`再起動できませんでした: ${error}`);
		}
	},

	/** 起動後と、その後は一定間隔で自動確認する */
	startAutoCheck() {
		if (!isDesktop() || !autoCheck) return;
		this.stopAutoCheck();
		firstTimer = setTimeout(() => void this.check(true), FIRST_CHECK_DELAY);
		timer = setInterval(() => void this.check(true), CHECK_INTERVAL);
	},

	stopAutoCheck() {
		if (firstTimer) clearTimeout(firstTimer);
		if (timer) clearInterval(timer);
		firstTimer = null;
		timer = null;
	}
};
