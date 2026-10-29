import cloudflare from '@sveltejs/adapter-cloudflare';
import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// ビルド識別子。設定ファイルは 1 回のビルド中に複数回読み込まれるため、
// 時刻で作る場合は環境変数に固定して、クライアントと Service Worker で同じ値になるようにする
const buildId = process.env.CF_PAGES_COMMIT_SHA
	? process.env.CF_PAGES_COMMIT_SHA.slice(0, 8)
	: (process.env.STORIFT_BUILD_ID ??= String(Date.now()));

// デスクトップ版(Tauri)のビルドか。Tauri CLI が beforeDevCommand / beforeBuildCommand に渡す
const isDesktop = !!(process.env.TAURI_ENV_PLATFORM || process.env.STORIFT_DESKTOP);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// デスクトップ版は静的ファイル一式をアプリに同梱し、どの URL も index.html で起動する
		adapter: isDesktop
			? staticAdapter({ fallback: 'index.html' })
			: cloudflare({
					routes: {
						include: ['/*'],
						exclude: ['<all>']
					}
				}),
		// Service Worker の登録は src/lib/utils/sw-register.ts で行う(更新の適用を制御するため)
		serviceWorker: { register: false },
		version: {
			// 配信元が更新されたかの判定に使う。Cloudflare Pages ではコミットの SHA、なければ時刻
			name: buildId,
			// デスクトップ版はアプリごと更新するので、配信元の更新は確認しない
			pollInterval: isDesktop ? 0 : 5 * 60 * 1000
		}
	}
};

export default config;
