/**
 * プロットの並べ替えで書く更新の計画(純粋なロジック)。DB(plotsDB.moveTo)と、画面の即時反映で共有する。
 */
import type { Plot } from '$lib/types';
import { moveItem } from './ordering';

/** 状態に関係なく、プロット全体(タイムライン)の中で動かす */
export const ALL_PLOTS = '*';

export type PlotGroup = Plot['status'] | typeof ALL_PLOTS;

export interface PlotChange {
	id: string;
	changes: Partial<Pick<Plot, 'order' | 'status'>>;
}

/**
 * id のプロットを group の toIndex 番目(移動後の位置)へ動かすための更新。
 * - group が状態: その状態の列の中。別の状態なら、状態の変更も同じ更新(同じ行)に含める。
 * - group が ALL_PLOTS: 状態は変えずに、プロット全体の並びの中で動かす。
 * - group を省略: 今の状態の列の中。
 * 位置が変わらなければ空。通常は id の 1 件だけ(間隔が尽きたときだけ列全体の振り直し)。
 */
export function planPlotMove(
	plots: readonly Plot[],
	id: string,
	toIndex: number,
	group?: PlotGroup
): PlotChange[] {
	const plot = plots.find((p) => p.id === id);
	if (!plot) return [];
	const target = group ?? plot.status;
	const siblings = target === ALL_PLOTS ? plots : plots.filter((p) => p.status === target);
	const statusChanged = target !== ALL_PLOTS && target !== plot.status;
	return moveItem(siblings, id, toIndex).map((u) => ({
		id: u.id,
		changes: { order: u.order, ...(u.id === id && statusChanged ? { status: target } : {}) }
	}));
}

/** planPlotMove の結果を配列に反映した新しい配列(画面の即時反映用。元の配列は変えない) */
export function applyPlotChanges(plots: readonly Plot[], changes: readonly PlotChange[]): Plot[] {
	const byId = new Map(changes.map((c) => [c.id, c.changes]));
	return plots.map((p) => (byId.has(p.id) ? { ...p, ...byId.get(p.id) } : p));
}
