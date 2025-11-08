import { db } from './schema';
import type { Chapter, ChapterCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { touchProject } from './utils';
import { historyDB } from './history';

export const chaptersDB = {
	async getByProjectId(projectId: string): Promise<Chapter[]> {
		return await db.chapters.where('projectId').equals(projectId).sortBy('order');
	},

	async getById(id: string): Promise<Chapter | undefined> {
		return await db.chapters.get(id);
	},

	async create(input: ChapterCreateInput): Promise<Chapter> {
		const now = Date.now();
		const existingChapters = await this.getByProjectId(input.projectId);
		const maxOrder = existingChapters.reduce((max, c) => Math.max(max, c.order), -1);

		const chapter: Chapter = {
			id: uuidv4(),
			projectId: input.projectId,
			title: input.title,
			synopsis: input.synopsis || '',
			order: maxOrder + 1,
			createdAt: now,
			updatedAt: now,
			_version: 1
		};

		await db.chapters.add(chapter);
		await touchProject(input.projectId);

		// 作成履歴を保存
		await historyDB.create('chapter', chapter.id, chapter.projectId, chapter, 'create');

		return chapter;
	},

	async update(id: string, changes: Partial<Chapter>): Promise<void> {
		const chapter = await db.chapters.get(id);
		await db.chapters.update(id, {
			...changes,
			updatedAt: Date.now(),
			_version: (chapter?._version || 0) + 1
		});
		if (chapter) {
			await touchProject(chapter.projectId);

			// 更新履歴を保存
			await historyDB.create('chapter', chapter.id, chapter.projectId, chapter, 'update');
		}
	},

	async delete(id: string): Promise<void> {
		const chapter = await db.chapters.get(id);
		await db.transaction('rw', [db.chapters, db.scenes, db.projects], async () => {
			await db.chapters.delete(id);
			await db.scenes.where('chapterId').equals(id).delete();
		});
		if (chapter) {
			await touchProject(chapter.projectId);
		}
	},

	async reorder(projectId: string, chapterIds: string[]): Promise<void> {
		await db.transaction('rw', [db.chapters, db.projects], async () => {
			for (let i = 0; i < chapterIds.length; i++) {
				await db.chapters.update(chapterIds[i], {
					order: i,
					updatedAt: Date.now()
				});
			}
		});
		await touchProject(projectId);
	},

	/**
	 * リモートからのチャプターをそのまま追加（IDを保持）
	 */
	async addFromRemote(chapter: Chapter): Promise<void> {
		await db.chapters.add(chapter);
	}
};
