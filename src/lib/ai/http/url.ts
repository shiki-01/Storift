/**
 * HTTP 系プロバイダの接続先(base URL)の検証。
 * 通信は https か、この端末内(localhost / 127.0.0.1 / [::1])への http だけを許す。
 * tauri-plugin-http のスコープ(capabilities/default.json)と同じ条件を、送る前にもここで確かめる。
 */

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 接続先を検証し、末尾のスラッシュを除いた形にして返す */
export function validateBaseUrl(input: string, example = 'https://api.openai.com/v1'): UrlCheck {
	const text = input.trim();
	if (!text) return { ok: false, error: 'Base URL が空です' };
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return { ok: false, error: `Base URL の形式が正しくありません(例: ${example})` };
	}
	if (url.username || url.password)
		return { ok: false, error: 'Base URL にユーザー名やパスワードを含めないでください' };
	if (url.protocol === 'http:') {
		if (!LOCAL_HOSTS.has(url.hostname))
			return {
				ok: false,
				error: 'http:// で接続できるのは、この端末内(localhost)だけです。https:// を使ってください'
			};
	} else if (url.protocol !== 'https:') {
		return { ok: false, error: 'Base URL は https:// で始めてください' };
	}
	if (url.search || url.hash)
		return { ok: false, error: 'Base URL にクエリやフラグメントを含めないでください' };
	return { ok: true, url: text.replace(/\/+$/, '') };
}

/** base URL とパスをつなぐ(base は validateBaseUrl を通した値) */
export function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
