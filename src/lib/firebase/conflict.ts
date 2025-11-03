export interface ConflictResolution<T> {
	resolution: 'local' | 'remote' | 'merge';
	resolvedData?: T;
}

/**
 * 競合検出
 */
export function detectConflict<T extends { _version: number; updatedAt: number }>(
	local: T,
	remote: T
): boolean {
	// バージョンが異なり、両方がlastSyncedAt以降に更新されている場合は競合
	return local._version !== remote._version && local.updatedAt !== remote.updatedAt;
}

/**
 * 自動競合解決（Last Write Wins）
 */
export function autoResolveConflict<T extends { updatedAt: number }>(
	local: T,
	remote: T
): ConflictResolution<T> {
	// より新しいタイムスタンプを持つ方を採用
	if (local.updatedAt > remote.updatedAt) {
		return { resolution: 'local', resolvedData: local };
	} else {
		return { resolution: 'remote', resolvedData: remote };
	}
}

/**
 * シーンの内容をマージ（簡易実装）
 */
export function mergeSceneContent(localContent: string, remoteContent: string): string {
	// 簡易的な実装: より長い方を採用
	// 実際の実装では、差分マージアルゴリズムを使用すべき
	return localContent.length >= remoteContent.length ? localContent : remoteContent;
}

/**
 * 手動競合解決用のデータ準備
 */
export interface ConflictData<T> {
	local: T;
	remote: T;
	conflictFields: string[];
}

export function prepareConflictData<T extends Record<string, unknown>>(
	local: T,
	remote: T
): ConflictData<T> {
	const conflictFields: string[] = [];

	for (const key in local) {
		if (key.startsWith('_')) continue; // メタデータは除外
		if (JSON.stringify(local[key]) !== JSON.stringify(remote[key])) {
			conflictFields.push(key);
		}
	}

	return {
		local,
		remote,
		conflictFields
	};
}
