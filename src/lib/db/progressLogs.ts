import { db } from './schema';
import type { ProgressLog, ProgressStats } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { touchProject } from './utils';

export const progressLogsDB = {
	async getByProjectId(projectId: string, limit?: number): Promise<ProgressLog[]> {
		const query = db.progressLogs.where('projectId').equals(projectId).reverse();
		if (limit) {
			return await query.limit(limit).sortBy('date');
		}
		return await query.sortBy('date');
	},

	async getByDate(projectId: string, date: string): Promise<ProgressLog | undefined> {
		return await db.progressLogs
			.where(['projectId', 'date'])
			.equals([projectId, date])
			.first();
	},

	async getById(id: string): Promise<ProgressLog | undefined> {
		return await db.progressLogs.get(id);
	},

	async create(projectId: string, date: string): Promise<ProgressLog> {
		const existing = await this.getByDate(projectId, date);
		if (existing) {
			return existing;
		}

		const progressLog: ProgressLog = {
			id: uuidv4(),
			projectId,
			date,
			charactersWritten: 0,
			timeSpent: 0,
			sceneIds: [],
			createdAt: Date.now()
		};

		await db.progressLogs.add(progressLog);
		await touchProject(projectId);
		return progressLog;
	},

	async update(id: string, changes: Partial<ProgressLog>): Promise<void> {
		const log = await db.progressLogs.get(id);
		await db.progressLogs.update(id, changes);
		if (log) {
			await touchProject(log.projectId);
		}
	},

	async addProgress(projectId: string, date: string, characters: number, timeSpent: number, sceneId?: string): Promise<void> {
		let log = await this.getByDate(projectId, date);
		
		if (!log) {
			log = await this.create(projectId, date);
		}

		const updates: Partial<ProgressLog> = {
			charactersWritten: log.charactersWritten + characters,
			timeSpent: log.timeSpent + timeSpent
		};

		if (sceneId && !log.sceneIds.includes(sceneId)) {
			updates.sceneIds = [...log.sceneIds, sceneId];
		}

		await this.update(log.id, updates);
	},

	async delete(id: string): Promise<void> {
		const log = await db.progressLogs.get(id);
		await db.progressLogs.delete(id);
		if (log) {
			await touchProject(log.projectId);
		}
	},

	async getStats(projectId: string, days = 30): Promise<ProgressStats> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - days);
		const cutoffString = cutoffDate.toISOString().split('T')[0];

		const logs = await db.progressLogs
			.where('projectId')
			.equals(projectId)
			.and((log) => log.date >= cutoffString)
			.toArray();

		const totalCharacters = logs.reduce((sum, log) => sum + log.charactersWritten, 0);
		const averageDaily = logs.length > 0 ? totalCharacters / logs.length : 0;
		const maxDaily = Math.max(...logs.map((log) => log.charactersWritten), 0);

		// 連続日数を計算
		let consecutiveDays = 0;
		const sortedLogs = logs.sort((a, b) => b.date.localeCompare(a.date));
		const today = new Date().toISOString().split('T')[0];
		let checkDate = new Date(today);

		for (let i = 0; i < 365; i++) {
			const dateString = checkDate.toISOString().split('T')[0];
			const hasLog = sortedLogs.some((log) => log.date === dateString && log.charactersWritten > 0);
			
			if (hasLog) {
				consecutiveDays++;
				checkDate.setDate(checkDate.getDate() - 1);
			} else if (i === 0) {
				// 今日がまだの場合は昨日から確認
				checkDate.setDate(checkDate.getDate() - 1);
			} else {
				break;
			}
		}

		return {
			totalCharacters,
			averageDaily,
			maxDaily,
			consecutiveDays,
			goalProgress: 0 // プロジェクトの目標設定が必要
		};
	},

	/**
	 * リモートからの進捗ログをそのまま追加（IDを保持）
	 */
	async addFromRemote(log: ProgressLog): Promise<void> {
		await db.progressLogs.add(log);
	}
};
