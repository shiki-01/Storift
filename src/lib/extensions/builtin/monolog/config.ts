/**
 * Monolog. 連携の定数。仕様の出典は https://www.monolog.life/developers
 * client_id は public クライアント(PKCE S256 のみ、client_secret なし)なので、ソースに含めてよい
 */
export const MONOLOG_CLIENT_ID = 'mlc_7vwiiiwkcdglzq4ggnsq';
export const MONOLOG_SCOPE = 'records:write timer';

export const AUTHORIZE_URL = 'https://www.monolog.life/oauth/authorize';
export const TOKEN_URL = 'https://api.monolog.life/oauth/token';
export const REVOKE_URL = 'https://api.monolog.life/oauth/revoke';
export const API_BASE = 'https://api.monolog.life/v1';

/** Monolog. に登録済みのリダイレクト URI(完全一致が必要) */
export const WEB_ORIGIN = 'https://app.storift.shiki-01.com';
export const WEB_REDIRECT_URI = `${WEB_ORIGIN}/monolog/callback`;
export const DESKTOP_REDIRECT_URI = 'storift://monolog/callback';

/** 設定画面から開く場所(接続後の戻り先) */
export const SETTINGS_PATH = '/settings#extensions';

export const PRIVACY_URL = 'https://storift.shiki-01.com/privacy';

export function redirectUriFor(desktop: boolean): string {
	return desktop ? DESKTOP_REDIRECT_URI : WEB_REDIRECT_URI;
}

/**
 * このビルド・環境で連携を始められるか。
 * リダイレクト URI は本番のものしか登録されていない。Web 版は本番のオリジンでだけ、
 * デスクトップ版はカスタムスキームなので常に可能
 */
export function isConnectAvailable(desktop: boolean, origin: string | undefined): boolean {
	return desktop || origin === WEB_ORIGIN;
}
