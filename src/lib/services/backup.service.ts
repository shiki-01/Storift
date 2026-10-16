import { toast, confirmDialog } from '$lib/stores/toast.svelte';
import { db } from '$lib/db';
import type { Project, Chapter, Scene, Character, Plot, Worldbuilding } from '$lib/types';
import type { ProgressLog } from '$lib/types/progress';

interface ProjectBackup {
	project: Project;
	chapters: unknown[];
	scenes: unknown[];
	characters: unknown[];
	plots: unknown[];
	worldbuilding: unknown[];
	progressLogs: unknown[];
}

export interface BackupData {
	version: string;
	createdAt: number;
	appVersion: string;
	projects: ProjectBackup[];
}

/**
 * 全データをバックアップ
 */
export async function createFullBackup(): Promise<BackupData> {
	const backup: BackupData = {
		version: '1.0',
		createdAt: Date.now(),
		appVersion: '0.0.1', // package.jsonから取得するのが理想
		projects: []
	};

	// すべてのプロジェクトを取得
	const projects = await db.projects.toArray();

	for (const project of projects) {
		const chapters = await db.chapters.where('projectId').equals(project.id).toArray();
		const scenes = await db.scenes.where('projectId').equals(project.id).toArray();
		const characters = await db.characters.where('projectId').equals(project.id).toArray();
		const plots = await db.plots.where('projectId').equals(project.id).toArray();
		const worldbuilding = await db.worldbuilding.where('projectId').equals(project.id).toArray();
		const progressLogs = await db.progressLogs.where('projectId').equals(project.id).toArray();

		backup.projects.push({
			project,
			chapters,
			scenes,
			characters,
			plots,
			worldbuilding,
			progressLogs
		});
	}

	return backup;
}

/**
 * 特定のプロジェクトをバックアップ
 */
export async function createProjectBackup(projectId: string): Promise<ProjectBackup> {
	const project = await db.projects.get(projectId);
	if (!project) {
		throw new Error('Project not found');
	}

	const chapters = await db.chapters.where('projectId').equals(projectId).toArray();
	const scenes = await db.scenes.where('projectId').equals(projectId).toArray();
	const characters = await db.characters.where('projectId').equals(projectId).toArray();
	const plots = await db.plots.where('projectId').equals(projectId).toArray();
	const worldbuilding = await db.worldbuilding.where('projectId').equals(projectId).toArray();
	const progressLogs = await db.progressLogs.where('projectId').equals(projectId).toArray();

	return {
		project,
		chapters,
		scenes,
		characters,
		plots,
		worldbuilding,
		progressLogs
	};
}

/**
 * バックアップをダウンロード
 */
export async function downloadBackup(data: unknown, filename: string): Promise<void> {
	const { saveAs } = await import('file-saver');
	const blob = new Blob([JSON.stringify(data, null, 2)], {
		type: 'application/json;charset=utf-8'
	});
	saveAs(blob, filename);
}

/**
 * 全データをバックアップしてダウンロード
 */
export async function backupAllData(): Promise<void> {
	const backup = await createFullBackup();
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	await downloadBackup(backup, `storift-backup-full-${timestamp}.json`);
}

/**
 * 特定プロジェクトをバックアップしてダウンロード
 */
export async function backupProject(projectId: string): Promise<void> {
	const backup = await createProjectBackup(projectId);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const projectTitle = backup.project.title.replace(/[/\\?%*:|"<>]/g, '-');
	await downloadBackup(backup, `storift-backup-${projectTitle}-${timestamp}.json`);
}

/**
 * バックアップから復元
 */
export async function restoreFromBackup(data: BackupData): Promise<void> {
	// バリデーション
	if (!data.version || !data.projects) {
		throw new Error('Invalid backup file');
	}

	// 確認
	const proceed = await confirmDialog({
		title: 'バックアップの復元',
		message: `${data.projects.length}個のプロジェクトを復元します。既存のデータは上書きされる可能性があります。続行しますか?`,
		confirmText: '復元する'
	});

	if (!proceed) {
		return;
	}

	// 復元処理
	for (const projectData of data.projects) {
		// プロジェクトが既に存在するかチェック
		const existing = await db.projects.get(projectData.project.id);

		if (existing) {
			// 上書き確認
			const overwrite = await confirmDialog({
				message: `プロジェクト「${projectData.project.title}」は既に存在します。上書きしますか?`,
				confirmText: '上書き',
				danger: true
			});

			if (!overwrite) {
				continue;
			}

			// 既存データを削除
			await db.chapters.where('projectId').equals(projectData.project.id).delete();
			await db.scenes.where('projectId').equals(projectData.project.id).delete();
			await db.characters.where('projectId').equals(projectData.project.id).delete();
			await db.plots.where('projectId').equals(projectData.project.id).delete();
			await db.worldbuilding.where('projectId').equals(projectData.project.id).delete();
			await db.progressLogs.where('projectId').equals(projectData.project.id).delete();
		}

		// データを復元
		await db.projects.put(projectData.project);
		await db.chapters.bulkPut(projectData.chapters as Chapter[]);
		await db.scenes.bulkPut(projectData.scenes as Scene[]);
		await db.characters.bulkPut(projectData.characters as Character[]);
		await db.plots.bulkPut(projectData.plots as Plot[]);
		await db.worldbuilding.bulkPut(projectData.worldbuilding as Worldbuilding[]);
		await db.progressLogs.bulkPut(projectData.progressLogs as ProgressLog[]);
	}

	toast.success('バックアップの復元が完了しました');
}

/**
 * 自動バックアップを設定
 */
export function setupAutoBackup(intervalDays: number = 7): () => void {
	const LAST_BACKUP_KEY = 'storift_last_backup_time';

	const checkAndBackup = async () => {
		const lastBackup = localStorage.getItem(LAST_BACKUP_KEY);
		const lastBackupTime = lastBackup ? parseInt(lastBackup, 10) : 0;
		const now = Date.now();
		const daysSinceBackup = (now - lastBackupTime) / (1000 * 60 * 60 * 24);

		if (daysSinceBackup >= intervalDays) {
			console.log('🔄 Auto-backup triggered');
			try {
				await backupAllData();
				localStorage.setItem(LAST_BACKUP_KEY, now.toString());
				console.log('✅ Auto-backup completed');
			} catch (error) {
				console.error('❌ Auto-backup failed:', error);
			}
		}
	};

	// 初回チェック
	checkAndBackup();

	// 定期チェック(1日ごと)
	const interval = setInterval(checkAndBackup, 24 * 60 * 60 * 1000);

	// クリーンアップ関数を返す
	return () => {
		clearInterval(interval);
	};
}
