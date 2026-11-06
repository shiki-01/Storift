/**
 * CRDT(Yjs)文書のローカル永続化。シーン本文(共有プロジェクトのみ)を 1 シーン 1 行で持つ。
 * 行があることは「そのシーンの本文は CRDT が正」を意味する(reconcile は content を比較しない)。
 */
export interface CrdtDocRow {
	/** 主キー */
	sceneId: string;
	/** 文書が属する同期ターゲットのキー(共有が付け替わったときに別物として扱うため) */
	targetKey: string;
	/** 保存時点の Y 文書の全状態(encodeStateAsUpdate) */
	state: Uint8Array;
	/** 未送信の更新を Y.mergeUpdates で 1 つにまとめたもの。無ければ null */
	pending: Uint8Array | null;
	/** 取り込み済みの updates 文書の最大 createdAt */
	lastSeen: number;
	/** 取り込み済み(state に含まれる)の updates 文書 ID。圧縮で消してよい文書の判定に使う */
	appliedIds?: string[];
	/** 取り込み済みの crdt/snapshot の rev */
	snapshotRev?: number;
	updatedAt: number;
}
