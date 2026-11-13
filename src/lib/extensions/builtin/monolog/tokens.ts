/**
 * トークンの保存と更新。
 *
 * 保存先は端末内だけ(同期・バックアップ・エクスポートの対象外)。
 * - デスクトップ版: 既存の秘密情報保存(`$lib/ai/secrets`。macOS/Windows は OS のキーチェーン、
 *   それ以外は localStorage に平文)を再利用する
 * - Web 版: localStorage
 * リフレッシュトークンは更新のたびに新しくなり、使用済みのものは無効になる。
 * 同時に更新すると片方が invalid_grant になるので、更新は 1 つずつに直列化する
 * (同じタブ内は進行中の Promise を共有、複数タブ・ウィンドウ間は Web Locks API が使えれば navigator.locks)。
 */
import { OAuthError, refreshTokens, revokeToken, type TokenSet } from './oauth';

export interface TokenStorage {
	load(): Promise<TokenSet | null>;
	save(tokens: TokenSet): Promise<void>;
	clear(): Promise<void>;
}

/** 接続していない(トークンが無い) */
export class NotConnectedError extends Error {
	constructor() {
		super('Monolog. に接続していません');
		this.name = 'NotConnectedError';
	}
}

/** リフレッシュトークンが無効になった。接続をやり直す必要がある */
export class ReauthRequiredError extends Error {
	constructor() {
		super('Monolog. との接続が切れました。再接続してください');
		this.name = 'ReauthRequiredError';
	}
}

const SECRET_PROVIDER = 'monolog';
const SECRET_NAME = 'tokens';
const LOCAL_KEY = 'storift:monolog:tokens';
const REAUTH_FLAG_KEY = 'storift:monolog:needs-reconnect';

function parseStored(raw: string | null): TokenSet | null {
	if (!raw) return null;
	try {
		const t = JSON.parse(raw) as Partial<TokenSet>;
		if (typeof t.accessToken !== 'string' || typeof t.refreshToken !== 'string') return null;
		return {
			accessToken: t.accessToken,
			refreshToken: t.refreshToken,
			expiresAt: typeof t.expiresAt === 'number' ? t.expiresAt : 0,
			scope: typeof t.scope === 'string' ? t.scope : ''
		};
	} catch {
		return null;
	}
}

export function createTokenStorage(desktop: boolean): TokenStorage {
	if (desktop) {
		return {
			async load() {
				const { getSecret } = await import('$lib/ai/secrets');
				return parseStored(await getSecret(SECRET_PROVIDER, SECRET_NAME));
			},
			async save(tokens) {
				const { setSecret } = await import('$lib/ai/secrets');
				await setSecret(SECRET_PROVIDER, SECRET_NAME, JSON.stringify(tokens));
			},
			async clear() {
				const { deleteSecret } = await import('$lib/ai/secrets');
				await deleteSecret(SECRET_PROVIDER, SECRET_NAME);
			}
		};
	}
	return {
		async load() {
			try {
				return parseStored(localStorage.getItem(LOCAL_KEY));
			} catch {
				return null;
			}
		},
		async save(tokens) {
			localStorage.setItem(LOCAL_KEY, JSON.stringify(tokens));
		},
		async clear() {
			try {
				localStorage.removeItem(LOCAL_KEY);
			} catch {
				// 使えない環境では何もしない
			}
		}
	};
}

/** 「再接続が必要」の印。トークンを消した後も、再読み込みをまたいで表示するために残す */
export function readNeedsReauth(): boolean {
	try {
		return localStorage.getItem(REAUTH_FLAG_KEY) === '1';
	} catch {
		return false;
	}
}

export function setNeedsReauth(value: boolean): void {
	try {
		if (value) localStorage.setItem(REAUTH_FLAG_KEY, '1');
		else localStorage.removeItem(REAUTH_FLAG_KEY);
	} catch {
		// 使えない環境では何もしない
	}
}

type FetchFn = typeof fetch;

interface LockManagerLike {
	request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

const LOCK_NAME = 'storift-monolog-token-refresh';
/** 期限のこれだけ前から、期限切れとして更新する */
const EXPIRY_MARGIN_MS = 30_000;

export interface TokenManagerOptions {
	storage: TokenStorage;
	fetch?: FetchFn;
	/** Web Locks。省略時は navigator.locks(なければ直列化は同一タブ内のみ) */
	locks?: LockManagerLike | null;
	now?: () => number;
}

export class TokenManager {
	private tokens: TokenSet | null = null;
	private loaded = false;
	private inflight: Promise<TokenSet> | null = null;
	/** 再接続が必要になったときに呼ばれる(状態表示の更新用) */
	onReauthRequired: (() => void) | null = null;

	private readonly storage: TokenStorage;
	private readonly fetchFn: FetchFn;
	private readonly locks: LockManagerLike | null;
	private readonly now: () => number;

	constructor(options: TokenManagerOptions) {
		this.storage = options.storage;
		this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
		this.locks =
			options.locks !== undefined
				? options.locks
				: typeof navigator !== 'undefined' && 'locks' in navigator
					? (navigator.locks as unknown as LockManagerLike)
					: null;
		this.now = options.now ?? Date.now;
	}

	/** 保存済みのトークンを読み込む(最初の 1 回だけ保存先を読む) */
	async load(): Promise<TokenSet | null> {
		if (!this.loaded) {
			this.tokens = await this.storage.load();
			this.loaded = true;
		}
		return this.tokens;
	}

	/** 読み込み済みのトークン(同期)。pagehide など、待てない場面で使う */
	peek(): TokenSet | null {
		return this.tokens;
	}

	/** 認可コードの交換で得たトークンを保存する */
	async setTokens(tokens: TokenSet): Promise<void> {
		await this.storage.save(tokens);
		this.tokens = tokens;
		this.loaded = true;
		setNeedsReauth(false);
	}

	private expired(tokens: TokenSet, margin: number): boolean {
		return tokens.expiresAt > 0 && this.now() >= tokens.expiresAt - margin;
	}

	/** 有効なアクセストークン。期限が近ければ先に更新する */
	async getAccessToken(margin = EXPIRY_MARGIN_MS): Promise<string> {
		const tokens = await this.load();
		if (!tokens) throw readNeedsReauth() ? new ReauthRequiredError() : new NotConnectedError();
		if (this.expired(tokens, margin)) return (await this.refresh(undefined, margin)).accessToken;
		return tokens.accessToken;
	}

	/** 401 を受けたときの更新。stale は 401 を返したアクセストークン */
	async forceRefresh(stale: string): Promise<string> {
		return (await this.refresh(stale)).accessToken;
	}

	/** 期限に余裕があるか確かめ、近ければ更新する(pagehide の前に有効なトークンを用意しておくため) */
	async ensureFresh(margin: number): Promise<void> {
		await this.getAccessToken(margin);
	}

	private refresh(stale: string | undefined, margin = EXPIRY_MARGIN_MS): Promise<TokenSet> {
		// 同じタブでの同時更新は 1 回にまとめる
		if (this.inflight) return this.inflight;
		const run = () => this.doRefresh(stale, margin);
		const exclusive = this.locks ? this.locks.request(LOCK_NAME, run) : run();
		const p = exclusive.finally(() => {
			this.inflight = null;
		});
		this.inflight = p;
		return p;
	}

	private async doRefresh(stale: string | undefined, margin: number): Promise<TokenSet> {
		// 他のタブ・ウィンドウが先に更新していたら、その結果を使う(同じリフレッシュトークンを再利用しない)
		const stored = await this.storage.load();
		if (!stored) {
			this.tokens = null;
			throw readNeedsReauth() ? new ReauthRequiredError() : new NotConnectedError();
		}
		const alreadyRefreshed =
			stale !== undefined
				? stored.accessToken !== stale && !this.expired(stored, 0)
				: !this.expired(stored, margin);
		if (alreadyRefreshed) {
			this.tokens = stored;
			return stored;
		}

		let next: TokenSet;
		try {
			next = await refreshTokens(stored.refreshToken, this.fetchFn, this.now());
		} catch (error) {
			if (error instanceof OAuthError && error.code === 'invalid_grant') {
				// 失効・使用済み・期限切れ。接続情報を消して再接続を求める
				await this.clearLocal();
				setNeedsReauth(true);
				this.onReauthRequired?.();
				throw new ReauthRequiredError();
			}
			throw error;
		}
		// 新しい値を保存してから、古い値を捨てる(メモリ上も差し替える)
		this.tokens = next;
		try {
			await this.storage.save(next);
		} catch (error) {
			console.error('Monolog. のトークンを保存できませんでした:', error);
		}
		return next;
	}

	private async clearLocal(): Promise<void> {
		this.tokens = null;
		this.loaded = true;
		try {
			await this.storage.clear();
		} catch (error) {
			console.error('Monolog. のトークンを削除できませんでした:', error);
		}
	}

	/** 連携の解除。失効の要求が失敗しても、端末内のトークンは必ず消す */
	async disconnect(): Promise<{ revoked: boolean }> {
		let revoked = false;
		try {
			const tokens = await this.load();
			if (tokens) {
				await revokeToken(tokens.refreshToken, this.fetchFn);
				revoked = true;
			}
		} catch (error) {
			console.warn('Monolog. のトークンを失効できませんでした:', error);
		}
		await this.clearLocal();
		setNeedsReauth(false);
		return { revoked };
	}
}
