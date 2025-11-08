import { db } from './schema';
import type { Scene, SceneCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { touchProject } from './utils';
import { historyDB } from './history';

export const scenesDB = {
	async getByChapterId(chapterId: string): Promise<Scene[]> {
		return await db.scenes.where('chapterId').equals(chapterId).sortBy('order');
	},

	async getByProjectId(projectId: string): Promise<Scene[]> {
		return await db.scenes.where('projectId').equals(projectId).sortBy('order');
	},

	async getById(id: string): Promise<Scene | undefined> {
		return await db.scenes.get(id);
	},

	async create(input: SceneCreateInput): Promise<Scene> {
		const now = Date.now();
		const existingScenes = await this.getByChapterId(input.chapterId);
		const maxOrder = existingScenes.reduce((max, s) => Math.max(max, s.order), -1);

		const scene: Scene = {
			id: uuidv4(),
			chapterId: input.chapterId,
			projectId: input.projectId,
			title: input.title,
			content: input.content || '',
			order: maxOrder + 1,
			characterCount: 0,
			tags: [],
			createdAt: now,
			updatedAt: now,
			_version: 1
		};

		await db.scenes.add(scene);
		await touchProject(input.projectId);

		// 作成履歴を保存
		await historyDB.create('scene', scene.id, scene.projectId, scene, 'create');

		return scene;
	},

	async update(id: string, changes: Partial<Scene>): Promise<void> {
		// 変更前のデータを保存（履歴用）
		const currentScene = await db.scenes.get(id);

		const updates: Partial<Scene> = {
			...changes,
			updatedAt: Date.now(),
			_version: (currentScene?._version || 0) + 1
		};

		// 文字数を自動計算
		if (changes.content !== undefined) {
			updates.characterCount = changes.content.length;
		}

		await db.scenes.update(id, updates);

		// プロジェクトの更新日時を更新
		if (currentScene) {
			await touchProject(currentScene.projectId);
		}

		// 変更履歴を保存（contentの変更のみ）
		if (currentScene && changes.content !== undefined) {
			// 内容に変化がある場合のみ履歴を保存
			if (currentScene.content !== changes.content) {
				await historyDB.create(
					'scene',
					currentScene.id,
					currentScene.projectId,
					currentScene,
					'update'
				);
			}
		}
	},

	async delete(id: string): Promise<void> {
		const scene = await db.scenes.get(id);
		await db.scenes.delete(id);
		if (scene) {
			await touchProject(scene.projectId);
		}
	},

	async reorder(chapterId: string, sceneIds: string[]): Promise<void> {
		let projectId: string | undefined;
		await db.transaction('rw', [db.scenes, db.projects], async () => {
			for (let i = 0; i < sceneIds.length; i++) {
				const scene = await db.scenes.get(sceneIds[i]);
				if (scene && !projectId) {
					projectId = scene.projectId;
				}
				await db.scenes.update(sceneIds[i], {
					order: i,
					updatedAt: Date.now()
				});
			}
		});
		if (projectId) {
			await touchProject(projectId);
		}
	},

	async search(projectId: string, query: string): Promise<Scene[]> {
		const allScenes = await this.getByProjectId(projectId);
		const lowerQuery = query.toLowerCase();
		return allScenes.filter(
			(s) =>
				s.title.toLowerCase().includes(lowerQuery) ||
				s.content.toLowerCase().includes(lowerQuery) ||
				s.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
		);
	},

	/**
	 * リモートからのシーンをそのまま追加（IDを保持）
	 */
	async addFromRemote(scene: Scene): Promise<void> {
		await db.scenes.add(scene);
	}
};
