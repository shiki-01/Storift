import { db } from './schema';
import type { History } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';

export const historyDB = {
	async create(
		entityType: History['entityType'],
		entityId: string,
		projectId: string,
		snapshot: any,
		changeType: History['changeType']
	): Promise<History> {
		const history: History = {
			id: uuidv4(),
			entityType,
			entityId,
			projectId,
			snapshot,
			changeType,
			createdAt: Date.now()
		};

		await db.history.add(history);
		return history;
	},

	async getByEntity(entityId: string): Promise<History[]> {
		return await db.history.where('entityId').equals(entityId).reverse().sortBy('createdAt');
	},

	async getByProject(projectId: string, limit = 50): Promise<History[]> {
		return await db.history
			.where('projectId')
			.equals(projectId)
			.reverse()
			.limit(limit)
			.sortBy('createdAt');
	},

	async restore(historyId: string): Promise<any> {
		const history = await db.history.get(historyId);
		if (!history) {
			throw new Error('History not found');
		}
		return history.snapshot;
	},

	async deleteOldHistory(daysToKeep = 30): Promise<void> {
		const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
		await db.history.where('createdAt').below(cutoffTime).delete();
	}
};
