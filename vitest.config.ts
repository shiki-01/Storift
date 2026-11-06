import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
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
		alias: {
			$lib: resolve(__dirname, './src/lib'),
			// テストでは $app/state を stub に向ける(page はテストごとに差し替える)
			'$app/state': resolve(__dirname, './src/lib/test/app-state.ts'),
			$app: resolve(__dirname, './.svelte-kit/runtime/app')
		}
	}
});
