import { describe, expect, it } from 'vitest';
import type { Plot } from '$lib/types';
import { ALL_PLOTS, applyPlotChanges, planPlotMove } from './plotOrdering';

const plot = (id: string, status: Plot['status'], order?: number): Plot => ({
	id,
	projectId: 'p',
	title: id,
	type: 'scene',
	status,
	content: '',
	position: { x: 0, y: 0 },
	color: '#000',
	order,
	createdAt: 0,
	updatedAt: 0,
	_version: 1
});

const plots = [
	plot('a', 'idea', 1024),
	plot('b', 'planned', 2048),
	plot('c', 'idea', 3072),
	plot('d', 'idea', 4096)
];

describe('planPlotMove', () => {
	it('同じ列の中では order だけを 1 件分返す', () => {
		expect(planPlotMove(plots, 'd', 0)).toEqual([{ id: 'd', changes: { order: 1023 } }]);
	});

	it('別の列へ移すと、同じ更新に status を含める。移動先の列だけで位置を決める', () => {
		const changes = planPlotMove(plots, 'd', 0, 'planned');
		expect(changes).toEqual([{ id: 'd', changes: { order: 2047, status: 'planned' } }]);
		const moved = applyPlotChanges(plots, changes);
		expect(moved.find((p) => p.id === 'd')?.status).toBe('planned');
		expect(plots.find((p) => p.id === 'd')?.status).toBe('idea');
	});

	it('ALL_PLOTS は全体の並びの中で動かし、status は変えない', () => {
		const changes = planPlotMove(plots, 'd', 1, ALL_PLOTS);
		expect(changes).toEqual([{ id: 'd', changes: { order: 1536 } }]);
	});

	it('位置が変わらない・存在しない id は空', () => {
		expect(planPlotMove(plots, 'a', 0)).toEqual([]);
		expect(planPlotMove(plots, 'zzz', 0)).toEqual([]);
	});
});
