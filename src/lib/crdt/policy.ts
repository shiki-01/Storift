import * as Y from 'yjs';

/**
 * CRDT 経路の判断ロジック(Firestore にも Dexie にも触れない純粋な関数)。
 */

/** 取得済みの updates 文書がこの件数以上なら、動作中に圧縮する */
export const COMPACT_THRESHOLD_ACTIVE = 50;
/** シーンを閉じる時は、この件数以上なら圧縮する */
export const COMPACT_THRESHOLD_CLOSE = 10;
/** 1 つの updates 文書に入れる更新のペイロード上限(Firestore の 1 文書 1MiB 未満に余裕を持たせる) */
export const MAX_UPDATE_BYTES = 500_000;
/** 結合済みの 1 件の更新がこれを超えたら送れない(1MiB からフィールド名などの余裕を引いた値) */
export const HARD_UPDATE_BYTES = 950_000;
/** snapshot の state がこれを超えたら書けない */
export const MAX_SNAPSHOT_BYTES = 950_000;
/** 購読の開始位置を lastSeen より巻き戻す幅。端末間の時計のずれで取りこぼさないため(重複して届いても更新は冪等) */
export const CLOCK_SKEW_MARGIN_MS = 5 * 60 * 1000;

export type CompactTrigger = 'active' | 'close';

/** 圧縮するか。appliedCount は「自分が適用済みで、まだ消していない updates 文書」の件数 */
export function shouldCompact(appliedCount: number, trigger: CompactTrigger): boolean {
	return appliedCount >= (trigger === 'close' ? COMPACT_THRESHOLD_CLOSE : COMPACT_THRESHOLD_ACTIVE);
}

/**
 * 圧縮で消してよい updates 文書の ID。自分が適用済みのものだけ。
 * existing はこの端末が知っている文書(適用済みかどうかを問わない)で、未適用のものは絶対に含めない。
 */
export function selectDeletableUpdates(
	applied: ReadonlySet<string>,
	existing: Iterable<string>
): string[] {
	const result: string[] = [];
	for (const id of existing) if (applied.has(id)) result.push(id);
	return result;
}

/**
 * 送信する更新を、1 文書あたり maxBytes 以下になるよう連続した更新ごとにまとめる。
 * 個々の更新は分割できない(Yjs の更新はバイト列では分割できない)ので、単独で maxBytes を超えるものはそのまま 1 件になる。
 */
export function groupUpdates(
	updates: readonly Uint8Array[],
	maxBytes: number = MAX_UPDATE_BYTES
): { update: Uint8Array; n: number }[] {
	const groups: { items: Uint8Array[]; size: number }[] = [];
	for (const u of updates) {
		const last = groups[groups.length - 1];
		// 結合後のサイズは各更新の合計以下になるので、合計で見積もれば超過しない
		if (last && last.size + u.length <= maxBytes) {
			last.items.push(u);
			last.size += u.length;
		} else {
			groups.push({ items: [u], size: u.length });
		}
	}
	return groups.map((g) => ({
		update: g.items.length === 1 ? g.items[0] : Y.mergeUpdates(g.items),
		n: g.items.length
	}));
}

/** 未送信の更新を 1 つにまとめる(無ければ null) */
export function mergePending(updates: readonly Uint8Array[]): Uint8Array | null {
	if (updates.length === 0) return null;
	return updates.length === 1 ? updates[0] : Y.mergeUpdates([...updates]);
}

/** 送信失敗後の再試行までの待ち時間(ms)。attempt は 1 から */
export function retryDelay(attempt: number): number {
	return Math.min(60_000, 3_000 * 2 ** Math.max(0, attempt - 1));
}

/** 購読の開始位置(createdAt の下限。この値より大きいものを取得する) */
export function listenSince(lastSeen: number): number {
	return Math.max(0, lastSeen - CLOCK_SKEW_MARGIN_MS);
}
