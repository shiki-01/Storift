/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Storift の Service Worker。
 *
 * - アプリ本体(ビルド成果物と静的ファイル)とアプリの殻(HTML)を、このバージョン専用のキャッシュへ保存する。
 *   データは端末内の IndexedDB にあるので、これだけでオフラインでも起動・執筆できる。
 * - 殻と成果物は同じバージョンのものだけを使う(キャッシュ優先)。更新は Service Worker の更新として届き、
 *   クライアント側(sw-register.ts)が安全なタイミングで適用する。
 * - Firebase などの外部通信には介入しない(SDK が自前でオフラインを扱う)。
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `storift-app-${version}`;
const RUNTIME_CACHE = 'storift-runtime';
const SHELL_URL = '/';

// フォントは大きいので、インストール時ではなく初回使用時にキャッシュする
const PRECACHE = [
	...build,
	...files.filter((path) => !path.startsWith('/font/') && !path.endsWith('.woff'))
];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(APP_CACHE);
			// HTTP キャッシュの古いものを拾わないよう、必ずサーバーへ取りに行く
			await Promise.all(
				PRECACHE.map(async (path) => {
					const response = await fetch(new Request(path, { cache: 'reload' }));
					if (!response.ok) throw new Error(`precache failed: ${path} (${response.status})`);
					await cache.put(path, response);
				})
			);
			// アプリの殻。どの URL でも同じ HTML で起動できる(ssr = false)
			const shell = await fetch(new Request(SHELL_URL, { cache: 'reload' }));
			const type = shell.headers.get('content-type') ?? '';
			if (!shell.ok || !type.includes('text/html')) throw new Error('shell fetch failed');
			await cache.put(SHELL_URL, shell);
			// ここでは skipWaiting しない。更新の適用はクライアントが「未保存の編集が無い」ときに指示する
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// 古いバージョンのキャッシュ(以前の Workbox のものを含む)を削除
			const keep = new Set([APP_CACHE, RUNTIME_CACHE]);
			for (const key of await caches.keys()) {
				if (!keep.has(key)) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string } | undefined;
	if (data?.type === 'SKIP_WAITING') {
		void sw.skipWaiting();
	} else if (data?.type === 'GET_VERSION') {
		event.ports[0]?.postMessage({ version });
	}
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	if (url.origin === sw.location.origin) {
		// 更新の検知に使うので、常にネットワークへ
		if (url.pathname === '/_app/version.json') return;

		if (request.mode === 'navigate') {
			event.respondWith(handleNavigation(request));
		} else if (url.pathname.startsWith('/font/')) {
			event.respondWith(cacheFirst(request, RUNTIME_CACHE));
		} else {
			event.respondWith(handleAsset(request));
		}
		return;
	}

	// Google Fonts は、表示しながら裏で更新する
	if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
		event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
	}
});

/** ページの表示: 保存済みの殻を即座に返す。なければネットワーク */
async function handleNavigation(request: Request): Promise<Response> {
	const cache = await caches.open(APP_CACHE);
	const shell = await cache.match(SHELL_URL);
	if (shell) return shell;
	try {
		return await fetch(request);
	} catch {
		return new Response(
			'オフラインのため開けませんでした。ネットワークに接続して再読み込みしてください。',
			{
				status: 503,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' }
			}
		);
	}
}

/** ビルド成果物・静的ファイル: このバージョンのキャッシュを優先 */
async function handleAsset(request: Request): Promise<Response> {
	const cache = await caches.open(APP_CACHE);
	const url = new URL(request.url);
	const cached = (await cache.match(url.pathname)) ?? (await cache.match(request));
	if (cached) return cached;
	return fetch(request);
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) void cache.put(request, response.clone());
	return response;
}

async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	const network = fetch(request)
		.then((response) => {
			if (response.ok || response.type === 'opaque') void cache.put(request, response.clone());
			return response;
		})
		.catch(() => undefined);
	return cached ?? (await network) ?? Response.error();
}
