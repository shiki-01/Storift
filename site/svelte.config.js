import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ pages: 'build', assets: 'build', fallback: undefined, strict: true }),
		// PUBLIC_ 接頭辞の環境変数だけをクライアントへ公開する
		env: { publicPrefix: 'PUBLIC_' },
		alias: {
			// 拡張のマニフェスト(リポジトリ直下の extensions/<id>/manifest.json)。アプリと同じファイルを読む
			$extensions: '../extensions',
			// マニフェストの型と検証(アプリと同じ実装を使う。他のモジュールに依存しない純関数)
			$manifest: '../src/lib/extensions/manifest.ts'
		}
	}
};

export default config;
