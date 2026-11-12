/**
 * Monolog. の OAuth 2.0 (認可コード + PKCE)。
 * 認可 URL の組み立て、戻りの検証、トークンの交換・更新・失効。
 * OAuth のエンドポイントのエラーは RFC 6749 の形(error / error_description)で、リソース API のエラーとは形式が違う。
 */
import {
	AUTHORIZE_URL,
	MONOLOG_CLIENT_ID,
	MONOLOG_SCOPE,
	REVOKE_URL,
	TOKEN_URL,
	redirectUriFor
} from './config';
import { codeChallengeFor, generateCodeVerifier, generateState } from './pkce';

export interface TokenSet {
	accessToken: string;
	refreshToken: string;
	/** アクセストークンの有効期限(ms)。不明なら 0(期限を判定しない) */
	expiresAt: number;
	scope: string;
}

/** OAuth エンドポイントのエラー(RFC 6749) */
export class OAuthError extends Error {
	constructor(
		/** error コード(invalid_grant など)。取れなければ空 */
		readonly code: string,
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'OAuthError';
	}
}

/** 通信自体の失敗(オフラインなど)。サーバーが応答していないので、認可コードの再送はしない */
export class NetworkError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'NetworkError';
	}
}

type FetchFn = typeof fetch;

// ===== 認可の開始 =====

const PENDING_KEY = 'storift:monolog:oauth-pending';
/** 認可コードの有効期間(5 分)より少し長く。これを過ぎた保存は無効として捨てる */
const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingAuth {
	state: string;
	verifier: string;
	redirectUri: string;
	createdAt: number;
}

/**
 * 認可の途中状態(code_verifier と state)を保存する。
 * リダイレクトで別タブ・別ウィンドウに戻る場合も読めるよう localStorage に置き、使ったら必ず消す
 */
function savePending(pending: PendingAuth): void {
	localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function clearPending(): void {
	try {
		localStorage.removeItem(PENDING_KEY);
	} catch {
		// 使えない環境では何もしない
	}
}

/** 保存された途中状態を取り出して消す(1 回限り)。無い・期限切れ・壊れていれば null */
export function takePending(now = Date.now()): PendingAuth | null {
	try {
		const raw = localStorage.getItem(PENDING_KEY);
		localStorage.removeItem(PENDING_KEY);
		if (!raw) return null;
		const p = JSON.parse(raw) as Partial<PendingAuth>;
		if (
			typeof p.state !== 'string' ||
			typeof p.verifier !== 'string' ||
			typeof p.redirectUri !== 'string' ||
			typeof p.createdAt !== 'number' ||
			now - p.createdAt > PENDING_TTL_MS
		) {
			return null;
		}
		return p as PendingAuth;
	} catch {
		return null;
	}
}

export function buildAuthorizeUrl(params: {
	redirectUri: string;
	state: string;
	challenge: string;
}): string {
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: MONOLOG_CLIENT_ID,
		redirect_uri: params.redirectUri,
		scope: MONOLOG_SCOPE,
		state: params.state,
		code_challenge: params.challenge,
		code_challenge_method: 'S256'
	});
	// URLSearchParams は空白を + にするが、仕様の例に合わせて %20 にする
	return `${AUTHORIZE_URL}?${query.toString().replace(/\+/g, '%20')}`;
}

/** 認可 URL を作り、途中状態を保存する。返した URL をブラウザで開く */
export async function beginAuthorization(desktop: boolean): Promise<string> {
	const verifier = generateCodeVerifier();
	const state = generateState();
	const challenge = await codeChallengeFor(verifier);
	const redirectUri = redirectUriFor(desktop);
	savePending({ state, verifier, redirectUri, createdAt: Date.now() });
	return buildAuthorizeUrl({ redirectUri, state, challenge });
}

// ===== 戻りの解釈 =====

export type CallbackResult =
	| { kind: 'code'; code: string; state: string }
	| { kind: 'error'; error: string; description: string };

/** 戻りの URL のクエリを解釈する。error があればそれを優先する */
export function parseCallback(url: string | URL): CallbackResult | null {
	let u: URL;
	try {
		u = typeof url === 'string' ? new URL(url) : url;
	} catch {
		return null;
	}
	const error = u.searchParams.get('error');
	if (error) {
		return {
			kind: 'error',
			error,
			description: u.searchParams.get('error_description') ?? ''
		};
	}
	const code = u.searchParams.get('code');
	const state = u.searchParams.get('state');
	if (!code || !state) return null;
	return { kind: 'code', code, state };
}

export function describeAuthError(error: string, description: string): string {
	if (error === 'access_denied') return 'Monolog. への接続がキャンセルされました';
	return description ? `接続に失敗しました: ${description}` : `接続に失敗しました (${error})`;
}

// ===== トークン =====

async function postForm(
	url: string,
	body: Record<string, string>,
	fetchFn: FetchFn
): Promise<Response> {
	try {
		return await fetchFn(url, {
			method: 'POST',
			// JSON は不可。同じパラメータを 2 重に送らない(URLSearchParams はキーごとに 1 つ)
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(body).toString()
		});
	} catch (error) {
		throw new NetworkError('Monolog. に接続できませんでした', { cause: error });
	}
}

async function readOAuthError(res: Response): Promise<OAuthError> {
	let code = '';
	let description = '';
	try {
		const json = (await res.json()) as { error?: unknown; error_description?: unknown };
		if (typeof json.error === 'string') code = json.error;
		if (typeof json.error_description === 'string') description = json.error_description;
	} catch {
		// 本文が JSON でない場合は、ステータスだけで扱う
	}
	return new OAuthError(code, description || code || `HTTP ${res.status}`, res.status);
}

/** RFC 6749 のレスポンスを TokenSet にする。欠けたフィールドに備える */
export function parseTokenResponse(
	json: unknown,
	now: number,
	fallbackRefreshToken?: string
): TokenSet {
	const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
	const accessToken = typeof j.access_token === 'string' ? j.access_token : '';
	if (!accessToken) throw new OAuthError('invalid_response', 'トークンの応答が不正です', 200);
	const refreshToken =
		typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : fallbackRefreshToken;
	if (!refreshToken) throw new OAuthError('invalid_response', 'トークンの応答が不正です', 200);
	const expiresIn = typeof j.expires_in === 'number' && j.expires_in > 0 ? j.expires_in : 0;
	return {
		accessToken,
		refreshToken,
		expiresAt: expiresIn ? now + expiresIn * 1000 : 0,
		scope: typeof j.scope === 'string' ? j.scope : MONOLOG_SCOPE
	};
}

/**
 * 認可コードをトークンに交換する。
 * 認可コードは 1 回限りなので、通信エラーでも再送しない(呼び出し側でやり直しを案内する)
 */
export async function exchangeCode(
	params: { code: string; verifier: string; redirectUri: string },
	fetchFn: FetchFn = fetch,
	now = Date.now()
): Promise<TokenSet> {
	const res = await postForm(
		TOKEN_URL,
		{
			grant_type: 'authorization_code',
			code: params.code,
			redirect_uri: params.redirectUri,
			client_id: MONOLOG_CLIENT_ID,
			code_verifier: params.verifier
		},
		fetchFn
	);
	if (!res.ok) throw await readOAuthError(res);
	return parseTokenResponse(await res.json().catch(() => null), now);
}

/** リフレッシュトークンで更新する。リフレッシュトークンは更新のたびに新しくなる */
export async function refreshTokens(
	refreshToken: string,
	fetchFn: FetchFn = fetch,
	now = Date.now()
): Promise<TokenSet> {
	const res = await postForm(
		TOKEN_URL,
		{ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: MONOLOG_CLIENT_ID },
		fetchFn
	);
	if (!res.ok) throw await readOAuthError(res);
	return parseTokenResponse(await res.json().catch(() => null), now, refreshToken);
}

/** リフレッシュトークンを失効させる(本文なしの 200)。失敗は呼び出し側で無視してよい */
export async function revokeToken(refreshToken: string, fetchFn: FetchFn = fetch): Promise<void> {
	const res = await postForm(
		REVOKE_URL,
		{ token: refreshToken, client_id: MONOLOG_CLIENT_ID },
		fetchFn
	);
	if (!res.ok) throw await readOAuthError(res);
}
