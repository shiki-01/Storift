/**
 * テスト用の $app/state。SvelteKit の実行時の代わりに置き、テストが page を差し替えて使う。
 * vitest.config.ts の alias で $app/state をここへ向ける(本番ビルドでは使わない)。
 */
export const page: { params: Record<string, string>; url: URL } = {
	params: {},
	url: new URL('http://localhost/')
};
