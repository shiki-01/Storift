import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
	define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
	plugins: [svelte({ hot: !process.env.VITEST })],
	test: {
		globals: true,
		environment: 'happy-dom',
		include: ['src/**/*.{test,spec}.{js,ts}'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/',
				'src/**/*.d.ts',
				'src/**/*.config.{js,ts}',
				'**/*.spec.ts',
				'**/*.test.ts'
			]
		}
	},
	resolve: {
		// コンポーネントのテストでは Svelte のクライアント向けビルドを使う(mount が必要)
		conditions: ['browser'],
		alias: {
			$lib: resolve(__dirname, './src/lib'),
			// テストでは $app/state を stub に向ける(page はテストごとに差し替える)
			'$app/state': resolve(__dirname, './src/lib/test/app-state.ts'),
			'$app/navigation': resolve(__dirname, './src/lib/test/app-navigation.ts'),
			'$app/paths': resolve(__dirname, './src/lib/test/app-paths.ts'),
			$app: resolve(__dirname, './.svelte-kit/runtime/app')
		}
	}
});
