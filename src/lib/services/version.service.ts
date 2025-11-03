/**
 * バージョン管理サービス
 * テキスト差分表示、復元ポイント、ブランチング機能を提供
 */

import { db } from '$lib/db';
import type { History } from '$lib/types';

export interface TextDiff {
	type: 'add' | 'remove' | 'unchanged';
	text: string;
	lineNumber?: number;
}

export interface VersionComparison {
	oldVersion: History;
	newVersion: History;
	diffs: TextDiff[];
	stats: {
		additions: number;
		deletions: number;
		unchanged: number;
	};
}

export interface RestorePoint {
	id: string;
	historyId: string;
	name: string;
	description?: string;
	createdAt: number;
	projectId: string;
	entityType: 'scene' | 'chapter' | 'character' | 'plot' | 'worldbuilding';
	entityId: string;
}

class VersionService {
	/**
	 * テキスト差分を計算(シンプルな行ベースdiff)
	 */
	calculateDiff(oldText: string, newText: string): TextDiff[] {
		const oldLines = oldText.split('\n');
		const newLines = newText.split('\n');
		const diffs: TextDiff[] = [];

		// シンプルなLCS(最長共通部分列)ベースのdiff
		const matrix = this.computeLCSMatrix(oldLines, newLines);
		this.backtrackLCS(oldLines, newLines, matrix, diffs);

		return diffs;
	}

	/**
	 * LCS行列を計算
	 */
	private computeLCSMatrix(oldLines: string[], newLines: string[]): number[][] {
		const m = oldLines.length;
		const n = newLines.length;
		const matrix: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				if (oldLines[i - 1] === newLines[j - 1]) {
					matrix[i][j] = matrix[i - 1][j - 1] + 1;
				} else {
					matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
				}
			}
		}

		return matrix;
	}

	/**
	 * LCS行列からdiffを逆追跡
	 */
	private backtrackLCS(
		oldLines: string[],
		newLines: string[],
		matrix: number[][],
		diffs: TextDiff[]
	): void {
		let i = oldLines.length;
		let j = newLines.length;
		const result: TextDiff[] = [];

		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
				result.unshift({
					type: 'unchanged',
					text: oldLines[i - 1],
					lineNumber: i
				});
				i--;
				j--;
			} else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
				result.unshift({
					type: 'add',
					text: newLines[j - 1],
					lineNumber: j
				});
				j--;
			} else if (i > 0) {
				result.unshift({
					type: 'remove',
					text: oldLines[i - 1],
					lineNumber: i
				});
				i--;
			}
		}

		diffs.push(...result);
	}

	/**
	 * 2つのバージョンを比較
	 */
	async compareVersions(
		oldHistoryId: string,
		newHistoryId: string
	): Promise<VersionComparison | null> {
		const oldVersion = await db.history.get(oldHistoryId);
		const newVersion = await db.history.get(newHistoryId);

		if (!oldVersion || !newVersion) {
			return null;
		}

		const oldContent = JSON.stringify(oldVersion.snapshot, null, 2);
		const newContent = JSON.stringify(newVersion.snapshot, null, 2);
		const diffs = this.calculateDiff(oldContent, newContent);

		const stats = {
			additions: diffs.filter(d => d.type === 'add').length,
			deletions: diffs.filter(d => d.type === 'remove').length,
			unchanged: diffs.filter(d => d.type === 'unchanged').length
		};

		return {
			oldVersion,
			newVersion,
			diffs,
			stats
		};
	}

	/**
	 * 復元ポイントを作成
	 */
	async createRestorePoint(
		historyEntry: History,
		name: string,
		description?: string
	): Promise<RestorePoint> {
		const restorePoint: RestorePoint = {
			id: crypto.randomUUID(),
			historyId: historyEntry.id,
			name,
			description,
			createdAt: Date.now(),
			projectId: historyEntry.projectId,
			entityType: historyEntry.entityType,
			entityId: historyEntry.entityId
		};

		await this.saveRestorePoint(restorePoint);
		return restorePoint;
	}

	/**
	 * 復元ポイントを保存(localStorage使用)
	 */
	private async saveRestorePoint(restorePoint: RestorePoint): Promise<void> {
		const key = 'storift_restore_points';
		const points = this.getAllRestorePoints();
		points.push(restorePoint);
		localStorage.setItem(key, JSON.stringify(points));
	}

	/**
	 * 全ての復元ポイントを取得
	 */
	getAllRestorePoints(): RestorePoint[] {
		try {
			const key = 'storift_restore_points';
			const data = localStorage.getItem(key);
			return data ? JSON.parse(data) : [];
		} catch {
			return [];
		}
	}

	/**
	 * プロジェクトの復元ポイントを取得
	 */
	getProjectRestorePoints(projectId: string): RestorePoint[] {
		return this.getAllRestorePoints().filter(p => p.projectId === projectId);
	}

	/**
	 * エンティティの復元ポイントを取得
	 */
	getEntityRestorePoints(entityType: string, entityId: string): RestorePoint[] {
		return this.getAllRestorePoints().filter(
			p => p.entityType === entityType && p.entityId === entityId
		);
	}

	/**
	 * 復元ポイントを削除
	 */
	deleteRestorePoint(restorePointId: string): void {
		const key = 'storift_restore_points';
		const points = this.getAllRestorePoints().filter(p => p.id !== restorePointId);
		localStorage.setItem(key, JSON.stringify(points));
	}

	/**
	 * 復元ポイントからデータを復元
	 */
	async restoreFromPoint(restorePointId: string): Promise<boolean> {
		const restorePoint = this.getAllRestorePoints().find(p => p.id === restorePointId);
		if (!restorePoint) {
			return false;
		}

		const historyEntry = await db.history.get(restorePoint.historyId);
		if (!historyEntry) {
			return false;
		}

		// エンティティタイプに応じて復元
		const { entityType, entityId, snapshot } = historyEntry;

		try {
			switch (entityType) {
				case 'scene': {
					const scene = await db.scenes.get(entityId);
					if (scene) {
						await db.scenes.update(entityId, snapshot);
					}
					break;
				}
				case 'chapter': {
					const chapter = await db.chapters.get(entityId);
					if (chapter) {
						await db.chapters.update(entityId, snapshot);
					}
					break;
				}
				case 'character': {
					const character = await db.characters.get(entityId);
					if (character) {
						await db.characters.update(entityId, snapshot);
					}
					break;
				}
				case 'plot': {
					const plot = await db.plots.get(entityId);
					if (plot) {
						await db.plots.update(entityId, snapshot);
					}
					break;
				}
				case 'worldbuilding': {
					const worldbuilding = await db.worldbuilding.get(entityId);
					if (worldbuilding) {
						await db.worldbuilding.update(entityId, snapshot);
					}
					break;
				}
			}

			// 復元履歴を記録
			await db.history.add({
				id: crypto.randomUUID(),
				projectId: restorePoint.projectId,
				entityType,
				entityId,
				snapshot,
				changeType: 'update',
				createdAt: Date.now()
			});

			return true;
		} catch (error) {
			console.error('復元に失敗:', error);
			return false;
		}
	}

	/**
	 * エンティティの履歴を取得
	 */
	async getEntityHistory(
		entityType: string,
		entityId: string,
		limit = 50
	): Promise<History[]> {
		const history = await db.history
			.where(['entityType', 'entityId'])
			.equals([entityType, entityId])
			.reverse()
			.limit(limit)
			.toArray();

		return history;
	}

	/**
	 * 差分統計を計算
	 */
	calculateDiffStats(diffs: TextDiff[]): {
		additions: number;
		deletions: number;
		unchanged: number;
		totalChanges: number;
	} {
		const additions = diffs.filter(d => d.type === 'add').length;
		const deletions = diffs.filter(d => d.type === 'remove').length;
		const unchanged = diffs.filter(d => d.type === 'unchanged').length;

		return {
			additions,
			deletions,
			unchanged,
			totalChanges: additions + deletions
		};
	}

	/**
	 * テキスト差分をHTMLでハイライト表示
	 */
	renderDiffAsHtml(diffs: TextDiff[]): string {
		return diffs
			.map(diff => {
				const escapedText = this.escapeHtml(diff.text);
				switch (diff.type) {
					case 'add':
						return `<div class="diff-line diff-add">+ ${escapedText}</div>`;
					case 'remove':
						return `<div class="diff-line diff-remove">- ${escapedText}</div>`;
					case 'unchanged':
						return `<div class="diff-line diff-unchanged">  ${escapedText}</div>`;
				}
			})
			.join('');
	}

	/**
	 * HTMLエスケープ
	 */
	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * スナップショットを作成(自動バックアップポイント)
	 */
	async createSnapshot(
		projectId: string,
		entityType: string,
		entityId: string,
		data: any
	): Promise<void> {
		const historyEntry: History = {
			id: crypto.randomUUID(),
			projectId,
			entityType: entityType as any,
			entityId,
			snapshot: data,
			changeType: 'update',
			createdAt: Date.now()
		};

		await db.history.add(historyEntry);

		// 自動的に復元ポイントを作成(24時間ごと)
		const lastSnapshot = await this.getLastSnapshot(entityType, entityId);
		const dayInMs = 24 * 60 * 60 * 1000;

		if (!lastSnapshot || Date.now() - lastSnapshot.createdAt > dayInMs) {
			await this.createRestorePoint(
				historyEntry,
				`自動スナップショット - ${new Date().toLocaleDateString('ja-JP')}`,
				'システムによる自動バックアップ'
			);
		}
	}

	/**
	 * 最後のスナップショットを取得
	 */
	private async getLastSnapshot(
		entityType: string,
		entityId: string
	): Promise<RestorePoint | null> {
		const points = this.getEntityRestorePoints(entityType, entityId);
		if (points.length === 0) {
			return null;
		}

		return points.sort((a, b) => b.createdAt - a.createdAt)[0];
	}

	/**
	 * 古いスナップショットをクリーンアップ
	 */
	async cleanupOldSnapshots(daysToKeep = 30): Promise<void> {
		const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
		const points = this.getAllRestorePoints();
		const pointsToDelete = points.filter(p => p.createdAt < cutoffTime);

		pointsToDelete.forEach(p => {
			this.deleteRestorePoint(p.id);
		});

		console.log(`${pointsToDelete.length}個の古いスナップショットを削除しました`);
	}
}

export const versionService = new VersionService();
