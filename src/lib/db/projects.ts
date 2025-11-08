import { db } from './schema';
import type { Project, ProjectCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';

export const projectsDB = {
	async getAll(): Promise<Project[]> {
		return await db.projects.orderBy('updatedAt').reverse().toArray();
	},

	async getById(id: string): Promise<Project | undefined> {
		return await db.projects.get(id);
	},

	async create(input: ProjectCreateInput): Promise<Project> {
		const now = Date.now();
		const project: Project = {
			id: uuidv4(),
			title: input.title,
			description: input.description || '',
			createdAt: now,
			updatedAt: now,
			status: 'draft',
			settings: {
				writingMode: 'horizontal',
				fontSize: 16,
				theme: 'light',
				goal: {
					type: 'daily',
					target: 2000
				}
			},
			_version: 1
		};

		await db.projects.add(project);
		return project;
	},

	async update(id: string, changes: Partial<Project>): Promise<void> {
		const project = await db.projects.get(id);
		await db.projects.update(id, {
			...changes,
			updatedAt: Date.now(),
			_version: (project?._version || 0) + 1
		});
	},

	async delete(id: string): Promise<void> {
		// 関連データも削除
		await db.transaction(
			'rw',
			[
				db.projects,
				db.chapters,
				db.scenes,
				db.characters,
				db.plots,
				db.worldbuilding,
				db.history,
				db.progressLogs
			],
			async () => {
				await db.projects.delete(id);
				await db.chapters.where('projectId').equals(id).delete();
				await db.scenes.where('projectId').equals(id).delete();
				await db.characters.where('projectId').equals(id).delete();
				await db.plots.where('projectId').equals(id).delete();
				await db.worldbuilding.where('projectId').equals(id).delete();
				await db.history.where('projectId').equals(id).delete();
				await db.progressLogs.where('projectId').equals(id).delete();
			}
		);
	},

	async search(query: string): Promise<Project[]> {
		const allProjects = await db.projects.toArray();
		const lowerQuery = query.toLowerCase();
		return allProjects.filter(
			(p) =>
				p.title.toLowerCase().includes(lowerQuery) ||
				p.description.toLowerCase().includes(lowerQuery)
		);
	},

	/**
	 * リモートからのプロジェクトをそのまま追加（IDを保持）
	 */
	async addFromRemote(project: Project): Promise<void> {
		await db.projects.add(project);
	}
};
