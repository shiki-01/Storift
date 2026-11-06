export type ReconcileAction = 'skip' | 'apply-remote' | 'push-local' | 'conflict';

interface Timestamped {
	updatedAt: number;
}

/**
 * ローカルとリモートの差異をどう扱うか判定する。
 *
 * base は「両端末が最後に一致していた版」の updatedAt。
 * - base 以降にローカルだけ変更 → ローカルをアップロード
 * - base 以降にリモートだけ変更 → リモートを取り込む
 * - 双方が base 以降に変更 → 競合
 * base が無い(未同期・旧データ)場合は競合とせず、新しい方を採用する。
 */
export function reconcile(
	local: Timestamped,
	remote: Timestamped,
	base: number | undefined
): ReconcileAction {
	if (local.updatedAt === remote.updatedAt) return 'skip';

	const newest = remote.updatedAt > local.updatedAt ? 'apply-remote' : 'push-local';
	if (base === undefined) return newest;

	const localChanged = local.updatedAt > base;
	const remoteChanged = remote.updatedAt > base;

	if (localChanged && remoteChanged) return 'conflict';
	if (remoteChanged) return 'apply-remote';
	if (localChanged) return 'push-local';
	return newest;
}

/**
 * 読み取り専用のプロジェクト(閲覧権限・アクセス権の失効)の突き合わせ。リモートが常に勝つ。
 * 版が同じで内容も同じなら何もしない。ローカルが書き換わっていた(混入した)場合は、リモートで上書きする。
 */
export function reconcileReadOnly(
	local: Timestamped,
	remote: Timestamped,
	sameContent: boolean
): Extract<ReconcileAction, 'skip' | 'apply-remote'> {
	return local.updatedAt === remote.updatedAt && sameContent ? 'skip' : 'apply-remote';
}

/**
 * CRDT(Yjs)が正となっているフィールド。本文(content)と、そこから導出される文字数。
 * CRDT 化したシーンでは、突き合わせでこれらを比較せず、リモートの値でローカルを上書きしない
 * (Y 文書を content で上書きして共同編集を壊さない / ミラー更新が競合を生まない)。
 */
export const CRDT_OWNED_KEYS: readonly string[] = ['content', 'characterCount'];

/** remote のうち owned のキーを local の値に置き換えたコピー(元は変更しない)。local に無いキーは取り除く */
export function adoptOwnedFields<T extends object>(
	local: T,
	remote: T,
	owned: readonly string[] = CRDT_OWNED_KEYS
): T {
	const next = { ...remote } as Record<string, unknown>;
	for (const key of owned) {
		if (key in local) next[key] = (local as Record<string, unknown>)[key];
		else delete next[key];
	}
	return next as T;
}

/**
 * CRDT 化したシーンの突き合わせ。remote は adoptOwnedFields 済みであること。
 * hasOtherDiff は「owned 以外のフィールドに差があるか」。
 * - 差が無い(差は本文のミラーだけ): 競合にしない。ローカルの版が新しければ送る、そうでなければ何もしない
 * - 差がある: 通常の 3 者比較
 */
export function reconcileOwned(
	local: Timestamped,
	remote: Timestamped,
	base: number | undefined,
	hasOtherDiff: boolean
): ReconcileAction {
	if (hasOtherDiff) return reconcile(local, remote, base);
	return local.updatedAt > remote.updatedAt ? 'push-local' : 'skip';
}
