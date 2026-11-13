/**
 * Monolog. のリソース API クライアント(ベース https://api.monolog.life/v1)。
 * - 401 は 1 回だけトークンを更新して再試行する
 * - 429 は Retry-After 秒だけ待って再試行する(ユーザーの許可あたり毎分 120 リクエスト)
 * - POST には Idempotency-Key(UUID)を付け、通信エラーの再送は同じキーで行う(最大 3 回、指数バックオフ)
 * エラー形式は `{ "error": { "code", "message", "request_id" } }`(OAuth エンドポイントとは別の形)
 */
import { v4 as uuidv4 } from 'uuid';
import { API_BASE } from './config';
import { NetworkError } from './oauth';
import type { TokenManager } from './tokens';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		/** timer_already_running など。取れなければ空 */
		readonly code: string,
		message: string,
		readonly requestId?: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export interface TimerInfo {
	status: 'idle' | 'running';
	/** 実行中のときの開始時刻(ISO 8601)。不明なら null */
	startedAt: string | null;
	elapsedMs: number;
	tagName: string | null;
}

export interface RecordInput {
	startedAt: string;
	endedAt: string;
	durationMs: number;
	title: string;
	memo: string;
	tagName: string;
}

export interface MonologClientOptions {
	tokens: TokenManager;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	newKey?: () => string;
	baseUrl?: string;
}

const MAX_NETWORK_RETRIES = 3;
const MAX_RATE_LIMIT_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const MAX_RETRY_AFTER_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry-After(秒)をミリ秒にする。読めなければ 1 秒 */
function retryAfterMs(res: Response): number {
	const seconds = Number(res.headers.get('Retry-After'));
	if (!Number.isFinite(seconds) || seconds < 0) return 1000;
	return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

/** GET /timer と /timer/start のレスポンスを正規化する(フィールドの欠落に備える) */
export function normalizeTimer(json: unknown): TimerInfo {
	const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
	const tag = j.tag && typeof j.tag === 'object' ? (j.tag as Record<string, unknown>) : null;
	return {
		status: j.status === 'running' ? 'running' : 'idle',
		startedAt: str(j.started_at),
		elapsedMs: typeof j.elapsed_ms === 'number' ? j.elapsed_ms : 0,
		tagName: tag ? str(tag.name) : null
	};
}

export class MonologClient {
	private readonly tokens: TokenManager;
	private readonly fetchFn: typeof fetch;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly newKey: () => string;
	private readonly baseUrl: string;

	constructor(options: MonologClientOptions) {
		this.tokens = options.tokens;
		this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
		this.sleep = options.sleep ?? defaultSleep;
		this.newKey = options.newKey ?? uuidv4;
		this.baseUrl = options.baseUrl ?? API_BASE;
	}

	private async request(
		method: 'GET' | 'POST',
		path: string,
		options: { body?: Record<string, unknown>; idempotent?: boolean } = {}
	): Promise<unknown> {
		// 同じ要求の再送(通信エラー・401 後・429 後)は、すべて同じキーを使う
		const key = options.idempotent ? this.newKey() : undefined;
		let refreshed = false;
		let networkRetries = 0;
		let rateLimitRetries = 0;

		for (;;) {
			const token = await this.tokens.getAccessToken();
			const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
			if (options.body) headers['Content-Type'] = 'application/json';
			if (key) headers['Idempotency-Key'] = key;

			let res: Response;
			try {
				res = await this.fetchFn(`${this.baseUrl}${path}`, {
					method,
					headers,
					body: options.body ? JSON.stringify(options.body) : undefined
				});
			} catch (error) {
				// 読み取り、または Idempotency-Key 付きの要求だけ再送してよい(二重に記録されない)
				if ((method === 'GET' || key) && networkRetries < MAX_NETWORK_RETRIES) {
					await this.sleep(BACKOFF_BASE_MS * 2 ** networkRetries);
					networkRetries++;
					continue;
				}
				throw new NetworkError('Monolog. に接続できませんでした', { cause: error });
			}

			if (res.status === 401 && !refreshed) {
				refreshed = true;
				await this.tokens.forceRefresh(token);
				continue;
			}
			if (res.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
				rateLimitRetries++;
				await this.sleep(retryAfterMs(res));
				continue;
			}
			if (!res.ok) throw await this.readError(res);
			if (res.status === 204) return null;
			return await res.json().catch(() => null);
		}
	}

	private async readError(res: Response): Promise<ApiError> {
		let code = '';
		let message = '';
		let requestId: string | undefined;
		try {
			const json = (await res.json()) as { error?: Record<string, unknown> };
			const e = json?.error;
			if (e && typeof e === 'object') {
				code = str(e.code) ?? '';
				message = str(e.message) ?? '';
				requestId = str(e.request_id) ?? undefined;
			}
		} catch {
			// 本文が JSON でない場合は、ステータスだけで扱う
		}
		return new ApiError(res.status, code, message || `HTTP ${res.status}`, requestId);
	}

	/** 接続確認。time_zone などを含む */
	async getMe(): Promise<{ timeZone: string | null }> {
		const json = (await this.request('GET', '/me')) as Record<string, unknown> | null;
		return { timeZone: str(json?.time_zone) };
	}

	async getTimer(): Promise<TimerInfo> {
		return normalizeTimer(await this.request('GET', '/timer'));
	}

	/** 409 timer_already_running のときは ApiError(code) を投げる */
	async startTimer(tagName?: string): Promise<TimerInfo> {
		const body = tagName ? { tag: { name: tagName } } : undefined;
		return normalizeTimer(await this.request('POST', '/timer/start', { body, idempotent: true }));
	}

	/** 停止した時点で記録が保存される。タグは開始時のものを引き継ぐ */
	async stopTimer(input: { title: string; memo: string }): Promise<void> {
		await this.request('POST', '/timer/stop', { body: input, idempotent: true });
	}

	async createRecord(input: RecordInput): Promise<void> {
		await this.request('POST', '/records', {
			idempotent: true,
			body: {
				started_at: input.startedAt,
				ended_at: input.endedAt,
				duration_ms: input.durationMs,
				title: input.title,
				memo: input.memo,
				tag: { name: input.tagName }
			}
		});
	}

	/**
	 * ページを閉じる/隠れるとき用の送信。待てないので事前の確認・トークン更新・再送はできない。
	 * メモリ上のトークンをそのまま使い、結果は見ない。送れなかったときは false
	 */
	sendKeepalive(path: string, body: Record<string, unknown>): boolean {
		const token = this.tokens.peek()?.accessToken;
		if (!token) return false;
		try {
			void this.fetchFn(`${this.baseUrl}${path}`, {
				method: 'POST',
				keepalive: true,
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
					'Idempotency-Key': this.newKey()
				},
				body: JSON.stringify(body)
			}).catch(() => {});
			return true;
		} catch {
			return false;
		}
	}
}
