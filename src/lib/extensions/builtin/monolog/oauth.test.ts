import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	NetworkError,
	OAuthError,
	beginAuthorization,
	buildAuthorizeUrl,
	exchangeCode,
	parseCallback,
	parseTokenResponse,
	refreshTokens,
	revokeToken,
	takePending
} from './oauth';
import { DESKTOP_REDIRECT_URI, WEB_REDIRECT_URI, isConnectAvailable, WEB_ORIGIN } from './config';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

beforeEach(() => localStorage.clear());

describe('認可 URL', () => {
	it('必要なパラメータを URL エンコードして組み立てる', () => {
		const url = buildAuthorizeUrl({ redirectUri: WEB_REDIRECT_URI, state: 'st', challenge: 'ch' });
		expect(url.startsWith('https://www.monolog.life/oauth/authorize?')).toBe(true);
		expect(url).toContain('response_type=code');
		expect(url).toContain('client_id=mlc_7vwiiiwkcdglzq4ggnsq');
		expect(url).toContain(`redirect_uri=${encodeURIComponent(WEB_REDIRECT_URI)}`);
		expect(url).toContain('scope=records%3Awrite%20timer');
		expect(url).toContain('state=st');
		expect(url).toContain('code_challenge=ch');
		expect(url).toContain('code_challenge_method=S256');
	});

	it('beginAuthorization は途中状態を保存し、取り出すと消える(1 回限り)', async () => {
		const url = new URL(await beginAuthorization(false));
		const state = url.searchParams.get('state')!;
		expect(url.searchParams.get('redirect_uri')).toBe(WEB_REDIRECT_URI);
		const pending = takePending();
		expect(pending?.state).toBe(state);
		expect(pending?.redirectUri).toBe(WEB_REDIRECT_URI);
		expect(takePending()).toBeNull();
	});

	it('デスクトップは storift:// のリダイレクト URI を使う', async () => {
		const url = new URL(await beginAuthorization(true));
		expect(url.searchParams.get('redirect_uri')).toBe(DESKTOP_REDIRECT_URI);
	});

	it('期限切れ・壊れた途中状態は無効', async () => {
		await beginAuthorization(false);
		expect(takePending(Date.now() + 11 * 60 * 1000)).toBeNull();
		localStorage.setItem('storift:monolog:oauth-pending', '{broken');
		expect(takePending()).toBeNull();
	});
});

describe('戻りの解釈', () => {
	it('code と state を取り出す', () => {
		expect(parseCallback(`${WEB_REDIRECT_URI}?code=abc&state=xyz`)).toEqual({
			kind: 'code',
			code: 'abc',
			state: 'xyz'
		});
		expect(parseCallback(`${DESKTOP_REDIRECT_URI}?code=abc&state=xyz`)).toMatchObject({
			kind: 'code'
		});
	});

	it('error があれば、code より優先して扱う', () => {
		expect(
			parseCallback(`${WEB_REDIRECT_URI}?error=access_denied&error_description=no&code=abc&state=x`)
		).toEqual({ kind: 'error', error: 'access_denied', description: 'no' });
	});

	it('code か state が無い、URL が壊れているときは null', () => {
		expect(parseCallback(`${WEB_REDIRECT_URI}?code=abc`)).toBeNull();
		expect(parseCallback('not a url')).toBeNull();
	});
});

describe('トークン', () => {
	it('認可コードの交換: form 形式で必要なパラメータを 1 つずつ送る', async () => {
		const fetchFn = vi.fn(async () =>
			json({
				access_token: 'mla_a',
				refresh_token: 'r1',
				expires_in: 3600,
				scope: 'records:write timer'
			})
		);
		const t = await exchangeCode(
			{ code: 'CODE', verifier: 'VER', redirectUri: WEB_REDIRECT_URI },
			fetchFn as unknown as typeof fetch,
			1000
		);
		expect(t).toEqual({
			accessToken: 'mla_a',
			refreshToken: 'r1',
			expiresAt: 1000 + 3600_000,
			scope: 'records:write timer'
		});
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.monolog.life/oauth/token');
		expect((init.headers as Record<string, string>)['Content-Type']).toBe(
			'application/x-www-form-urlencoded'
		);
		const params = new URLSearchParams(init.body as string);
		expect(params.getAll('grant_type')).toEqual(['authorization_code']);
		expect(params.get('code')).toBe('CODE');
		expect(params.get('redirect_uri')).toBe(WEB_REDIRECT_URI);
		expect(params.get('client_id')).toBe('mlc_7vwiiiwkcdglzq4ggnsq');
		expect(params.get('code_verifier')).toBe('VER');
		expect(params.has('client_secret')).toBe(false);
	});

	it('認可コードの交換は、通信エラーでも再送しない', async () => {
		const fetchFn = vi.fn(async () => {
			throw new TypeError('network');
		});
		await expect(
			exchangeCode(
				{ code: 'c', verifier: 'v', redirectUri: 'r' },
				fetchFn as unknown as typeof fetch
			)
		).rejects.toBeInstanceOf(NetworkError);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('OAuth のエラーは RFC 6749 の形で読む', async () => {
		const fetchFn = vi.fn(async () =>
			json({ error: 'invalid_grant', error_description: 'expired' }, 400)
		);
		const error = await refreshTokens('old', fetchFn as unknown as typeof fetch).catch((e) => e);
		expect(error).toBeInstanceOf(OAuthError);
		expect(error).toMatchObject({ code: 'invalid_grant', message: 'expired', status: 400 });
	});

	it('更新: refresh_token を送り、新しいリフレッシュトークンを返す', async () => {
		const fetchFn = vi.fn(async () =>
			json({ access_token: 'mla_b', refresh_token: 'r2', expires_in: 60 })
		);
		const t = await refreshTokens('r1', fetchFn as unknown as typeof fetch, 0);
		expect(t.refreshToken).toBe('r2');
		const params = new URLSearchParams(
			(fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		);
		expect(params.get('grant_type')).toBe('refresh_token');
		expect(params.get('refresh_token')).toBe('r1');
		expect(params.get('client_id')).toBe('mlc_7vwiiiwkcdglzq4ggnsq');
	});

	it('レスポンスのフィールド欠落に防御的: refresh_token が無ければ古い値を保つ、access_token が無ければ失敗', () => {
		expect(parseTokenResponse({ access_token: 'a' }, 0, 'old')).toMatchObject({
			refreshToken: 'old',
			expiresAt: 0
		});
		expect(() => parseTokenResponse({}, 0, 'old')).toThrow(OAuthError);
		expect(() => parseTokenResponse(null, 0)).toThrow(OAuthError);
		expect(() => parseTokenResponse({ access_token: 'a' }, 0)).toThrow(OAuthError);
	});

	it('失効: token と client_id を form で送る', async () => {
		const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
		await revokeToken('r1', fetchFn as unknown as typeof fetch);
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.monolog.life/oauth/revoke');
		const params = new URLSearchParams(init.body as string);
		expect(params.get('token')).toBe('r1');
		expect(params.get('client_id')).toBe('mlc_7vwiiiwkcdglzq4ggnsq');
	});
});

describe('連携できる環境', () => {
	it('Web は本番のオリジンだけ、デスクトップは常に可能', () => {
		expect(isConnectAvailable(false, WEB_ORIGIN)).toBe(true);
		expect(isConnectAvailable(false, 'http://localhost:5173')).toBe(false);
		expect(isConnectAvailable(false, 'https://preview.pages.dev')).toBe(false);
		expect(isConnectAvailable(true, 'http://localhost:5173')).toBe(true);
	});
});
