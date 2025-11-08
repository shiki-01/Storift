import { db } from './schema';
import type { Worldbuilding, WorldbuildingCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { touchProject } from './utils';

export const worldbuildingDB = {
	async getByProjectId(projectId: string): Promise<Worldbuilding[]> {
		return await db.worldbuilding.where('projectId').equals(projectId).toArray();
	},

	async getById(id: string): Promise<Worldbuilding | undefined> {
		return await db.worldbuilding.get(id);
	},

	async getByCategory(
		projectId: string,
		category: Worldbuilding['category']
	): Promise<Worldbuilding[]> {
		return await db.worldbuilding
			.where(['projectId', 'category'])
			.equals([projectId, category])
			.toArray();
	},

	async create(input: WorldbuildingCreateInput): Promise<Worldbuilding> {
		const now = Date.now();
		const worldbuilding: Worldbuilding = {
			id: uuidv4(),
			projectId: input.projectId,
			category: input.category,
			title: input.title,
			content: input.content || '',
			tags: [],
			attachments: [],
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
