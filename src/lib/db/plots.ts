import { db } from './schema';
import type { Plot, PlotCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { isUnchanged, touchProject, writeOrderChanges } from './utils';
import { nextOrder, sortByOrder } from '$lib/utils/ordering';
import { planPlotMove, type PlotGroup } from '$lib/utils/plotOrdering';

export const plotsDB = {
	async getByProjectId(projectId: string): Promise<Plot[]> {
		return sortByOrder(await db.plots.where('projectId').equals(projectId).toArray());
	},

	async getById(id: string): Promise<Plot | undefined> {
		return await db.plots.get(id);
	},

	async create(input: PlotCreateInput): Promise<Plot> {
		const now = Date.now();
		const existingPlots = await this.getByProjectId(input.projectId);

		const plot: Plot = {
			id: input.id ?? uuidv4(),
			projectId: input.projectId,
			title: input.title,
			type: input.type,
			status: input.status || 'idea',
			content: '',
			position: { x: 0, y: 0 },
			color: '#3b82f6',
			order: nextOrder(existingPlots),
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
		// 内容が変わらない更新では updatedAt を進めない(他端末との不要な競合を避ける)
		if (isUnchanged(plot, changes)) return;
		await db.plots.update(id, {
			...changes,
			updatedAt: Date.now(),
			_version: (plot?._version || 0) + 1
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

	/**
	 * 同じ状態の列の中で toIndex 番目(移動後の位置)へ動かす。group に状態を指定すると、その状態の列へ移す
	 * (状態の変更と order は、同じ 1 回の更新で書く)。ALL_PLOTS を指定すると、状態に関係なく
	 * プロット全体(タイムライン)の中で動かす。書いた行の id を返す。
	 * 通常は 1 行だけ。間隔が尽きたときなどだけ、その列全体を振り直す(utils/ordering.ts)。
	 * 同期は呼び出し元が、返った id を queueChanges に渡す。
	 */
	async moveTo(id: string, toIndex: number, group?: PlotGroup): Promise<string[]> {
		const plot = await db.plots.get(id);
		if (!plot) return [];
		const all = await this.getByProjectId(plot.projectId);
		const changes = planPlotMove(all, id, toIndex, group);
		return await writeOrderChanges<Plot>(db.plots, plot.projectId, changes);
	},

	async reorder(projectId: string, plotIds: string[]): Promise<void> {
		let changed = false;
		await db.transaction('rw', [db.plots, db.projects], async () => {
			for (let i = 0; i < plotIds.length; i++) {
				// 位置が変わらないものは更新しない
				if ((await db.plots.get(plotIds[i]))?.order === i) continue;
				await db.plots.update(plotIds[i], {
					order: i,
					updatedAt: Date.now()
				});
				changed = true;
			}
		});
		if (changed) await touchProject(projectId);
	},

	/**
	 * リモートからのプロットをそのまま追加（IDを保持）
	 */
	async addFromRemote(plot: Plot): Promise<void> {
		await db.plots.add(plot);
	}
};
