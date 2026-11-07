import { describe, it, expect } from 'vitest';
import { TOOLBAR_ITEMS, normalizeMenuIds, setInMenu, splitToolbar } from './toolbarItems';

describe('splitToolbar', () => {
	it('未設定なら、現在と同じく全部ツールバーに出す(メニューは空)', () => {
		const { pinned, menu } = splitToolbar(undefined, { desktop: true });
		expect(pinned.map((i) => i.id)).toEqual(TOOLBAR_ITEMS.map((i) => i.id));
		expect(menu).toEqual([]);
	});

	it('メニューへまとめた項目は、メニュー側へ移る(登録順)', () => {
		const { pinned, menu } = splitToolbar(['print', 'export'], { desktop: true });
		expect(menu.map((i) => i.id)).toEqual(['export', 'print']);
		expect(pinned.some((i) => i.id === 'export' || i.id === 'print')).toBe(false);
		expect(pinned.length + menu.length).toBe(TOOLBAR_ITEMS.length);
	});

	it('AI はデスクトップ版以外では、どちらにも出さない', () => {
		const web = splitToolbar([], { desktop: false });
		expect(web.pinned.some((i) => i.id === 'ai')).toBe(false);
		expect(splitToolbar(['ai'], { desktop: false }).menu).toEqual([]);
	});
});

describe('normalizeMenuIds / setInMenu', () => {
	it('不明な id・重複・不正な型を捨てる', () => {
		expect(normalizeMenuIds(['print', 'nope', 'print', 3])).toEqual(['print']);
		expect(normalizeMenuIds('x')).toEqual([]);
		expect(normalizeMenuIds(undefined)).toEqual([]);
	});

	it('切り替えで追加・削除できる', () => {
		expect(setInMenu([], 'search', true)).toEqual(['search']);
		expect(setInMenu(['search', 'print'], 'search', false)).toEqual(['print']);
		expect(setInMenu(['print'], 'unknown', true)).toEqual(['print']);
	});
});
