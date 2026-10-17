import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import masterCSS from '@master/css.vite';

// PWA(Service Worker とマニフェスト)は SvelteKit 標準の仕組みで提供している:
//   - src/service-worker.ts   : オフライン用のキャッシュ
//   - static/manifest.webmanifest : インストール情報
//   - src/lib/utils/sw-register.ts : 登録と自動更新
export default defineConfig({
	plugins: [sveltekit(), masterCSS()],
	server: {
		fs: {
			allow: ['master.css.ts']
		}
	}
});
