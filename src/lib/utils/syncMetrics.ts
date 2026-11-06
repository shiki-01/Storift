/**
 * 同期処理の計測。直近の記録をメモリに保持し、console にも出す(設定画面の「同期診断」で表示する)
 */
export type SyncMetricKind =
	| 'processPendingChanges'
	| 'download'
	| 'applyRealtime'
	/** 内容が同一の競合を自動で解決した(label に種類と理由)。durationMs は 0 */
	| 'conflictAutoResolved';

export interface SyncMetric {
	kind: SyncMetricKind;
	/** 補足(エンティティ種別など) */
	label?: string;
	/** 所要時間(ms) */
	durationMs: number;
	/** 処理した件数(差分取得では取得した件数) */
	count: number;
	/** 差分取得で取得せずに済んだ(スキップした)件数 */
	skipped?: number;
	ok: boolean;
	/** 記録時刻(epoch ms) */
	at: number;
}

const MAX_ENTRIES = 50;
let entries: SyncMetric[] = [];

export function recordSyncMetric(metric: Omit<SyncMetric, 'at'>): void {
	entries.push({ ...metric, at: Date.now() });
	if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
	console.log(
		`⏱️ [sync-metrics] ${metric.kind}${metric.label ? `(${metric.label})` : ''}: ` +
			`${Math.round(metric.durationMs)}ms, ${metric.count} item(s), ${metric.ok ? 'ok' : 'failed'}`
	);
}

/** 直近の記録(新しい順) */
export function getSyncMetrics(): SyncMetric[] {
	return [...entries].reverse();
}

export function clearSyncMetrics(): void {
	entries = [];
}

/**
 * 処理の所要時間を計って記録する。count は処理後に決まる場合があるため関数で受け取る。
 */
export async function measureSync<T>(
	kind: SyncMetricKind,
	label: string | undefined,
	fn: () => Promise<T>,
	count: (result: T | undefined) => number
): Promise<T> {
	const start = performance.now();
	let result: T | undefined;
	let ok = false;
	try {
		result = await fn();
		ok = true;
		return result;
	} finally {
		recordSyncMetric({
			kind,
			label,
			durationMs: performance.now() - start,
			count: count(result),
			ok
		});
	}
}
