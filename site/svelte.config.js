import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ pages: 'build', assets: 'build', fallback: undefined, strict: true }),
		// PUBLIC_ 接頭辞の環境変数だけをクライアントへ公開する
		env: { publicPrefix: 'PUBLIC_' }
	}
};

export default config;
