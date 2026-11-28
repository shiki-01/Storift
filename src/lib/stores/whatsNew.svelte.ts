/**
 * 更新情報(このバージョンの変更点)のポップアップ。
 *
 * - 起動時に、前回見た版(この端末に保存)と今の版を比べ、新しくなっていれば、その間の版の変更点を表示する。
 * - 前回の記録が無いときは、初めて使う端末なら表示せずに今の版を記録する。以前から使っている端末
 *   (この機能より前の版から更新した端末)なら、今の版の変更点を表示する。
 * - 「更新のあとに表示する」をオフにすると、自動では表示しない(設定の「このアプリについて」から見られる)。
 * - 変更点は、ビルド時に CHANGELOG.md から取り込む(通信しない)。
 */
import changelog from '../../../CHANGELOG.md?raw';
import { parseChangelog, releasesSince, type Release } from '$lib/utils/releaseNotes';

const SEEN_KEY = 'storift:last-seen-version';
const PREF_KEY = 'storift:whats-new';
/** 以前から使っている端末か(この機能より前の版で保存されるもの) */
const PRIOR_USE_KEYS = ['storift:editor-prefs', 'storift:updater', 'storift:scroll-positions'];
/** 起動直後の読み込みが落ち着いてから出す */
const SHOW_DELAY = 1500;

export const ALL_RELEASES: Release[] = parseChangelog(changelog);

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// 保存できなくても表示には影響しない(次回また表示されるだけ)
	}
}

function loadShowOnUpdate(): boolean {
	try {
		const raw = read(PREF_KEY);
		if (raw) return JSON.parse(raw).showOnUpdate !== false;
	} catch {
		// 読めなければ既定(オン)
	}
	return true;
}

let open = $state(false);
/** 'update': 更新の直後に自動で出した / 'manual': 設定などから開いた */
let mode = $state<'update' | 'manual'>('manual');
/** 今回の更新で新しくなった版(新しい順) */
let fresh = $state<Release[]>([]);
let showOnUpdate = $state(loadShowOnUpdate());
let initialized = false;

export const whatsNewStore = {
	get open() {
		return open;
	},
	set open(value: boolean) {
		open = value;
	},
	get mode() {
		return mode;
	},
	get releases() {
		return fresh.length > 0 ? fresh : ALL_RELEASES.slice(0, 1);
	},
	get all() {
		return ALL_RELEASES;
	},
	get currentVersion() {
		return __APP_VERSION__;
	},
	get showOnUpdate() {
		return showOnUpdate;
	},
	set showOnUpdate(value: boolean) {
		showOnUpdate = value;
		write(PREF_KEY, JSON.stringify({ showOnUpdate: value }));
	},

	/** 起動時に 1 回呼ぶ。更新されていれば少し待ってから表示する。shouldSkip が true なら出さない */
	init(shouldSkip: () => boolean = () => false): void {
		if (initialized || typeof window === 'undefined') return;
		initialized = true;
		const current = __APP_VERSION__;
		const lastSeen = read(SEEN_KEY);
		const priorUse = lastSeen === null && PRIOR_USE_KEYS.some((k) => read(k) !== null);
		write(SEEN_KEY, current);
		if (lastSeen === null && !priorUse) return;
		// 自動操作のブラウザ(E2E など)では出さない
		if (navigator.webdriver) return;
		const releases = releasesSince(ALL_RELEASES, current, lastSeen);
		if (releases.length === 0 || !showOnUpdate) return;
		setTimeout(() => {
			if (shouldSkip()) return;
			fresh = releases;
			mode = 'update';
			open = true;
		}, SHOW_DELAY);
	},

	/** 設定などから開く */
	show(): void {
		mode = 'manual';
		open = true;
	},

	close(): void {
		open = false;
	}
};
