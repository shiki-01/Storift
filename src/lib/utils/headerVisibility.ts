/**
 * スマホの上部バーを、スクロール方向で出す/隠すための判定(純粋関数)。
 * 1 回のスクロールイベントの移動量は小さいので、同じ向きの移動量を積算し、
 * しきい値を超えたときだけ切り替える(ヒステリシス)。
 */
export interface HeaderVisibilityState {
	/** バーが見えているか */
	visible: boolean;
	/** 同じ向きに動いた積算量(下向きが正、上向きが負。向きが変わると 0 から数え直す) */
	travel: number;
}

export interface HeaderVisibilityOptions {
	/** 下向きにこれ以上動いたら隠す(px) */
	hideThreshold: number;
	/** 上向きにこれ以上動いたら出す(px) */
	showThreshold: number;
	/** この位置以下(最上部付近)では常に表示する(px) */
	topOffset: number;
}

export const DEFAULT_HEADER_OPTIONS: HeaderVisibilityOptions = {
	hideThreshold: 24,
	showThreshold: 12,
	topOffset: 0
};

export const INITIAL_HEADER_STATE: HeaderVisibilityState = { visible: true, travel: 0 };

export function computeHeaderVisibility(
	prevY: number,
	nextY: number,
	current: HeaderVisibilityState,
	options: HeaderVisibilityOptions = DEFAULT_HEADER_OPTIONS
): HeaderVisibilityState {
	// 最上部では常に表示(バウンスで負の値になる場合も含む)
	if (nextY <= options.topOffset) return { visible: true, travel: 0 };

	const delta = nextY - prevY;
	if (delta === 0) return current;

	// 向きが変わったら積算をやり直す
	const sameDirection = current.travel === 0 || Math.sign(current.travel) === Math.sign(delta);
	const travel = (sameDirection ? current.travel : 0) + delta;

	if (travel >= options.hideThreshold) return { visible: false, travel };
	if (travel <= -options.showThreshold) return { visible: true, travel };
	return { visible: current.visible, travel };
}
