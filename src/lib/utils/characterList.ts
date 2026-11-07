/**
 * 人物の一覧の純粋なロジック(検索、並び、一覧の要約、並べ替えの画面反映)。
 * ページ(characters/+page.svelte)とユニットテストで共有する。
 */
import type { Character } from '$lib/types';
import { moveItem, sortByOrder, type OrderUpdate } from './ordering';

export type CharacterSort = 'manual' | 'name' | 'updated';

/** アバターの色。人物の id から決まる(同じ人物は、どの端末でも同じ色) */
export const AVATAR_TONES = [
	'primary',
	'accent',
	'secondary',
	'success',
	'warning',
	'info'
] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

export function avatarTone(id: string): AvatarTone {
	let hash = 0;
	for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/** 名前（無ければ「?」）の先頭 1 文字。アバターのイニシャル */
export function initialOf(name: string): string {
	return [...name.trim()][0] ?? '?';
}

/** 検索の対象にする文字列(名前・役割・本文) */
function haystack(c: Character): (string | undefined)[] {
	return [c.name, c.role, c.gender, c.appearance, c.personality, c.background];
}

/** 名前・役割・本文のどれかに query(大文字小文字を区別しない)を含む人物。空の query は全件 */
export function filterCharacters(characters: readonly Character[], query: string): Character[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...characters];
	return characters.filter((c) => haystack(c).some((t) => t?.toLowerCase().includes(q)));
}

/** 並び: 手動順(order)、名前順(五十音)、更新日が新しい順 */
export function sortCharacters(characters: readonly Character[], mode: CharacterSort): Character[] {
	if (mode === 'name') {
		return [...characters].sort(
			(a, b) => a.name.localeCompare(b.name, 'ja') || (a.id < b.id ? -1 : 1)
		);
	}
	if (mode === 'updated') return [...characters].sort((a, b) => b.updatedAt - a.updatedAt);
	return sortByOrder(characters);
}

export function visibleCharacters(
	characters: readonly Character[],
	options: { query: string; sort: CharacterSort }
): Character[] {
	return sortCharacters(filterCharacters(characters, options.query), options.sort);
}

/** 並べ替えができるのは、手動順で、絞り込んでいないときだけ(表示の並びが全体の並びと一致するとき) */
export function canReorderCharacters(options: {
	readOnly: boolean;
	sort: CharacterSort;
	query: string;
}): boolean {
	return !options.readOnly && options.sort === 'manual' && options.query.trim() === '';
}

/** 一覧の 2 行目: 役割 ・ 年齢 ・ 性別(あるものだけ) */
export function characterSummary(c: Pick<Character, 'role' | 'age' | 'gender'>): string {
	const parts = [
		c.role?.trim(),
		typeof c.age === 'number' && Number.isFinite(c.age) ? `${c.age}歳` : '',
		c.gender?.trim()
	].filter(Boolean);
	return parts.join(' ・ ');
}

/** id の人物を all(手動順の全体)の toIndex 番目(移動後の位置)へ動かすために書く order の更新 */
export function planCharacterMove(
	characters: readonly Character[],
	id: string,
	toIndex: number
): OrderUpdate[] {
	return moveItem(characters, id, toIndex);
}

/** order の更新を配列に反映した新しい配列(画面の即時反映用。元の配列は変えない) */
export function applyOrderUpdates<T extends { id: string; order?: number }>(
	items: readonly T[],
	updates: readonly OrderUpdate[]
): T[] {
	const byId = new Map(updates.map((u) => [u.id, u.order]));
	return items.map((it) => (byId.has(it.id) ? { ...it, order: byId.get(it.id) } : it));
}
