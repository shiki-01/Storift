import { db } from './schema';
import type { Worldbuilding, WorldbuildingCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { isUnchanged, touchProject, writeOrderChanges } from './utils';
import { moveItem, nextOrder, sortByOrder } from '$lib/utils/ordering';

export const worldbuildingDB = {
	async getByProjectId(projectId: string): Promise<Worldbuilding[]> {
		return sortByOrder(await db.worldbuilding.where('projectId').equals(projectId).toArray());
	},

	async getById(id: string): Promise<Worldbuilding | undefined> {
		return await db.worldbuilding.get(id);
	},

	/** 同じ分類の項目(手動順)。複合インデックスは無いので、プロジェクトの全件から絞る */
	async getByCategory(
		projectId: string,
		category: Worldbuilding['category']
	): Promise<Worldbuilding[]> {
		return (await this.getByProjectId(projectId)).filter((w) => w.category === category);
	},

	async create(input: WorldbuildingCreateInput): Promise<Worldbuilding> {
		const now = Date.now();
		const siblings = await this.getByCategory(input.projectId, input.category);
		const worldbuilding: Worldbuilding = {
			id: input.id ?? uuidv4(),
			projectId: input.projectId,
			category: input.category,
			title: input.title,
			content: input.content || '',
			tags: [],
			attachments: [],
			order: nextOrder(siblings),
			createdAt: now,
			updatedAt: now,
			_version: 1
		};

		await db.worldbuilding.add(worldbuilding);
		await touchProject(input.projectId);
		return worldbuilding;
	},

	async update(id: string, changes: Partial<Worldbuilding>): Promise<void> {
		const worldbuilding = await db.worldbuilding.get(id);
		// 内容が変わらない更新では updatedAt を進めない(他端末との不要な競合を避ける)
		if (isUnchanged(worldbuilding, changes)) return;
		await db.worldbuilding.update(id, {
			...changes,
			updatedAt: Date.now(),
			_version: (worldbuilding?._version || 0) + 1
		});
		if (worldbuilding) {
			await touchProject(worldbuilding.projectId);
		}
	},

	async delete(id: string): Promise<void> {
		const worldbuilding = await db.worldbuilding.get(id);
		await db.worldbuilding.delete(id);
		if (worldbuilding) {
			await touchProject(worldbuilding.projectId);
		}
	},

	/**
	 * 同じ分類の中で toIndex 番目(移動後の位置)へ動かす。group を指定すると、その分類へ移す
	 * (分類の変更と order は、同じ 1 回の更新で書く)。書いた行の id を返す(通常は 1 行。utils/ordering.ts)。
	 * 同期は呼び出し元が、返った id を queueChanges に渡す。
	 */
	async moveTo(id: string, toIndex: number, group?: Worldbuilding['category']): Promise<string[]> {
		const item = await db.worldbuilding.get(id);
		if (!item) return [];
		const category = group ?? item.category;
		const siblings = await this.getByCategory(item.projectId, category);
		const changes = moveItem(siblings, id, toIndex).map((u) => ({
			id: u.id,
			changes: {
				order: u.order,
				...(u.id === id && category !== item.category ? { category } : {})
			} as Partial<Worldbuilding>
		}));
		return await writeOrderChanges(db.worldbuilding, item.projectId, changes);
	},

	async search(projectId: string, query: string): Promise<Worldbuilding[]> {
		const allItems = await this.getByProjectId(projectId);
		const lowerQuery = query.toLowerCase();
		return allItems.filter(
			(item) =>
				item.title.toLowerCase().includes(lowerQuery) ||
				item.content.toLowerCase().includes(lowerQuery) ||
				item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
		);
	},

	/**
	 * リモートからの世界設定をそのまま追加（IDを保持）
	 */
	async addFromRemote(worldbuilding: Worldbuilding): Promise<void> {
		await db.worldbuilding.add(worldbuilding);
	}
};
