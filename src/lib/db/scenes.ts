import { db } from './schema';
import type { Scene, SceneCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { isUnchanged, touchProject } from './utils';
import { historyDB } from './history';
import { extensionEvents, type SceneChangeOrigin } from '$lib/extensions/events';

/** 拡張向けイベントの発行に関するオプション */
export interface SceneWriteOptions {
	/**
	 * true なら拡張向けのイベント(scene:updated / scene:created)を発行しない。
	 * 誰の変更かを切り分けられない書き込み(共同編集のミラーなど)で指定する
	 */
	silent?: boolean;
	/** この保存の変更が誰(何)によるものか。省略すると 'user'(利用者がエディタで書いた変更) */
	origin?: SceneChangeOrigin;
	/**
	 * 利用者の編集と同じ保存に、AI の提案を適用した変更が混ざっているとき(エディタで開いているシーン)。
	 * delta は AI の適用による文字数の増減、userEdited は利用者の編集も含まれるか。
	 * 指定すると、AI の分(origin: 'ai')と利用者の分(origin: 'user')を別のイベントとして発行する
	 */
	ai?: { delta: number; userEdited: boolean };
}

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

	async create(input: SceneCreateInput, options: SceneWriteOptions = {}): Promise<Scene> {
		const now = Date.now();
		const existingScenes = await this.getByChapterId(input.chapterId);
		const maxOrder = existingScenes.reduce((max, s) => Math.max(max, s.order), -1);

		const scene: Scene = {
			id: input.id ?? uuidv4(),
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

		if (!options.silent) {
			extensionEvents.emit('scene:created', {
				sceneId: scene.id,
				chapterId: scene.chapterId,
				projectId: scene.projectId
			});
		}

		return scene;
	},

	async update(
		id: string,
		changes: Partial<Scene>,
		options: SceneWriteOptions = {}
	): Promise<void> {
		// 変更前のデータを保存（履歴用）
		const currentScene = await db.scenes.get(id);

		// 文字数を自動計算
		const effective: Partial<Scene> = { ...changes };
		if (changes.content !== undefined) {
			effective.characterCount = changes.content.length;
		}

		// 内容が変わらない保存(未変更の離脱時保存・ミラーなど)では updatedAt を進めない
		if (isUnchanged(currentScene, effective)) return;

		const updates: Partial<Scene> = {
			...effective,
			updatedAt: Date.now(),
			_version: (currentScene?._version || 0) + 1
		};

		await db.scenes.update(id, updates);

		// 拡張向け: 本文が実際に変わったときだけ(タイトルや並び順だけの更新では発行しない)
		if (
			!options.silent &&
			currentScene &&
			changes.content !== undefined &&
			currentScene.content !== changes.content
		) {
			const base = {
				sceneId: id,
				chapterId: currentScene.chapterId,
				projectId: currentScene.projectId
			};
			const before = currentScene.characterCount ?? 0;
			const after = effective.characterCount ?? changes.content.length;
			if (options.ai) {
				// AI の適用分を先に、残りを利用者の分として分ける(増減の合計は保存の前後の差と一致する)
				const afterAi = before + options.ai.delta;
				extensionEvents.emit('scene:updated', {
					...base,
					characterCount: afterAi,
					previousCharacterCount: before,
					delta: options.ai.delta,
					origin: 'ai'
				});
				if (options.ai.userEdited) {
					extensionEvents.emit('scene:updated', {
						...base,
						characterCount: after,
						previousCharacterCount: afterAi,
						delta: after - afterAi,
						origin: 'user'
					});
				}
			} else {
				extensionEvents.emit('scene:updated', {
					...base,
					characterCount: after,
					previousCharacterCount: before,
					delta: after - before,
					origin: options.origin ?? 'user'
				});
			}
		}

		// プロジェクトの更新日時を更新
		if (currentScene) {
			await touchProject(currentScene.projectId);
		}

		// 変更履歴を保存（contentの変更のみ）
		if (currentScene && changes.content !== undefined) {
			// 内容に変化がある場合のみ履歴を保存
			if (currentScene.content !== changes.content) {
				await historyDB.createThrottled(
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
		// 共同編集の状態(crdtDocs)も不要になる
		await db.crdtDocs.delete(id);
		if (scene) {
			await touchProject(scene.projectId);
		}
	},

	async reorder(chapterId: string, sceneIds: string[]): Promise<void> {
		let projectId: string | undefined;
		let changed = false;
		await db.transaction('rw', [db.scenes, db.projects], async () => {
			for (let i = 0; i < sceneIds.length; i++) {
				const scene = await db.scenes.get(sceneIds[i]);
				if (scene && !projectId) {
					projectId = scene.projectId;
				}
				if (scene && scene.order === i) continue;
				await db.scenes.update(sceneIds[i], {
					order: i,
					updatedAt: Date.now()
				});
				changed = true;
			}
		});
		if (projectId && changed) {
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
