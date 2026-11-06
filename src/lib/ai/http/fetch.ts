/**
 * HTTP 系プロバイダが使う fetch。
 * デスクトップ版では tauri-plugin-http の fetch を使う(Rust 側から送るので CORS の影響を受けず、
 * ストリーミングにも対応する)。送れる先は capabilities/default.json のスコープで制限している。
 * リダイレクトは追わない(API キーを別のホストへ送らないため)。
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let cached: FetchLike | null = null;

/** tauri-plugin-http の fetch。Web 版には含めないよう、使うときに読み込む */
export async function tauriFetch(): Promise<FetchLike> {
	if (cached) return cached;
	const { fetch } = await import('@tauri-apps/plugin-http');
	cached = (input, init) => fetch(input, { ...init, maxRedirections: 0 });
	return cached;
}
