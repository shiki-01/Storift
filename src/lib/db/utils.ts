import { db } from './schema';

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
export function createProjectTouchUpdates(projectId: string) {
	return {
		updatedAt: Date.now()
	};
}
