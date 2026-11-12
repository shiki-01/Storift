import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import masterCSS from '@master/css.vite';
import { readFileSync } from 'node:fs';

// 「このアプリについて」に出すバージョン(package.json の version をビルド時に埋め込む)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
	version: string;
};

// PWA(Service Worker とマニフェスト)は SvelteKit 標準の仕組みで提供している:
//   - src/service-worker.ts   : オフライン用のキャッシュ
//   - static/manifest.webmanifest : インストール情報
//   - src/lib/utils/sw-register.ts : 登録と自動更新
export default defineConfig({
	define: { __APP_VERSION__: JSON.stringify(pkg.version) },
	plugins: [sveltekit(), masterCSS()],
	server: {
		fs: {
			allow: ['master.css.ts', 'extensions']
		}
	}
});
