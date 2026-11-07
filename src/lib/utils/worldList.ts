/**
 * 設定資料の一覧の純粋なロジック(分類、検索、タグの絞り込み、並び、分類ごとの並べ替えの計画)。
 * ページ(worldbuilding/+page.svelte)とユニットテストで共有する。
 *
 * 手動順(order)は分類ごとに持つ。「すべて」を選んでいる間は、分類の順(WORLD_CATEGORIES)に並べ、
 * 同じ分類の中は手動順にする(AI/MCP の一覧、ワークスペースのファイル順と同じ)。
 */
import { WORLD_LABELS } from '$lib/desktop/entities';
import type { Worldbuilding } from '$lib/types';
import { moveItem, sortByOrder } from './ordering';

export type WorldCategory = Worldbuilding['category'];
export type WorldSort = 'manual' | 'title' | 'updated';
/** 分類のフィルター。'all' は全分類 */
export type WorldFilter = WorldCategory | 'all';

/** 分類の並び(チップ・「すべて」の中の節の順) */
export const WORLD_CATEGORIES = Object.keys(WORLD_LABELS) as WorldCategory[];

type Tone = 'info' | 'success' | 'secondary' | 'neutral';

/** 分類ごとの見た目: 名前・アイコン(editor/icons の名前)・色 */
export const WORLD_META: Record<WorldCategory, { label: string; icon: string; tone: Tone }> = {
	term: { label: WORLD_LABELS.term, icon: 'abc', tone: 'info' },
	location: { label: WORLD_LABELS.location, icon: 'buildings', tone: 'secondary' },
	timeline: { label: WORLD_LABELS.timeline, icon: 'timeline-event', tone: 'success' },
	other: { label: WORLD_LABELS.other, icon: 'book-2', tone: 'neutral' }
};

export interface WorldQuery {
	query: string;
	/** 'all' または分類 */
	category: WorldFilter;
	/** '' はタグで絞らない */
	tag: string;
}

function matchesText(w: Worldbuilding, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return (
		w.title.toLowerCase().includes(q) ||
		w.content.toLowerCase().includes(q) ||
		w.tags.some((t) => t.toLowerCase().includes(q))
	);
}

/** 検索語(タイトル・内容・タグ)とタグの絞り込み(分類は見ない) */
export function filterByTextAndTag(
	items: readonly Worldbuilding[],
	query: string,
	tag: string
): Worldbuilding[] {
	return items.filter((w) => matchesText(w, query) && (!tag || w.tags.includes(tag)));
}

/** 分類・検索語・タグで絞り込む */
export function filterWorld(items: readonly Worldbuilding[], q: WorldQuery): Worldbuilding[] {
	return filterByTextAndTag(items, q.query, q.tag).filter(
		(w) => q.category === 'all' || w.category === q.category
	);
}

/** 分類ごとの件数(検索語・タグで絞った結果の中の件数。'all' は合計) */
export function categoryCounts(
	items: readonly Worldbuilding[],
	query = '',
	tag = ''
): Record<WorldFilter, number> {
	const counts: Record<WorldFilter, number> = {
		all: 0,
		term: 0,
		location: 0,
		timeline: 0,
		other: 0
	};
	for (const w of filterByTextAndTag(items, query, tag)) {
		counts.all++;
		counts[w.category]++;
	}
	return counts;
}

/** 全タグ(五十音順)と、それぞれの件数 */
export function tagCounts(items: readonly Worldbuilding[]): { tag: string; count: number }[] {
	const map = new Map<string, number>();
	for (const w of items) for (const t of new Set(w.tags)) map.set(t, (map.get(t) ?? 0) + 1);
	return [...map.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => a.tag.localeCompare(b.tag, 'ja'));
}

/** 分類の順 → 同じ分類の中は手動順 */
export function sortByCategoryThenOrder(items: readonly Worldbuilding[]): Worldbuilding[] {
	const rank = (w: Worldbuilding) => WORLD_CATEGORIES.indexOf(w.category);
	return sortByOrder(items).sort((a, b) => rank(a) - rank(b));
}

/** 並び: 手動順(分類の順 → 手動順)、タイトル順(五十音)、更新日が新しい順 */
export function sortWorld(items: readonly Worldbuilding[], mode: WorldSort): Worldbuilding[] {
	if (mode === 'title') {
		return [...items].sort(
			(a, b) => a.title.localeCompare(b.title, 'ja') || (a.id < b.id ? -1 : 1)
		);
	}
	if (mode === 'updated') return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
	return sortByCategoryThenOrder(items);
}

export function visibleWorld(
	items: readonly Worldbuilding[],
	options: WorldQuery & { sort: WorldSort }
): Worldbuilding[] {
	return sortWorld(filterWorld(items, options), options.sort);
}

/** 分類ごとの節(項目のある分類だけ。分類の順) */
export function groupByCategory(
	items: readonly Worldbuilding[]
): { category: WorldCategory; items: Worldbuilding[] }[] {
	return WORLD_CATEGORIES.map((category) => ({
		category,
		items: items.filter((w) => w.category === category)
	})).filter((g) => g.items.length > 0);
}

/** 並べ替えができるのは、手動順で、検索語・タグで絞っていないときだけ */
export function canReorderWorld(options: {
	readOnly: boolean;
	sort: WorldSort;
	query: string;
	tag: string;
}): boolean {
	return (
		!options.readOnly &&
		options.sort === 'manual' &&
		options.query.trim() === '' &&
		options.tag === ''
	);
}

export interface WorldChange {
	id: string;
	changes: Partial<Pick<Worldbuilding, 'order' | 'category'>>;
}

/**
 * id の設定資料を、分類 category の中の toIndex 番目(移動後の位置)へ動かすための更新。
 * 別の分類へ移すなら、分類の変更も同じ更新(同じ行)に含める。位置が変わらなければ空。
 * worldbuildingDB.moveTo(id, toIndex, category) が書く内容と同じ。
 */
export function planWorldMove(
	items: readonly Worldbuilding[],
	id: string,
	toIndex: number,
	category?: WorldCategory
): WorldChange[] {
	const item = items.find((w) => w.id === id);
	if (!item) return [];
	const target = category ?? item.category;
	const siblings = items.filter((w) => w.category === target);
	return moveItem(siblings, id, toIndex).map((u) => ({
		id: u.id,
		changes: {
			order: u.order,
			...(u.id === id && target !== item.category ? { category: target } : {})
		}
	}));
}

/** planWorldMove の結果を配列に反映した新しい配列(画面の即時反映用。元の配列は変えない) */
export function applyWorldChanges(
	items: readonly Worldbuilding[],
	changes: readonly WorldChange[]
): Worldbuilding[] {
	const byId = new Map(changes.map((c) => [c.id, c.changes]));
	return items.map((w) => (byId.has(w.id) ? { ...w, ...byId.get(w.id) } : w));
}

/** 内容の最初の空でない行(一覧の 2 行目) */
export function firstLine(text: string): string {
	return (
		text
			.split('\n')
			.find((l) => l.trim() !== '')
			?.trim() ?? ''
	);
}
