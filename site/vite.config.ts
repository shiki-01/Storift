import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		fs: {
			// リポジトリ直下の extensions/ と、アプリ側のマニフェストの検証(src/lib/extensions/manifest.ts)を読む
			allow: ['../extensions', '../src/lib/extensions']
		}
	}
});
