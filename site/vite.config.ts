import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// サイトの外にある src/lib/extensions/manifest.ts を読み込むとき、esbuild はリポジトリ直下の tsconfig.json を探す。
	// そこが extends する .svelte-kit/tsconfig.json は、アプリ側で svelte-kit sync を実行しないと無く、CI で失敗するため、
	// 型は変換しかしない(型検査は site の check で行う)ので tsconfig を読み込ませない
	esbuild: { tsconfigRaw: '{}' },
	server: {
		fs: {
			// リポジトリ直下の extensions/ と、アプリ側のマニフェストの検証(src/lib/extensions/manifest.ts)を読む
			allow: ['../extensions', '../src/lib/extensions']
		}
	}
});
