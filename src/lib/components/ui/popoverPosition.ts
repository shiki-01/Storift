/**
 * Popover の位置計算(DOM に依存しない純関数)。
 * 起点の下に開き、収まらず上の方が広ければ上に反転する。画面の外へ出ないよう、横位置と高さを補正する。
 */

export interface PopoverRect {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

export interface PopoverPlacement {
	side: 'up' | 'down';
	top: number;
	left: number;
	/** 空きに収まらないときの最大の高さ(超えた分はスクロール) */
	maxHeight: number;
}

/** 起点とポップオーバーの隙間(px) */
export const POPOVER_GAP = 6;
/** 画面端に確保する余白(px) */
export const POPOVER_MARGIN = 8;

/**
 * @param trigger 起点要素の矩形(ビューポート座標)
 * @param content ポップオーバーの本来の大きさ(スクロールしない場合)
 * @param align 'end' は起点の右端に右端をそろえ、'start' は左端をそろえる
 */
export function computePopoverPosition(
	trigger: PopoverRect,
	content: { width: number; height: number },
	viewport: { width: number; height: number },
	align: 'start' | 'end' = 'end'
): PopoverPlacement {
	const below = viewport.height - trigger.bottom - POPOVER_GAP - POPOVER_MARGIN;
	const above = trigger.top - POPOVER_GAP - POPOVER_MARGIN;
	const side: 'up' | 'down' = content.height <= below || below >= above ? 'down' : 'up';
	const room = Math.max(0, side === 'down' ? below : above);
	const height = Math.min(content.height, room);

	const maxLeft = Math.max(POPOVER_MARGIN, viewport.width - POPOVER_MARGIN - content.width);
	const wanted = align === 'end' ? trigger.right - content.width : trigger.left;
	const left = Math.min(Math.max(POPOVER_MARGIN, wanted), maxLeft);
	const top = side === 'down' ? trigger.bottom + POPOVER_GAP : trigger.top - POPOVER_GAP - height;
	return { side, top, left, maxHeight: room };
}
