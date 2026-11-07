/**
 * 並べ替え(SortableList)の座標計算など、DOM に依存しない部分。
 */

export interface Point {
	x: number;
	y: number;
}

export interface Box {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

/**
 * ポインタの縦位置から、挿入位置(ドラッグ中の項目を除いた並びでの添字)を求める。
 * mids は、ドラッグ中の項目を除いた各項目の縦の中心。ポインタより上にある項目の数がそのまま挿入位置になる。
 */
export function insertionIndex(mids: readonly number[], pointerY: number): number {
	let index = 0;
	for (const mid of mids) if (mid < pointerY) index++;
	return index;
}

/**
 * 挿入位置の線の縦位置(画面座標)。
 * rects はドラッグ中の項目を除いた各項目の縦の範囲、gap は項目の間隔、listTop は一覧が空のときの基準。
 */
export function indicatorY(
	rects: readonly Pick<Box, 'top' | 'bottom'>[],
	index: number,
	gap: number,
	listTop: number
): number {
	if (rects.length === 0) return listTop;
	if (index <= 0) return rects[0].top - gap / 2;
	if (index >= rects.length) return rects[rects.length - 1].bottom + gap / 2;
	return (rects[index - 1].bottom + rects[index].top) / 2;
}

/**
 * 端に近づいたときの自動スクロール量(px/フレーム)。
 * 開始側の端では負、終了側の端では正、どちらにも近くなければ 0。端に近いほど速い。
 */
export function autoScrollDelta(
	pointer: number,
	start: number,
	end: number,
	edge = 56,
	maxSpeed = 18
): number {
	if (end - start <= 0) return 0;
	// 狭いコンテナでは、端の幅を半分までに抑える(両端が重ならないように)
	const zone = Math.min(edge, (end - start) / 2);
	const fromStart = pointer - start;
	const fromEnd = end - pointer;
	if (fromStart < zone)
		return -Math.round(maxSpeed * Math.min(1, (zone - fromStart) / zone) ** 2) || -1;
	if (fromEnd < zone) return Math.round(maxSpeed * Math.min(1, (zone - fromEnd) / zone) ** 2) || 1;
	return 0;
}

export interface ListBox<K = string> {
	key: K;
	rect: Box;
}

function contains(rect: Box, p: Point): boolean {
	return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
}

function distance(rect: Box, p: Point): number {
	const dx = p.x < rect.left ? rect.left - p.x : p.x > rect.right ? p.x - rect.right : 0;
	const dy = p.y < rect.top ? rect.top - p.y : p.y > rect.bottom ? p.y - rect.bottom : 0;
	return Math.hypot(dx, dy);
}

/**
 * ポインタの下にある一覧を選ぶ(複数の一覧の間をドラッグするとき)。
 * 1. ポインタを含む一覧 2. 横の範囲が合う一覧のうち縦に最も近いもの(列の見出しの上など)
 * 3. 近さが snap 以内の一覧。どれにも当たらなければ null。
 */
export function pickList<K>(
	lists: readonly ListBox<K>[],
	point: Point,
	snap = 48
): ListBox<K> | null {
	const inside = lists.find((l) => contains(l.rect, point));
	if (inside) return inside;
	const sameColumn = lists
		.filter((l) => point.x >= l.rect.left && point.x <= l.rect.right)
		.sort((a, b) => distance(a.rect, point) - distance(b.rect, point));
	if (sameColumn[0]) return sameColumn[0];
	const near = [...lists].sort((a, b) => distance(a.rect, point) - distance(b.rect, point))[0];
	return near && distance(near.rect, point) <= snap ? near : null;
}

/** index を delta 動かした位置(0〜count-1 に収める) */
export function clampIndex(index: number, delta: number, count: number): number {
	return Math.max(0, Math.min(count - 1, index + delta));
}

/**
 * キーボード操作中の仮の並び。ids のうち id を toIndex 番目へ動かした並びの、各 id の表示位置(CSS の order 用)。
 */
export function previewPositions(
	ids: readonly string[],
	id: string | null,
	toIndex: number
): Map<string, number> {
	const rest = ids.filter((x) => x !== id);
	if (id !== null && ids.includes(id)) {
		rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, id);
	}
	return new Map(rest.map((x, i) => [x, i]));
}

/** 画面読み上げ用の通知文 */
export function moveAnnouncement(title: string, index: number, count: number): string {
	return `${title}を ${index + 1} 番目に移動しました(全 ${count} 件)`;
}
