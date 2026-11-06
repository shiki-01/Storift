import { defineConfig } from 'vitest/config';

// Firestore ルールテスト用。Firebase Emulator が必要なため `bun run test:rules` から実行する。
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/rules/**/*.test.ts'],
		testTimeout: 20000,
		hookTimeout: 60000,
		fileParallelism: false
	}
});
