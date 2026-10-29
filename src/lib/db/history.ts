import { db } from './schema';
import type { History } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';

const BACKUP_CHANGE_TYPES: History['changeType'][] = ['conflict', 'remote-delete'];

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

	/**
	 * 同期の競合・他端末の削除で上書きされた版(復元用バックアップ)の一覧
	 */
	async getBackups(): Promise<History[]> {
		return await db.history
			.orderBy('createdAt')
			.reverse()
			.filter((h) => BACKUP_CHANGE_TYPES.includes(h.changeType))
			.toArray();
	},

	async get(historyId: string): Promise<History | undefined> {
		return await db.history.get(historyId);
	},

	/**
	 * 通常の履歴は daysToKeep 日、競合・削除のバックアップは backupDaysToKeep 日保持する
	 */
	async deleteOldHistory(daysToKeep = 30, backupDaysToKeep = 90): Promise<void> {
		const day = 24 * 60 * 60 * 1000;
		const now = Date.now();
		await db.history
			.where('createdAt')
			.below(now - Math.min(daysToKeep, backupDaysToKeep) * day)
			.filter((h) => {
				const isBackup = BACKUP_CHANGE_TYPES.includes(h.changeType);
				return h.createdAt < now - (isBackup ? backupDaysToKeep : daysToKeep) * day;
			})
			.delete();
	}
};
