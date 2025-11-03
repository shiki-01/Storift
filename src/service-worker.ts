/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

// Precache assets - マニフェストが配列の場合のみ
const manifest = self.__WB_MANIFEST || [];
if (Array.isArray(manifest) && manifest.length > 0) {
	precacheAndRoute(manifest);
	cleanupOutdatedCaches();
} else {
	console.log('⚠️ No precache manifest found, skipping precaching');
}

// Background Sync Plugin for offline data sync
const bgSyncPlugin = new BackgroundSyncPlugin('storift-sync-queue', {
	maxRetentionTime: 24 * 60, // 24時間
	onSync: async ({ queue }) => {
		let entry;
		while ((entry = await queue.shiftRequest())) {
			try {
				await fetch(entry.request);
				console.log('✅ Synced:', entry.request.url);
			} catch (error) {
				console.error('❌ Sync failed:', error);
				await queue.unshiftRequest(entry);
				throw error;
			}
		}
	}
});

// Firestore API - Network First with Background Sync
registerRoute(
	({ url }) => url.hostname === 'firestore.googleapis.com',
	new NetworkFirst({
		cacheName: 'firestore-cache',
		plugins: [
			new CacheableResponsePlugin({
				statuses: [0, 200]
			}),
			new ExpirationPlugin({
				maxEntries: 50,
				maxAgeSeconds: 60 * 60 * 24 * 7 // 1週間
			}),
			bgSyncPlugin
		]
	})
);

// Firebase Auth - Network First
registerRoute(
	({ url }) =>
		url.hostname === 'identitytoolkit.googleapis.com' ||
		url.hostname === 'securetoken.googleapis.com',
	new NetworkFirst({
		cacheName: 'firebase-auth-cache',
		plugins: [
			new CacheableResponsePlugin({
				statuses: [0, 200]
			}),
			new ExpirationPlugin({
				maxEntries: 10,
				maxAgeSeconds: 60 * 60 * 24 // 1日
			})
		]
	})
);

// Google Fonts - Cache First
registerRoute(
	({ url }) =>
		url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
	new CacheFirst({
		cacheName: 'google-fonts',
		plugins: [
			new CacheableResponsePlugin({
				statuses: [0, 200]
			}),
			new ExpirationPlugin({
				maxEntries: 30,
				maxAgeSeconds: 60 * 60 * 24 * 365 // 1年
			})
		]
	})
);

// Static Assets (Images) - Cache First
registerRoute(
	({ request }) => request.destination === 'image',
	new CacheFirst({
		cacheName: 'images-cache',
		plugins: [
			new CacheableResponsePlugin({
				statuses: [0, 200]
			}),
			new ExpirationPlugin({
				maxEntries: 60,
				maxAgeSeconds: 60 * 60 * 24 * 30 // 30日
			})
		]
	})
);

// API Routes - Network First
registerRoute(
	({ url }) => url.pathname.startsWith('/api/'),
	new NetworkFirst({
		cacheName: 'api-cache',
		networkTimeoutSeconds: 10,
		plugins: [
			new CacheableResponsePlugin({
				statuses: [0, 200]
			}),
			bgSyncPlugin
		]
	})
);

// IndexedDB Sync Request Handler
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SYNC_REQUEST') {
		event.waitUntil(handleSyncRequest(event.data.payload));
	}

	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

// Background Sync Event
self.addEventListener('sync', (event) => {
	if (event.tag === 'storift-background-sync') {
		event.waitUntil(performBackgroundSync());
	}
});

// Periodic Background Sync (if supported)
self.addEventListener('periodicsync', (event: any) => {
	if (event.tag === 'storift-periodic-sync') {
		event.waitUntil(performPeriodicSync());
	}
});

// Push Notification
self.addEventListener('push', (event) => {
	const data = event.data?.json() ?? {};
	const options = {
		body: data.body || '新しい通知があります',
		icon: '/icon-192.png',
		badge: '/icon-96.png',
		data: data.data,
		tag: data.tag || 'storift-notification',
		requireInteraction: false,
		actions: data.actions || []
	};

	event.waitUntil(self.registration.showNotification(data.title || 'Storift', options));
});

// Notification Click
self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const urlToOpen = event.notification.data?.url || '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
			// 既存のウィンドウがあればフォーカス
			for (const client of clientList) {
				if (client.url === urlToOpen && 'focus' in client) {
					return client.focus();
				}
			}
			// なければ新しいウィンドウを開く
			if (self.clients.openWindow) {
				return self.clients.openWindow(urlToOpen);
			}
		})
	);
});

// Sync Request Handler
async function handleSyncRequest(payload: any) {
	try {
		console.log('🔄 Handling sync request:', payload);

		// ここでIndexedDBの変更をFirestoreに同期
		const response = await fetch('/api/sync', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			throw new Error('Sync failed');
		}

		console.log('✅ Sync completed successfully');
	} catch (error) {
		console.error('❌ Sync error:', error);
		throw error;
	}
}

// Background Sync
async function performBackgroundSync() {
	try {
		console.log('🔄 Performing background sync...');

		// Broadcast to all clients
		const clients = await self.clients.matchAll();
		clients.forEach((client) => {
			client.postMessage({
				type: 'BACKGROUND_SYNC_START'
			});
		});

		// 実際の同期処理はクライアント側で実行
		// Service Workerからは通知のみ

		console.log('✅ Background sync completed');
	} catch (error) {
		console.error('❌ Background sync failed:', error);
		throw error;
	}
}

// Periodic Sync
async function performPeriodicSync() {
	console.log('🔄 Performing periodic sync...');
	return performBackgroundSync();
}

// Service Worker Activation
self.addEventListener('activate', (event) => {
	event.waitUntil(Promise.all([self.clients.claim(), cleanupOutdatedCaches()]));
	console.log('✅ Service Worker activated');
});

// Service Worker Install
self.addEventListener('install', (event) => {
	console.log('📦 Service Worker installing...');
	self.skipWaiting();
});

console.log('🚀 Storift Service Worker loaded');
