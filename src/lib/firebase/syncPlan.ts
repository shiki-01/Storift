import type { EntityType } from './sync';

/**
 * ダウンロード(取得)の計画を決める純粋なロジック。
 * 差分取得か完全取得かの判定と、「リモートに無い＝削除」の判定を許すかどうかをここに集約する。
 */

export type DownloadTrigger = 'startup' | 'periodic' | 'manual-full';
export type DownloadMode = 'full' | 'diff';

export interface TypePlan {
	mode: DownloadMode;
	/** 差分取得のとき、この updatedAt より新しいものだけを取得する */
	since?: number;
}

/** 起動時に完全取得へ切り替える、前回の完全同期からの経過時間 */
export const FULL_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 端末間の時計のずれや取得中の更新を吸収する安全マージン */
export const DIFF_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export interface DownloadPlanInput {
	now: number;
	trigger: DownloadTrigger;
	types: readonly EntityType[];
	lastFullSyncAt: number | undefined;
	lastSyncTimes: Partial<Record<EntityType, number>>;
	/** 型ごとのローカル件数(0件のときは差分の基準が信用できないので完全取得にする) */
	localCounts: Partial<Record<EntityType, number>>;
}

export function planDownload(input: DownloadPlanInput): Record<EntityType, TypePlan> {
	const { now, trigger, types, lastFullSyncAt, lastSyncTimes, localCounts } = input;

	const forceFull =
		trigger === 'manual-full' ||
		(trigger === 'startup' &&
			(lastFullSyncAt === undefined || now - lastFullSyncAt >= FULL_SYNC_INTERVAL_MS));

	const plan = {} as Record<EntityType, TypePlan>;
	for (const type of types) {
		const last = lastSyncTimes[type];
		if (forceFull || last === undefined || last <= 0 || (localCounts[type] ?? 0) === 0) {
			plan[type] = { mode: 'full' };
		} else {
			plan[type] = { mode: 'diff', since: Math.max(1, last - DIFF_SAFETY_MARGIN_MS) };
		}
	}
	return plan;
}

/** 取得結果が「リモートの全件」であると言えるか。リモートに無い＝削除と判定してよいのは完全取得のときだけ */
export function canDetectRemoteDeletion(plan: TypePlan): boolean {
	return plan.mode === 'full';
}

/**
 * リモートの一覧に無いローカルのデータを分類する。
 * - removals: 同期済み(base あり)だったもの → 他端末で削除された
 * - uploads: 未同期(base なし)のもの → 未アップロードなので送る
 * 差分取得では「リモートに無い」ことが何も意味しないので、常に空を返す。
 */
export function classifyLocalOnly(
	plan: TypePlan,
	localIds: Iterable<string>,
	remoteIds: ReadonlySet<string>,
	isPending: (id: string) => boolean,
	hasBase: (id: string) => boolean
): { removals: string[]; uploads: string[] } {
	const removals: string[] = [];
	const uploads: string[] = [];
	if (!canDetectRemoteDeletion(plan)) return { removals, uploads };

	for (const id of localIds) {
		if (remoteIds.has(id) || isPending(id)) continue;
		(hasBase(id) ? removals : uploads).push(id);
	}
	return { removals, uploads };
}

/** Firestore の WriteBatch の上限(500件)と、リクエストサイズの安全側の上限 */
export const BATCH_MAX_OPS = 500;
export const BATCH_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 書き込みを、件数とおおよそのサイズが上限に収まるバッチに分ける(順序は保つ)。
 * 1件で上限を超えるものは単独のバッチにする。
 */
export function chunkBatches<T extends { size: number }>(
	items: readonly T[],
	maxOps = BATCH_MAX_OPS,
	maxBytes = BATCH_MAX_BYTES
): T[][] {
	const batches: T[][] = [];
	let current: T[] = [];
	let bytes = 0;
	for (const item of items) {
		if (current.length > 0 && (current.length >= maxOps || bytes + item.size > maxBytes)) {
			batches.push(current);
			current = [];
			bytes = 0;
		}
		current.push(item);
		bytes += item.size;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}
