import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenSet } from './oauth';
import {
	NotConnectedError,
	ReauthRequiredError,
	TokenManager,
	createTokenStorage,
	readNeedsReauth,
	type TokenStorage
} from './tokens';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function memoryStorage(initial: TokenSet | null): TokenStorage & { value: TokenSet | null } {
	const s = {
		value: initial,
		load: vi.fn(async () => s.value),
		save: vi.fn(async (t: TokenSet) => {
			s.value = t;
		}),
		clear: vi.fn(async () => {
			s.value = null;
		})
	};
	return s;
}

const tokens = (over: Partial<TokenSet> = {}): TokenSet => ({
	accessToken: 'a1',
	refreshToken: 'r1',
	expiresAt: 0,
	scope: 'records:write timer',
	...over
});

/** 同じ名前のロックを 1 つずつ実行する、簡易の Web Locks */
function fakeLocks() {
	let tail: Promise<unknown> = Promise.resolve();
	return {
		request<T>(_name: string, cb: () => Promise<T>): Promise<T> {
			const run = tail.then(cb, cb);
			tail = run.catch(() => {});
			return run;
		}
	};
}

beforeEach(() => localStorage.clear());

describe('TokenManager', () => {
	it('保存が無ければ NotConnectedError、再接続が必要な印があれば ReauthRequiredError', async () => {
		const m = new TokenManager({ storage: memoryStorage(null), locks: null });
		await expect(m.getAccessToken()).rejects.toBeInstanceOf(NotConnectedError);
		localStorage.setItem('storift:monolog:needs-reconnect', '1');
		await expect(m.getAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
	});

	it('期限が近ければ更新し、新しい値を保存する(リフレッシュトークンはローテーション)', async () => {
		const storage = memoryStorage(tokens({ expiresAt: 1_000 }));
		const fetchFn = vi.fn(async () =>
			json({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 })
		);
		const m = new TokenManager({
			storage,
			fetch: fetchFn as unknown as typeof fetch,
			locks: null,
			now: () => 2_000
		});
		expect(await m.getAccessToken()).toBe('a2');
		expect(storage.value?.refreshToken).toBe('r2');
		expect(m.peek()?.accessToken).toBe('a2');
		const body = new URLSearchParams(
			(fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		);
		expect(body.get('refresh_token')).toBe('r1');
	});

	it('同時の更新は 1 回にまとめる(使用済みリフレッシュトークンを再送しない)', async () => {
		const storage = memoryStorage(tokens());
		const fetchFn = vi.fn(async () => json({ access_token: 'a2', refresh_token: 'r2' }));
		const m = new TokenManager({ storage, fetch: fetchFn as unknown as typeof fetch, locks: null });
		await m.load();
		const results = await Promise.all([
			m.forceRefresh('a1'),
			m.forceRefresh('a1'),
			m.forceRefresh('a1')
		]);
		expect(results).toEqual(['a2', 'a2', 'a2']);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('別のタブが先に更新していたら(Web Locks で直列化され)、その結果を使って更新しない', async () => {
		const storage = memoryStorage(tokens());
		const locks = fakeLocks();
		const fetchFn = vi.fn(async () => json({ access_token: 'a2', refresh_token: 'r2' }));
		const tabA = new TokenManager({ storage, fetch: fetchFn as unknown as typeof fetch, locks });
		const tabB = new TokenManager({ storage, fetch: fetchFn as unknown as typeof fetch, locks });
		await Promise.all([tabA.load(), tabB.load()]);
		const [a, b] = await Promise.all([tabA.forceRefresh('a1'), tabB.forceRefresh('a1')]);
		expect([a, b]).toEqual(['a2', 'a2']);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('invalid_grant: 接続情報を消し、再接続が必要な状態にする', async () => {
		const storage = memoryStorage(tokens());
		const fetchFn = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
		const m = new TokenManager({ storage, fetch: fetchFn as unknown as typeof fetch, locks: null });
		const onReauth = vi.fn();
		m.onReauthRequired = onReauth;
		await m.load();
		await expect(m.forceRefresh('a1')).rejects.toBeInstanceOf(ReauthRequiredError);
		expect(storage.value).toBeNull();
		expect(m.peek()).toBeNull();
		expect(readNeedsReauth()).toBe(true);
		expect(onReauth).toHaveBeenCalled();
	});

	it('invalid_grant 以外の更新の失敗では接続情報を消さない', async () => {
		const storage = memoryStorage(tokens());
		const fetchFn = vi.fn(async () => json({ error: 'server_error' }, 500));
		const m = new TokenManager({ storage, fetch: fetchFn as unknown as typeof fetch, locks: null });
		await m.load();
		await expect(m.forceRefresh('a1')).rejects.toMatchObject({ code: 'server_error' });
		expect(storage.value).not.toBeNull();
	});

	it('連携の解除: 失効に失敗しても、端末内のトークンは必ず消す', async () => {
		const storage = memoryStorage(tokens());
		const fetchFn = vi.fn(async () => {
			throw new TypeError('offline');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const m = new TokenManager({ storage, fetch: fetchFn as unknown as typeof fetch, locks: null });
		const result = await m.disconnect();
		expect(result.revoked).toBe(false);
		expect(storage.value).toBeNull();
		warn.mockRestore();
	});

	it('連携の解除: 成功なら /oauth/revoke にリフレッシュトークンを送る', async () => {
		const storage = memoryStorage(tokens());
		const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
		const m = new TokenManager({ storage, fetch: fetchFn as unknown as typeof fetch, locks: null });
		expect((await m.disconnect()).revoked).toBe(true);
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toContain('/oauth/revoke');
		expect(new URLSearchParams(init.body as string).get('token')).toBe('r1');
	});
});

describe('Web 版のトークン保存', () => {
	it('localStorage に保存して読み戻せ、消せる', async () => {
		const storage = createTokenStorage(false);
		expect(await storage.load()).toBeNull();
		await storage.save(tokens());
		expect(await storage.load()).toEqual(tokens());
		await storage.clear();
		expect(await storage.load()).toBeNull();
	});

	it('壊れた値は未接続として扱う', async () => {
		localStorage.setItem('storift:monolog:tokens', '{"accessToken":1}');
		expect(await createTokenStorage(false).load()).toBeNull();
	});
});
