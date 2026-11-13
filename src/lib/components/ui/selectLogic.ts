// Select.svelte の純粋な計算部分(位置決め・キー操作)

export interface SelectOption {
	value: string;
	label: string;
	/** 項目の下に出す補足説明 */
	description?: string;
	disabled?: boolean;
	/** 項目の文字に当てるインラインスタイル(例: `font-family: serif`)。省略時は何も付けない */
	style?: string;
}

/** 画面の端に残す余白(px) */
export const VIEWPORT_MARGIN = 8;
/** トリガーとポップアップの間隔(px) */
export const GAP = 4;

export interface Placement {
	side: 'up' | 'down';
	top: number;
	left: number;
	width: number;
	/** 空きに収まらないときの最大の高さ(超えた分はスクロール) */
	maxHeight: number;
}

interface Rect {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
}

/**
 * ポップアップを開く向きと位置を決める。
 * 下に収まれば下、収まらなければ空きが広い側。画面の外へ出ないように横位置と高さも抑える。
 * @param contentHeight ポップアップの本来の高さ(スクロールしない場合)
 * @param minWidth 項目の文言が収まる最小幅(トリガーが狭いときに広げる)
 */
export function computePlacement(
	trigger: Rect,
	contentHeight: number,
	viewport: { width: number; height: number },
	minWidth = 0
): Placement {
	const below = viewport.height - trigger.bottom - GAP - VIEWPORT_MARGIN;
	const above = trigger.top - GAP - VIEWPORT_MARGIN;
	const side: 'up' | 'down' = contentHeight <= below || below >= above ? 'down' : 'up';
	const room = Math.max(0, side === 'down' ? below : above);
	const height = Math.min(contentHeight, room);

	const maxWidth = Math.max(0, viewport.width - VIEWPORT_MARGIN * 2);
	const width = Math.min(Math.max(trigger.width, minWidth), maxWidth);
	const left = Math.min(
		Math.max(VIEWPORT_MARGIN, trigger.left),
		Math.max(VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - width)
	);
	const top = side === 'down' ? trigger.bottom + GAP : trigger.top - GAP - height;
	return { side, top, left, width, maxHeight: room };
}

/** from から direction 方向に、選べる(disabled でない)次の項目の位置。なければ -1 */
export function stepEnabled(options: SelectOption[], from: number, direction: 1 | -1): number {
	for (let i = from + direction; i >= 0 && i < options.length; i += direction) {
		if (!options[i].disabled) return i;
	}
	return -1;
}

export function firstEnabled(options: SelectOption[]): number {
	return stepEnabled(options, -1, 1);
}

export function lastEnabled(options: SelectOption[]): number {
	return stepEnabled(options, options.length, -1);
}

/**
 * 文字入力による先頭一致ジャンプ。選べる項目の中から、ラベルが buffer で始まるものを探す。
 * 同じ文字を繰り返したとき(buffer が 1 種類の文字だけ)は、現在位置の次の同じ頭文字へ進む。
 * @returns 見つかった位置。なければ -1
 */
export function findTypeahead(options: SelectOption[], buffer: string, current: number): number {
	if (!buffer) return -1;
	const query = buffer.toLowerCase();
	const repeated = query.length > 1 && [...query].every((c) => c === query[0]);
	const needle = repeated ? query[0] : query;
	// 繰り返しのときは現在位置の次から、そうでなければ現在位置から探し始める
	const start = repeated ? current + 1 : Math.max(current, 0);
	for (let k = 0; k < options.length; k++) {
		const i = (start + k) % options.length;
		const o = options[i];
		if (!o.disabled && o.label.toLowerCase().startsWith(needle)) return i;
	}
	return -1;
}
