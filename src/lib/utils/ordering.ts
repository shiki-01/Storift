/**
 * 手動の並び順(order)の純粋なロジック。
 * プロット・人物・設定資料の並べ替えで共有する。
 *
 * - order は分数順序: 隣り合う 2 件の中間値を使うので、1 回の移動で書き換える行は 1 件だけ。
 *   複数端末の同期で updatedAt の競合を増やさない。
 * - order が無い既存データは createdAt(無ければ updatedAt、さらに id)の昇順に並べ、移行はしない。
 *   order の無い行は order のある行より前に置く(新しい項目は末尾に追加されるため)。
 * - 間隔が小さくなりすぎた、または order の無い行が混ざっているときだけ、グループ全体を振り直す。
 */

export interface Orderable {
	id: string;
	order?: number;
	createdAt?: number;
	updatedAt?: number;
}

/** 書き込むべき order の更新 */
export interface OrderUpdate {
	id: string;
	order: number;
}

/** 振り直すときの刻み */
export const REBALANCE_STEP = 1024;
/** これより隣との間隔が小さくなったら振り直す */
export const MIN_GAP = 1e-6;

function hasOrder(item: Orderable): item is Orderable & { order: number } {
	return typeof item.order === 'number' && Number.isFinite(item.order);
}

function compareId(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compare(a: Orderable, b: Orderable): number {
	const ao = hasOrder(a);
	const bo = hasOrder(b);
	if (ao !== bo) return ao ? 1 : -1;
	if (ao && bo && a.order !== b.order) return a.order! - b.order!;
	const at = a.createdAt ?? a.updatedAt ?? 0;
	const bt = b.createdAt ?? b.updatedAt ?? 0;
	return at - bt || compareId(a.id, b.id);
}

/** 手動順に並べた新しい配列(元の配列は変えない) */
export function sortByOrder<T extends Orderable>(items: readonly T[]): T[] {
	return [...items].sort(compare);
}

/** prev と next の間に入れる order(どちらも無ければ最初の 1 件) */
export function orderBetween(prev?: number, next?: number): number {
	if (prev === undefined && next === undefined) return REBALANCE_STEP;
	if (prev === undefined) return next! - 1;
	if (next === undefined) return prev + 1;
	return (prev + next) / 2;
}

/** 末尾に追加する項目の order */
export function nextOrder(items: readonly Orderable[]): number {
	let max: number | undefined;
	for (const item of items)
		if (hasOrder(item) && (max === undefined || item.order > max)) max = item.order;
	return max === undefined ? REBALANCE_STEP : max + REBALANCE_STEP;
}

/** order の無い行が混ざっている、または隣との間隔が MIN_GAP 未満(同じ値を含む)の行がある */
export function needsRebalance(items: readonly Orderable[]): boolean {
	const sorted = sortByOrder(items);
	for (let i = 0; i < sorted.length; i++) {
		if (!hasOrder(sorted[i])) return true;
		if (i > 0 && sorted[i].order! - sorted[i - 1].order! < MIN_GAP) return true;
	}
	return false;
}

/** 現在の並びのまま、1024 刻みで振り直す(値が変わる行だけ返す) */
export function rebalance(items: readonly Orderable[]): OrderUpdate[] {
	return assign(sortByOrder(items));
}

function assign(ordered: readonly Orderable[]): OrderUpdate[] {
	const updates: OrderUpdate[] = [];
	ordered.forEach((item, i) => {
		const order = (i + 1) * REBALANCE_STEP;
		if (!hasOrder(item) || item.order !== order) updates.push({ id: item.id, order });
	});
	return updates;
}

/**
 * グループ items の中で id を toIndex 番目(移動後の位置。0 始まり)に動かすために書く更新。
 * - id が items に無ければ、他のグループからの移動として挿入する。
 * - 位置が変わらなければ空配列。
 * - 通常は id の 1 件だけ。振り直しが必要なときだけ複数件。
 */
export function moveItem(items: readonly Orderable[], id: string, toIndex: number): OrderUpdate[] {
	const sorted = sortByOrder(items);
	const from = sorted.findIndex((item) => item.id === id);
	const rest = sorted.filter((item) => item.id !== id);
	const target = Math.max(0, Math.min(Math.trunc(toIndex), rest.length));
	if (from === target) return [];

	const prev = rest[target - 1];
	const next = rest[target];
	const moved = from >= 0 ? sorted[from] : ({ id } as Orderable);

	if (!needsRebalance(sorted)) {
		const order = orderBetween(prev?.order, next?.order);
		const gapOk =
			(prev === undefined || order - prev.order! >= MIN_GAP) &&
			(next === undefined || next.order! - order >= MIN_GAP);
		if (gapOk) return [{ id, order }];
	}
	return assign([...rest.slice(0, target), moved, ...rest.slice(target)]);
}
