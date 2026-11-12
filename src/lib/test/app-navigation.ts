/**
 * テスト用の $app/navigation。拡張のパネルなど、遷移を呼ぶだけのコンポーネントを読み込めるようにする。
 * vitest.config.ts の alias で向ける(本番ビルドでは使わない)。
 */
export const goto = async (_url: string | URL): Promise<void> => {};
export const beforeNavigate = (_callback: unknown): void => {};
