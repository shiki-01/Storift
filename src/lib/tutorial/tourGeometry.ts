/**
 * ツアーの位置計算(純関数)。DOM に依存しないので、テストで挙動を固定できる。
 * 座標はすべてビューポート基準(getBoundingClientRect と同じ)。
 */

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

export type Placement = 'auto' | 'top' | 'bottom' | 'left' | 'right';

/** カードが target のどの側にあるか。target が無いときは 'center' */
export type Side = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface CardPosition {
	x: number;
	y: number;
	side: Side;
}

type EdgeSide = Exclude<Side, 'center'>;

const OPPOSITE: Record<EdgeSide, EdgeSide> = {
	top: 'bottom',
	bottom: 'top',
	left: 'right',
	right: 'left'
};

/** placement の優先順。'auto' は下・上・右・左の順に試す */
function candidateOrder(placement: Placement): Side[] {
	if (placement === 'auto') return ['bottom', 'top', 'right', 'left', 'center'];
	// 反対側の後に、placement と直交する軸の両側を試す(左右配置なら上下へ逃がす)
	const perpendicular: EdgeSide[] =
		placement === 'top' || placement === 'bottom' ? ['right', 'left'] : ['bottom', 'top'];
	return [placement, OPPOSITE[placement], ...perpendicular, 'center'];
}

function clampAxis(value: number, size: number, total: number, margin: number): number {
	const max = Math.max(margin, total - size - margin);
	return Math.min(Math.max(value, margin), max);
}

/** target の周囲に card を置いたときの左上座標(クランプ前) */
function rawPosition(
	side: EdgeSide,
	target: Rect,
	card: Size,
	gap: number
): { x: number; y: number } {
	const centerX = target.x + target.width / 2 - card.width / 2;
	const centerY = target.y + target.height / 2 - card.height / 2;
	switch (side) {
		case 'top':
			return { x: centerX, y: target.y - gap - card.height };
		case 'bottom':
			return { x: centerX, y: target.y + target.height + gap };
		case 'left':
			return { x: target.x - gap - card.width, y: centerY };
		case 'right':
			return { x: target.x + target.width + gap, y: centerY };
	}
}

/** 進行方向(main axis)の端が画面内に収まるか。直交方向は後でクランプする */
function fitsMainAxis(
	side: EdgeSide,
	pos: { x: number; y: number },
	card: Size,
	viewport: Size,
	margin: number
): boolean {
	switch (side) {
		case 'top':
			return pos.y >= margin;
		case 'bottom':
			return pos.y + card.height <= viewport.height - margin;
		case 'left':
			return pos.x >= margin;
		case 'right':
			return pos.x + card.width <= viewport.width - margin;
	}
}

function overlaps(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function rectOf(pos: { x: number; y: number }, card: Size): Rect {
	return { x: pos.x, y: pos.y, width: card.width, height: card.height };
}

/** target が無いときは画面中央 */
function centered(card: Size, viewport: Size, margin: number): CardPosition {
	return {
		x: clampAxis((viewport.width - card.width) / 2, card.width, viewport.width, margin),
		y: clampAxis((viewport.height - card.height) / 2, card.height, viewport.height, margin),
		side: 'center'
	};
}

/** 各側で target から見て空いている幅(main axis)。最後の手段で最も広い側を選ぶのに使う */
function roomOn(side: EdgeSide, target: Rect, viewport: Size): number {
	switch (side) {
		case 'top':
			return target.y;
		case 'bottom':
			return viewport.height - (target.y + target.height);
		case 'left':
			return target.x;
		case 'right':
			return viewport.width - (target.x + target.width);
	}
}

/**
 * カードの位置を決める。
 * 1. placement を最優先に、入らなければ反対側 → 直交する両側 → 画面中央 の順に試す。
 *    「入る」は main axis が画面内に収まり、かつ target と重ならないこと。
 * 2. どれも入らなければ、target の周囲で最も空いている側に置く(クランプはする)。
 * 3. 最後に、直交方向も含めて margin の余白内にクランプする。
 *
 * target が null のときは画面中央に置く。
 */
export function placeCard(
	target: Rect | null,
	card: Size,
	viewport: Size,
	placement: Placement = 'auto',
	margin = 12,
	gap = 14
): CardPosition {
	if (!target) return centered(card, viewport, margin);

	for (const side of candidateOrder(placement)) {
		if (side === 'center') {
			const pos = centered(card, viewport, margin);
			if (!overlaps(rectOf(pos, card), target)) return pos;
			continue;
		}

		const raw = rawPosition(side, target, card, gap);
		if (!fitsMainAxis(side, raw, card, viewport, margin)) continue;

		const pos = {
			x: clampAxis(raw.x, card.width, viewport.width, margin),
			y: clampAxis(raw.y, card.height, viewport.height, margin),
			side
		};
		if (!overlaps(rectOf(pos, card), target)) return pos;
	}

	// どの候補も入らないときは、空いている側へ寄せる(target を覆うのは避けられない)
	const edgeSides: EdgeSide[] = ['bottom', 'top', 'right', 'left'];
	const best = edgeSides.reduce((a, b) =>
		roomOn(b, target, viewport) > roomOn(a, target, viewport) ? b : a
	);
	const raw = rawPosition(best, target, card, gap);
	return {
		x: clampAxis(raw.x, card.width, viewport.width, margin),
		y: clampAxis(raw.y, card.height, viewport.height, margin),
		side: best
	};
}

/** 余白(padding)を付けた切り抜き矩形。画面外にはみ出た分は画面内に切り詰める */
export function cutoutRect(rect: Rect, padding: number, viewport: Size): Rect {
	const x0 = Math.max(0, rect.x - padding);
	const y0 = Math.max(0, rect.y - padding);
	const x1 = Math.min(viewport.width, rect.x + rect.width + padding);
	const y1 = Math.min(viewport.height, rect.y + rect.height + padding);
	return {
		x: x0,
		y: y0,
		width: Math.max(0, x1 - x0),
		height: Math.max(0, y1 - y0)
	};
}

/**
 * 画面から穴(hole)を除いた部分を、上・下・左・右の 4 枚の矩形に分ける。
 * 穴が画面外にはみ出していれば画面内に切り詰めてから分割する。
 * 幅や高さが 0 になる矩形も、位置を変えずに返す(描画側で扱いやすくするため)。
 */
export function blockerRects(hole: Rect, viewport: Size): Rect[] {
	const hx0 = Math.min(Math.max(hole.x, 0), viewport.width);
	const hx1 = Math.min(Math.max(hole.x + hole.width, hx0), viewport.width);
	const hy0 = Math.min(Math.max(hole.y, 0), viewport.height);
	const hy1 = Math.min(Math.max(hole.y + hole.height, hy0), viewport.height);

	return [
		{ x: 0, y: 0, width: viewport.width, height: hy0 },
		{ x: 0, y: hy1, width: viewport.width, height: viewport.height - hy1 },
		{ x: 0, y: hy0, width: hx0, height: hy1 - hy0 },
		{ x: hx1, y: hy0, width: viewport.width - hx1, height: hy1 - hy0 }
	];
}
