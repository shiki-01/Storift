import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import masterCSS from '@master/css.vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		sveltekit(),
		masterCSS(),
		VitePWA({
			registerType: 'autoUpdate',
			srcDir: 'src',
			filename: 'service-worker.ts',
			strategies: 'injectManifest',
			injectManifest: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json}']
			},
			includeAssets: ['favicon.ico', 'robots.txt', 'manifest.json'],
			manifest: {
				name: 'Storift - 小説執筆アプリ',
				short_name: 'Storift',
				description: 'オフライン対応の小説執筆PWAアプリ。クラウド同期、プロット管理、キャラクター管理など執筆に必要な機能を搭載。',
				theme_color: '#3b82f6',
				background_color: '#ffffff',
				display: 'standalone',
				start_url: '/',
				scope: '/',
				orientation: 'any',
				icons: [
					{
						src: '/icon-72.png',
						sizes: '72x72',
						type: 'image/png',
						purpose: 'any'
					},
					{
						src: '/icon-96.png',
						sizes: '96x96',
						type: 'image/png',
						purpose: 'any'
					},
					{
						src: '/icon-128.png',
						sizes: '128x128',
						type: 'image/png',
						purpose: 'any'
					},
					{
						src: '/icon-144.png',
						sizes: '144x144',
						type: 'image/png',
						purpose: 'any'
					},
					{
						src: '/icon-152.png',
						sizes: '152x152',
						type: 'image/png',
						purpose: 'any'
					},
					{
						src: '/icon-192.png',
						sizes: '192x192',
						type: 'image/png',
						purpose: 'any maskable'
					},
					{
						src: '/icon-384.png',
						sizes: '384x384',
						type: 'image/png',
						purpose: 'any'
					},
					{
						src: '/icon-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any maskable'
					}
				],
				categories: ['productivity', 'utilities'],
				lang: 'ja',
				dir: 'ltr',
				display_override: ['window-controls-overlay', 'standalone'],
				shortcuts: [
					{
						name: '新規プロジェクト',
						short_name: '新規',
						description: '新しい小説プロジェクトを作成',
						url: '/home?action=new',
						icons: [{ src: '/icon-192.png', sizes: '192x192' }]
					},
					{
						name: '執筆エディタ',
						short_name: '執筆',
						description: '最近のプロジェクトを開く',
						url: '/home',
						icons: [{ src: '/icon-192.png', sizes: '192x192' }]
					}
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json}'],
				cleanupOutdatedCaches: true,
				clientsClaim: true,
				skipWaiting: true,
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'firestore-cache',
							expiration: {
								maxEntries: 20,
								maxAgeSeconds: 60 * 60 * 24 * 7 // 1週間
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'google-fonts-stylesheets',
							expiration: {
								maxEntries: 10,
								maxAgeSeconds: 60 * 60 * 24 * 365 // 1年
							}
						}
					},
					{
						urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'google-fonts-webfonts',
							expiration: {
								maxEntries: 30,
								maxAgeSeconds: 60 * 60 * 24 * 365 // 1年
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'images-cache',
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 60 * 60 * 24 * 30 // 30日
							}
						}
					}
				]
			},
			devOptions: {
				enabled: false, // 開発環境ではService Workerを無効化
				type: 'module'
			}
		})
	],
	server: {
		fs: {
			allow: ['master.css.ts']
		}
	}
});
