import { describe, expect, it } from 'vitest';
import type { Worldbuilding } from '$lib/types';
import { sortByOrder } from './ordering';
import {
	WORLD_CATEGORIES,
	WORLD_META,
	applyWorldChanges,
	canReorderWorld,
	categoryCounts,
	filterWorld,
	firstLine,
	groupByCategory,
	planWorldMove,
	sortWorld,
	tagCounts,
	visibleWorld
} from './worldList';

const w = (id: string, category: Worldbuilding['category'], over: Partial<Worldbuilding> = {}) =>
	({
		id,
		projectId: 'p',
		category,
		title: id,
		content: '',
		tags: [],
		attachments: [],
		createdAt: 1,
		updatedAt: 1,
		_version: 1,
		...over
	}) as Worldbuilding;

const sample = [
	w('t1', 'term', { title: '魔法', content: '世界を満たす力', tags: ['力', '基礎'], order: 2000 }),
	w('t2', 'term', { title: '契約', content: '精霊との約束', tags: ['力'], order: 1000 }),
	w('l1', 'location', { title: '王都', content: '白い城壁の街', tags: ['街'], order: 1000 }),
	w('y1', 'timeline', { title: '大戦', content: '百年前の戦い', order: 1000 }),
	w('o1', 'other', { title: '備考', order: 1000 })
];

describe('分類の定義', () => {
	it('分類は 4 種で、それぞれ名前・アイコン・色を持つ(絵文字は使わない)', () => {
		expect(WORLD_CATEGORIES).toHaveLength(4);
		for (const c of WORLD_CATEGORIES) {
			expect(WORLD_META[c].label).toBeTruthy();
			expect(WORLD_META[c].icon).toMatch(/^[a-z0-9-]+$/);
		}
		expect(new Set(WORLD_CATEGORIES.map((c) => WORLD_META[c].icon)).size).toBe(4);
	});
});

describe('filterWorld / categoryCounts / tagCounts', () => {
	it('タイトル・内容・タグで検索できる', () => {
		const f = (query: string) =>
			filterWorld(sample, { query, category: 'all', tag: '' }).map((x) => x.id);
		expect(f('魔法')).toEqual(['t1']);
		expect(f('城壁')).toEqual(['l1']);
		expect(f('基礎')).toEqual(['t1']);
		expect(f('')).toHaveLength(5);
	});
	it('分類で絞り込める', () => {
		expect(filterWorld(sample, { query: '', category: 'term', tag: '' }).map((x) => x.id)).toEqual([
			't1',
			't2'
		]);
	});
	it('タグで絞り込める(タグは完全一致)', () => {
		expect(filterWorld(sample, { query: '', category: 'all', tag: '力' }).map((x) => x.id)).toEqual(
			['t1', 't2']
		);
		expect(filterWorld(sample, { query: '', category: 'all', tag: '街' }).map((x) => x.id)).toEqual(
			['l1']
		);
		expect(filterWorld(sample, { query: '', category: 'all', tag: '無い' })).toEqual([]);
	});
	it('分類・検索語・タグを組み合わせられる', () => {
		expect(
			filterWorld(sample, { query: '精霊', category: 'term', tag: '力' }).map((x) => x.id)
		).toEqual(['t2']);
		expect(filterWorld(sample, { query: '精霊', category: 'location', tag: '' })).toEqual([]);
	});
	it('件数は分類ごとと合計(検索語・タグを反映する)', () => {
		expect(categoryCounts(sample)).toEqual({ all: 5, term: 2, location: 1, timeline: 1, other: 1 });
		expect(categoryCounts(sample, '', '力')).toEqual({
			all: 2,
			term: 2,
			location: 0,
			timeline: 0,
			other: 0
		});
		expect(categoryCounts(sample, '戦')).toMatchObject({ all: 1, timeline: 1 });
	});
	it('タグは五十音順に、件数つきで集計する', () => {
		const items = [
			w('a', 'term', { tags: ['まち', 'ちから'] }),
			w('b', 'term', { tags: ['ちから', 'きそ'] })
		];
		expect(tagCounts(items)).toEqual([
			{ tag: 'きそ', count: 1 },
			{ tag: 'ちから', count: 2 },
			{ tag: 'まち', count: 1 }
		]);
		expect(tagCounts([w('d', 'term', { tags: ['a', 'a'] })])).toEqual([{ tag: 'a', count: 1 }]);
	});
});

describe('並び', () => {
	it('手動順は、分類の順 → 分類の中の order 順', () => {
		const ids = sortWorld(sample, 'manual').map((x) => x.id);
		expect(ids).toEqual(['t2', 't1', 'l1', 'y1', 'o1']);
	});
	it('タイトル順・更新日順', () => {
		expect(sortWorld(sample, 'title').map((x) => x.title)).toEqual(
			['王都', '契約', '備考', '大戦', '魔法'].sort((a, b) => a.localeCompare(b, 'ja'))
		);
		const dated = [w('a', 'term', { updatedAt: 1 }), w('b', 'term', { updatedAt: 9 })];
		expect(sortWorld(dated, 'updated').map((x) => x.id)).toEqual(['b', 'a']);
	});
	it('order が無い旧データは作成順で先に並ぶ', () => {
		const old = [
			w('n2', 'term', { createdAt: 20 }),
			w('n1', 'term', { createdAt: 10 }),
			w('n3', 'term', { order: 1000, createdAt: 5 })
		];
		expect(sortWorld(old, 'manual').map((x) => x.id)).toEqual(['n1', 'n2', 'n3']);
	});
	it('検索してから並べる', () => {
		expect(
			visibleWorld(sample, { query: '世界', category: 'term', tag: '', sort: 'manual' }).map(
				(x) => x.id
			)
		).toEqual(['t1']);
	});
	it('分類ごとの節にできる(空の分類は除く)', () => {
		const groups = groupByCategory(
			sortWorld(
				sample.filter((x) => x.category !== 'timeline'),
				'manual'
			)
		);
		expect(groups.map((g) => g.category)).toEqual(['term', 'location', 'other']);
		expect(groups[0].items.map((x) => x.id)).toEqual(['t2', 't1']);
	});
});

describe('canReorderWorld', () => {
	it('手動順で、検索語・タグが無く、閲覧専用でないときだけ', () => {
		const base = { readOnly: false, sort: 'manual', query: '', tag: '' } as const;
		expect(canReorderWorld(base)).toBe(true);
		expect(canReorderWorld({ ...base, query: 'a' })).toBe(false);
		expect(canReorderWorld({ ...base, tag: '力' })).toBe(false);
		expect(canReorderWorld({ ...base, sort: 'title' })).toBe(false);
		expect(canReorderWorld({ ...base, readOnly: true })).toBe(false);
	});
});

describe('planWorldMove / applyWorldChanges', () => {
	it('同じ分類の中で動かすと、その行の order だけを書く', () => {
		const changes = planWorldMove(sample, 't1', 0);
		expect(changes).toHaveLength(1);
		expect(changes[0].id).toBe('t1');
		expect(changes[0].changes.category).toBeUndefined();
		const next = applyWorldChanges(sample, changes);
		expect(sortByOrder(next.filter((x) => x.category === 'term')).map((x) => x.id)).toEqual([
			't1',
			't2'
		]);
	});
	it('分類を指定すると、その分類の末尾へ移り、分類の変更も同じ行に含む', () => {
		const changes = planWorldMove(sample, 't1', Number.MAX_SAFE_INTEGER, 'location');
		expect(changes).toHaveLength(1);
		expect(changes[0].changes.category).toBe('location');
		const next = applyWorldChanges(sample, changes);
		expect(sortByOrder(next.filter((x) => x.category === 'location')).map((x) => x.id)).toEqual([
			'l1',
			't1'
		]);
		expect(next.filter((x) => x.category === 'term').map((x) => x.id)).toEqual(['t2']);
	});
	it('他の分類の order は動かさない', () => {
		const changes = planWorldMove(sample, 'l1', 0, 'term');
		expect(changes.map((c) => c.id)).toEqual(['l1']);
	});
	it('位置が変わらなければ空、存在しない id も空', () => {
		expect(planWorldMove(sample, 't2', 0)).toEqual([]);
		expect(planWorldMove(sample, 'nope', 0)).toEqual([]);
	});
});

describe('firstLine', () => {
	it('最初の空でない行', () => {
		expect(firstLine('\n\n  一行目  \n二行目')).toBe('一行目');
		expect(firstLine('')).toBe('');
	});
});
