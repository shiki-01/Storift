import type { Table } from 'dexie';
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

/**
 * 並べ替えで必要な行だけを書く(order の更新と、必要なら同じ行の別項目の変更)。
 * 内容が変わらない行は書かない(isUnchanged)。書いた行の id を返す。
 * 履歴は残さない(並べ替えは内容の編集ではないため)。呼び出し元はこの id を queueChanges に渡す。
 */
export async function writeOrderChanges<
	T extends { id: string; projectId: string; _version: number }
>(
	table: Table<T, string>,
	projectId: string,
	changes: { id: string; changes: Partial<T> }[]
): Promise<string[]> {
	const written: string[] = [];
	await db.transaction('rw', [table, db.projects], async () => {
		for (const { id, changes: patch } of changes) {
			const row = await table.get(id);
			if (!row || isUnchanged(row, patch)) continue;
			await table.update(id, {
				...patch,
				updatedAt: Date.now(),
				_version: (row._version || 0) + 1
			} as never);
			written.push(id);
		}
		if (written.length) await touchProject(projectId);
	});
	return written;
}
