/**
 * 本文上の範囲。start / end は本文(プレーンテキスト)の文字オフセット [start, end)。
 * quote は選択文字列の先頭 200 文字で、本文が編集されて位置がずれたときに近傍を探す手がかりにする。
 */
export interface MemoAnchor {
	start: number;
	end: number;
	quote: string;
}

/**
 * 作品ごとのメモ。端末ごとに IndexedDB へ保存する(同期対象外)。
 */
export interface Memo {
	id: string;
	projectId: string;
	text: string;
	tags: string[];
	/** 関連するシーン(範囲メモでは必須、それ以外は作成時に開いていたシーン) */
	sceneId?: string;
	anchor?: MemoAnchor;
	done: boolean;
	/** Claude に依頼した日時 */
	requestedAt?: number;
	createdAt: number;
	updatedAt: number;
}

/** 本文の選択から作る、新規メモの範囲 */
export interface MemoDraft {
	sceneId: string;
	anchor: MemoAnchor;
}
