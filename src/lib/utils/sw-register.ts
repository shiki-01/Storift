import { Workbox } from 'workbox-window';

let wb: Workbox | null = null;

/**
 * Service Workerの登録
 */
export async function registerServiceWorker(): Promise<void> {
	if (!('serviceWorker' in navigator)) {
		console.warn('⚠️ Service Worker not supported');
		return;
	}

	// 開発環境では既存のService Workerを登録解除
	if (import.meta.env.DEV) {
		console.log('⏭️ Service Worker skipped in development mode');

		// 既存のService Workerを登録解除
		const registrations = await navigator.serviceWorker.getRegistrations();
		for (const registration of registrations) {
			await registration.unregister();
			console.log('🗑️ Unregistered existing Service Worker');
		}

		return;
	}

	try {
		// Workboxインスタンスを作成
		wb = new Workbox('/sw.js');

		// Service Workerの更新を検知
		wb.addEventListener('waiting', () => {
			console.log('🔄 New Service Worker available');

			// 新しいService Workerがあることをユーザーに通知
			if (confirm('新しいバージョンが利用可能です。更新しますか?')) {
				wb?.messageSkipWaiting();
			}
		});

		// Service Workerがコントロールを取得
		wb.addEventListener('controlling', () => {
			console.log('✅ Service Worker controlling');
			window.location.reload();
		});

		// バックグラウンド同期の開始を検知
		wb.addEventListener('message', (event) => {
			if (event.data.type === 'BACKGROUND_SYNC_START') {
				console.log('🔄 Background sync started');
				// syncStore等を更新する処理をここに追加
			}
		});

		// Service Workerを登録
		await wb.register();
		console.log('✅ Service Worker registered');

		// Background Sync APIの登録
		if ('sync' in wb.getSW()) {
			try {
				const sw = await wb.getSW();
				const registration = await navigator.serviceWorker.ready;
				// @ts-ignore - Background Sync APIは実験的機能
				await registration.sync.register('storift-background-sync');
				console.log('✅ Background Sync registered');
			} catch (error) {
				console.warn('⚠️ Background Sync not supported:', error);
			}
		}

		// Periodic Background Sync APIの登録 (実験的機能)
		if ('periodicSync' in wb.getSW()) {
			try {
				const registration = await navigator.serviceWorker.ready;
				const status = await navigator.permissions.query({
					name: 'periodic-background-sync' as PermissionName
				});

				if (status.state === 'granted') {
					// @ts-ignore - periodicSyncは実験的API
					await registration.periodicSync.register('storift-periodic-sync', {
						minInterval: 24 * 60 * 60 * 1000 // 24時間
					});
					console.log('✅ Periodic Background Sync registered');
				}
			} catch (error) {
				console.warn('⚠️ Periodic Background Sync not supported:', error);
			}
		}
	} catch (error) {
		console.error('❌ Service Worker registration failed:', error);
	}
}

/**
 * Service Workerの登録解除
 */
export async function unregisterServiceWorker(): Promise<void> {
	if (!('serviceWorker' in navigator)) {
		return;
	}

	try {
		const registration = await navigator.serviceWorker.ready;
		const success = await registration.unregister();

		if (success) {
			console.log('✅ Service Worker unregistered');
		}
	} catch (error) {
		console.error('❌ Service Worker unregistration failed:', error);
	}
}

/**
 * Service Workerを強制更新
 */
export async function updateServiceWorker(): Promise<void> {
	if (wb) {
		wb.messageSkipWaiting();
	}
}

/**
 * Service Workerにメッセージを送信
 */
export async function sendMessageToSW(message: any): Promise<void> {
	if (wb) {
		wb.messageSW(message);
	}
}

/**
 * バックグラウンド同期をトリガー
 */
export async function triggerBackgroundSync(data: any): Promise<void> {
	try {
		// Service Workerにメッセージを送信
		await sendMessageToSW({
			type: 'SYNC_REQUEST',
			payload: data
		});

		// Background Sync APIを使用
		if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
			const registration = await navigator.serviceWorker.ready;
			// @ts-ignore - Background Sync APIは実験的機能
			await registration.sync.register('storift-background-sync');
		}
	} catch (error) {
		console.error('❌ Background sync trigger failed:', error);
	}
}

/**
 * Service Workerの状態を取得
 */
export function getServiceWorkerStatus(): {
	supported: boolean;
	registered: boolean;
	backgroundSyncSupported: boolean;
} {
	const supported = 'serviceWorker' in navigator;
	const backgroundSyncSupported =
		'serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype;

	return {
		supported,
		registered: wb !== null,
		backgroundSyncSupported
	};
}
