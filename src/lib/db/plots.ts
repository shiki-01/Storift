import { db } from './schema';
import type { Plot, PlotCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { touchProject } from './utils';

export const plotsDB = {
	async getByProjectId(projectId: string): Promise<Plot[]> {
		return await db.plots.where('projectId').equals(projectId).sortBy('order');
	},

	async getById(id: string): Promise<Plot | undefined> {
		return await db.plots.get(id);
	},

	async create(input: PlotCreateInput): Promise<Plot> {
		const now = Date.now();
		const existingPlots = await this.getByProjectId(input.projectId);
		const maxOrder = existingPlots.reduce((max, p) => Math.max(max, p.order), -1);

		const plot: Plot = {
			id: uuidv4(),
			projectId: input.projectId,
			title: input.title,
			type: input.type,
			status: input.status || 'idea',
			content: '',
			position: { x: 0, y: 0 },
			color: '#3b82f6',
			order: maxOrder + 1,
			createdAt: now,
			updatedAt: now,
			_version: 1
		};

		await db.plots.add(plot);
		await touchProject(input.projectId);
		return plot;
	},

	async update(id: string, changes: Partial<Plot>): Promise<void> {
		const plot = await db.plots.get(id);
		await db.plots.update(id, {
			...changes,
			updatedAt: Date.now(),
			_version: ((plot?._version || 0) + 1)
		});
		if (plot) {
			await touchProject(plot.projectId);
		}
	},

	async delete(id: string): Promise<void> {
		const plot = await db.plots.get(id);
		await db.plots.delete(id);
		if (plot) {
			await touchProject(plot.projectId);
		}
	},

	async reorder(projectId: string, plotIds: string[]): Promise<void> {
		await db.transaction('rw', [db.plots, db.projects], async () => {
			for (let i = 0; i < plotIds.length; i++) {
				await db.plots.update(plotIds[i], { 
					order: i,
					updatedAt: Date.now()
				});
			}
		});
		await touchProject(projectId);
	},

	/**
	 * リモートからのプロットをそのまま追加（IDを保持）
	 */
	async addFromRemote(plot: Plot): Promise<void> {
		await db.plots.add(plot);
	}
};
