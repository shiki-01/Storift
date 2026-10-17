import { toast } from '$lib/stores/toast.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import { syncStore } from '$lib/stores/sync.svelte';

/** 更新の確認間隔(アプリを開いたままのとき) */
const UPDATE_CHECK_INTERVAL = 20 * 60 * 1000;
/** 連続して確認しない最短の間隔 */
const MIN_CHECK_GAP = 60 * 1000;

let registration: ServiceWorkerRegistration | null = null;
let lastCheck = 0;
let applying = false;

/**
 * 新しいバージョンへ切り替えても失われるものが無い状態か。
 * 未保存の本文や、同期の最中は待つ。
 */
export function isSafeToUpdate(): boolean {
	return !editorStore.isDirty && !editorStore.isSaving && !syncStore.isSyncing;
}

/**
 * Service Worker を登録し、配信元が更新されたら自動で新しいバージョンへ切り替える。
 * 切り替え(skipWaiting → ページの再読み込み)は、未保存の編集が無いときだけ行う。
 */
export async function registerServiceWorker(): Promise<void> {
	if (!('serviceWorker' in navigator)) {
		console.warn('⚠️ Service Worker not supported');
		return;
	}

	// 開発中は既存の Service Worker とキャッシュを消して、常に最新のコードを見る
	if (import.meta.env.DEV) {
		for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
		for (const key of await caches.keys()) await caches.delete(key);
		return;
	}

	// 初回インストール時の clients.claim() で再読み込みしないよう、制御されていたかを覚えておく
	const hadController = !!navigator.serviceWorker.controller;

	try {
		registration = await navigator.serviceWorker.register('/service-worker.js', {
			scope: '/',
			updateViaCache: 'none'
		});
	} catch (error) {
		console.error('❌ Service Worker registration failed:', error);
		return;
	}

	// 新しい Service Worker の待機を検知して適用する
	const watch = (worker: ServiceWorker | null) => {
		if (!worker) return;
		const onState = () => {
			if (worker.state === 'installed' && navigator.serviceWorker.controller) {
				void applyWhenSafe(worker);
			}
		};
		worker.addEventListener('statechange', onState);
		onState();
	};
	registration.addEventListener('updatefound', () => watch(registration?.installing ?? null));
	if (registration.waiting && navigator.serviceWorker.controller) {
		void applyWhenSafe(registration.waiting);
	}

	let reloading = false;
	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (!hadController || reloading) return;
		reloading = true;
		window.location.reload();
	});

	// 配信元の更新を取りに行くきっかけ
	const check = () => void checkForUpdate();
	window.addEventListener('online', check);
	window.addEventListener('pageshow', check);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') check();
	});
	setInterval(check, UPDATE_CHECK_INTERVAL);
	check();
}

/** 配信元に新しいバージョンがあるか確認する(あれば Service Worker の更新が走る) */
export async function checkForUpdate(): Promise<void> {
	if (!registration || !navigator.onLine) return;
	const now = Date.now();
	if (now - lastCheck < MIN_CHECK_GAP) return;
	lastCheck = now;
	try {
		await registration.update();
	} catch {
		// オフラインなどは次の機会に
	}
}

/** 安全になるまで待ってから、新しいバージョンへ切り替える */
async function applyWhenSafe(worker: ServiceWorker): Promise<void> {
	if (applying) return;
	applying = true;
	let notified = false;
	while (!isSafeToUpdate()) {
		if (!notified) {
			notified = true;
			toast.info('新しいバージョンがあります。保存が終わると自動で更新します');
		}
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	toast.info('新しいバージョンに更新しています…', { duration: 1500 });
	worker.postMessage({ type: 'SKIP_WAITING' });
	// 切り替わらなかった場合に備えて、次の機会に再試行できるようにする
	setTimeout(() => (applying = false), 10000);
}

/** 今動いている Service Worker のバージョンを取得する(動いていなければ null) */
export async function getServiceWorkerVersion(): Promise<string | null> {
	const controller = navigator.serviceWorker?.controller;
	if (!controller) return null;
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => resolve(null), 1500);
		channel.port1.onmessage = (event) => {
			clearTimeout(timer);
			resolve((event.data as { version?: string }).version ?? null);
		};
		controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
	});
}
