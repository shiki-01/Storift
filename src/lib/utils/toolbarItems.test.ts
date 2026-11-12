import { describe, it, expect } from 'vitest';
import {
	TOOLBAR_ITEMS,
	applyVisibleOrder,
	moveItem,
	normalizeMenuIds,
	normalizeOrder,
	orderedItems,
	reorderStored,
	setInMenu,
	splitToolbar,
	type ToolbarItem
} from './toolbarItems';

const EXT: ToolbarItem[] = [{ id: 'ext:monolog', label: 'Monolog.', icon: 'clock' }];
const DESKTOP = { desktop: true };
const WEB = { desktop: false };
const DEFAULT_IDS = TOOLBAR_ITEMS.map((i) => i.id);
const DEFAULT_NO_AI = DEFAULT_IDS.filter((id) => id !== 'ai');

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

describe('後方互換(toolbarOrder 未設定)', () => {
	it('順序・拡張なしの結果は、従来の登録順と同じ', () => {
		expect(splitToolbar(['print'], DESKTOP).pinned.map((i) => i.id)).toEqual(
			DEFAULT_IDS.filter((id) => id !== 'print')
		);
		expect(splitToolbar(undefined, WEB).pinned.map((i) => i.id)).toEqual(DEFAULT_NO_AI);
		expect(normalizeOrder(undefined, DESKTOP)).toEqual(DEFAULT_NO_AI);
		expect(normalizeOrder([], DESKTOP)).toEqual(DEFAULT_NO_AI);
	});
});

describe('normalizeOrder', () => {
	it('未知の id・重複・不正な型を除き、足りない id は既定の順で末尾に足す', () => {
		const order = normalizeOrder(['print', 'nope', 'print', 3, 'export'], DESKTOP);
		expect(order.slice(0, 2)).toEqual(['print', 'export']);
		expect(order.slice(2)).toEqual(DEFAULT_NO_AI.filter((id) => id !== 'print' && id !== 'export'));
		expect(new Set(order).size).toBe(order.length);
	});

	it('AI は並びに含めない(保存値にあっても除く)', () => {
		expect(normalizeOrder(['ai', 'print'], DESKTOP)).not.toContain('ai');
	});

	it('拡張の項目は、利用可能なときだけ含める(既定は組み込みの後ろ)', () => {
		expect(normalizeOrder(undefined, DESKTOP, EXT)).toEqual([...DEFAULT_NO_AI, 'ext:monolog']);
		expect(normalizeOrder(['ext:monolog', 'print'], DESKTOP, EXT).slice(0, 2)).toEqual([
			'ext:monolog',
			'print'
		]);
		expect(normalizeOrder(['ext:monolog'], DESKTOP, [])).not.toContain('ext:monolog');
	});
});

describe('moveItem', () => {
	it('指定の位置へ動かす(範囲外は端に丸める)', () => {
		expect(moveItem(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
		expect(moveItem(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
		expect(moveItem(['a', 'b', 'c'], 'b', 99)).toEqual(['a', 'c', 'b']);
		expect(moveItem(['a', 'b', 'c'], 'b', -5)).toEqual(['b', 'a', 'c']);
	});

	it('存在しない id は何もしない。元の配列は変えない', () => {
		const src = ['a', 'b'];
		expect(moveItem(src, 'x', 0)).toEqual(['a', 'b']);
		moveItem(src, 'a', 1);
		expect(src).toEqual(['a', 'b']);
	});
});

describe('splitToolbar と順序', () => {
	it('順序を pinned / menu の両方に反映し、AI は最後に固定する', () => {
		const { pinned, menu } = splitToolbar(['export', 'ai'], DESKTOP, {
			order: ['memo', 'export', 'print']
		});
		expect(pinned[0].id).toBe('memo');
		expect(menu.map((i) => i.id)).toEqual(['export', 'ai']);
		expect(pinned.some((i) => i.id === 'ai')).toBe(false);
		expect(splitToolbar([], DESKTOP, { order: ['memo'] }).pinned.at(-1)?.id).toBe('ai');
	});

	it('拡張の項目を同じ仕組みで並べ替え・メニューへまとめられる', () => {
		const a = splitToolbar([], DESKTOP, { order: ['ext:monolog'], extensions: EXT });
		expect(a.pinned[0].id).toBe('ext:monolog');
		const b = splitToolbar(['ext:monolog'], DESKTOP, { extensions: EXT });
		expect(b.menu.map((i) => i.id)).toEqual(['ext:monolog']);
	});

	it('拡張が使えないときは、順序・メニューの保存値に残っていても出さない', () => {
		const r = splitToolbar(['ext:monolog'], DESKTOP, { order: ['ext:monolog'], extensions: [] });
		expect([...r.pinned, ...r.menu].some((i) => i.id === 'ext:monolog')).toBe(false);
		expect(r.pinned.map((i) => i.id)).toEqual(DEFAULT_IDS);
	});

	it('orderedItems は並べ替えできるものの後ろに AI を置く(Web 版では置かない)', () => {
		expect(orderedItems(undefined, DESKTOP).at(-1)?.id).toBe('ai');
		expect(orderedItems(undefined, WEB).some((i) => i.id === 'ai')).toBe(false);
	});
});

describe('保存値の更新', () => {
	it('reorderStored は画面上の位置へ動かした保存用の並びを返す', () => {
		const next = reorderStored(undefined, 'memo', 0, DESKTOP);
		expect(next[0]).toBe('memo');
		expect(next).toHaveLength(DEFAULT_NO_AI.length);
	});

	it('無効な拡張の id は保存値に残り、位置も保たれる', () => {
		// 拡張が無効(extensions=[])の間に組み込みを動かしても、ext:monolog は消えない
		const stored = ['assist', 'ext:monolog', 'export'];
		const next = reorderStored(stored, 'export', 0, DESKTOP, []);
		expect(next).toContain('ext:monolog');
		expect(next.indexOf('export')).toBe(0);
		// 再び有効にすると、残っていた位置(組み込みの 2 番目の前のまま)に現れる
		const shown = normalizeOrder(next, DESKTOP, EXT);
		expect(shown.indexOf('ext:monolog')).toBe(1);
	});

	it('applyVisibleOrder は見えていない項目の位置を動かさない', () => {
		expect(applyVisibleOrder(['a', 'ext:x', 'b'], ['b', 'a'])).toEqual(['b', 'ext:x', 'a']);
		expect(applyVisibleOrder(undefined, ['a', 'b'])).toEqual(['a', 'b']);
	});

	it('メニューの保存値にも、無効な拡張の id は残る', () => {
		expect(normalizeMenuIds(['ext:monolog', 'print'])).toEqual(['print', 'ext:monolog']);
		expect(setInMenu(['ext:monolog'], 'print', true)).toEqual(['print', 'ext:monolog']);
		expect(setInMenu([], 'ext:monolog', true)).toEqual(['ext:monolog']);
	});
});
