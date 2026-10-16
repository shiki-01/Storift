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

	/**
	 * 同一エンティティの直近の履歴から minIntervalMs 以内なら保存しない。
	 * 自動保存で履歴が際限なく増えるのを防ぐ。
	 */
	async createThrottled(
		entityType: History['entityType'],
		entityId: string,
		projectId: string,
		snapshot: any,
		changeType: History['changeType'],
		minIntervalMs = 5 * 60 * 1000
	): Promise<History | null> {
		const latest = await db.history
			.where('[entityType+entityId]')
			.equals([entityType, entityId])
			.reverse()
			.sortBy('createdAt');
		if (latest.length > 0 && Date.now() - latest[0].createdAt < minIntervalMs) {
			return null;
		}
		return await this.create(entityType, entityId, projectId, snapshot, changeType);
	},

	async getByEntity(entityId: string): Promise<History[]> {
		// entityId 単体のインデックスは無いため、作成日時の降順で走査して絞り込む
		return await db.history
			.orderBy('createdAt')
			.reverse()
			.filter((h) => h.entityId === entityId)
			.toArray();
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
