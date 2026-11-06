/**
 * 同期エラーの分類と、再試行(指数バックオフ)の状態管理
 */

export type SyncErrorKind = 'retryable' | 'fatal';

export interface ClassifiedError {
	kind: SyncErrorKind;
	/** 正規化したエラーコード(例: 'unavailable', 'permission-denied')。判別できなければ 'unknown' */
	code: string;
	message: string;
}

/** 再試行しても直らないエラー(権限・認証) */
const FATAL_CODES = new Set(['permission-denied', 'unauthenticated']);

/** 'firestore/unavailable' や 'auth/network-request-failed' のような接頭辞を取り除く */
function normalizeCode(code: string): string {
	const slash = code.lastIndexOf('/');
	return (slash >= 0 ? code.slice(slash + 1) : code).toLowerCase();
}

export function classifyError(error: unknown): ClassifiedError {
	const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
	const rawCode =
		typeof error === 'object' && error !== null && 'code' in error
			? (error as { code?: unknown }).code
			: undefined;

	if (typeof rawCode === 'string' && rawCode) {
		const code = normalizeCode(rawCode);
		return { kind: FATAL_CODES.has(code) ? 'fatal' : 'retryable', code, message };
	}

	// コードの無い通信エラー(fetch の失敗など)
	if (/failed to fetch|network|offline|load failed/i.test(message)) {
		return { kind: 'retryable', code: 'network-request-failed', message };
	}
	// 分類できないエラーは、永久に止まらないよう再試行可として扱う
	return { kind: 'retryable', code: 'unknown', message };
}

export const BACKOFF_BASE_MS = 5 * 1000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * 指数バックオフの待ち時間(ms)。attempt は 1 回目の失敗を 1 とする。
 * 5秒 → 10秒 → 20秒 ... 最大5分。±20% のジッタを付け、上限は超えない。
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
	const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
	const jitter = 0.8 + 0.4 * random();
	return Math.min(BACKOFF_MAX_MS, Math.round(exp * jitter));
}

/**
 * 再試行の可否を管理する。
 * - 再試行可の失敗: 次の実行可能時刻(nextAt)までは canRun が false(トリガが重複して走らない)
 * - 再試行不可の失敗: reset() されるまで canRun が false
 */
export class RetryGate {
	private attempt = 0;
	private nextAt = 0;
	private blocked = false;

	get isBlocked(): boolean {
		return this.blocked;
	}

	get failureCount(): number {
		return this.attempt;
	}

	canRun(now: number): boolean {
		return !this.blocked && now >= this.nextAt;
	}

	onSuccess(): void {
		this.reset();
	}

	/** 失敗を記録する。次回の再試行までの待ち時間(ms)を返す。再試行しない場合は null */
	onFailure(info: ClassifiedError, now: number, random: () => number = Math.random): number | null {
		if (info.kind === 'fatal') {
			this.blocked = true;
			return null;
		}
		this.attempt++;
		const delay = backoffDelay(this.attempt, random);
		this.nextAt = now + delay;
		return delay;
	}

	reset(): void {
		this.attempt = 0;
		this.nextAt = 0;
		this.blocked = false;
	}
}
