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
