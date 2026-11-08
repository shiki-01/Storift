import { beforeEach, describe, expect, it, vi } from 'vitest';
import { itemNav } from '$lib/stores/itemNav.svelte';
import { selectAndGo } from './refNav';

const go = vi.fn(async () => {});

beforeEach(() => {
	go.mockClear();
	for (const p of ['characters', 'plot', 'worldbuilding']) itemNav.take(`/project/p1/${p}`);
});

describe('selectAndGo', () => {
	it.each(['characters', 'plot', 'worldbuilding'])(
		'%s: 同じページ内では移動せず、連続して別の項目を依頼できる',
		async (seg) => {
			const path = `/project/p1/${seg}`;
			await selectAndGo(path, 'a', path, go);
			expect(itemNav.take(path)).toBe('a');
			await selectAndGo(path, 'b', path, go);
			expect(itemNav.take(path)).toBe('b');
			expect(go).not.toHaveBeenCalled();
		}
	);

	it('別のページからは依頼を出して移動する', async () => {
		await selectAndGo('/project/p1/plot', 'x', '/project/p1/characters', go);
		expect(go).toHaveBeenCalledWith('/project/p1/plot');
		expect(itemNav.take('/project/p1/plot')).toBe('x');
	});
});
