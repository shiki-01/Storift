/**
 * テスト用の $app/paths。パスをそのまま返す(paths.base は空)。
 * vitest.config.ts の alias で向ける(本番ビルドでは使わない)。
 */
export const resolve = (path: string): string => path;
export const base = '';
