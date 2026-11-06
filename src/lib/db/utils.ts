import { db } from './schema';

/**
 * changes を current に適用しても何も変わらないか(各キーを JSON 表現で比べる)。
 * 変わらない更新で updatedAt / _version を進めると、他端末との不要な競合や再送信の原因になる。
 * current が無い(対象が存在しない)場合は false。
 */
export function isUnchanged<T extends object>(
	current: T | undefined,
	changes: Partial<T>
): boolean {
	if (!current) return false;
	const record = current as Record<string, unknown>;
	return Object.entries(changes).every(
		([key, value]) => JSON.stringify(record[key]) === JSON.stringify(value)
	);
}

/**
 * プロジェクトのupdatedAtを更新し、バージョンを増やす
 */
export async function touchProject(projectId: string): Promise<void> {
	const project = await db.projects.get(projectId);
	if (project) {
		await db.projects.update(projectId, {
			updatedAt: Date.now(),
			_version: (project._version || 0) + 1
		});
	}
}

/**
 * チャプターのupdatedAtを更新し、関連プロジェクトも更新する
 */
export async function touchChapter(chapterId: string): Promise<void> {
	const chapter = await db.chapters.get(chapterId);
	if (chapter) {
		await db.chapters.update(chapterId, {
			updatedAt: Date.now(),
			_version: (chapter._version || 0) + 1
		});
		await touchProject(chapter.projectId);
	}
}

/**
 * トランザクション内で使用するプロジェクト更新の準備
 */
export function createProjectTouchUpdates() {
	return {
		updatedAt: Date.now()
	};
}
