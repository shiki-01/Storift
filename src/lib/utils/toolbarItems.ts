/**
 * 執筆画面のツールバー(デスクトップ/タブレット)の、並べ替えできる操作ボタン。
 * ユーザーは各ボタンを「ツールバーに常時表示する」か「三点メニュー(…)にまとめる」かを選べる。
 * 保存するのは、メニューへまとめるボタンの id だけ(未設定は全部表示。あとで増えたボタンも既定では表示される)。
 * 書式設定・表示モードの切替・保存状態は常に表示する。スマホの上部バー/操作シートはこの設定に従わない。
 */

export interface ToolbarItem {
	id: string;
	label: string;
	/** Icon.svelte の名前 */
	icon: string;
	shortcut?: string;
	/** デスクトップ版(Tauri)だけの機能 */
	desktopOnly?: boolean;
}

/** ツールバーに並ぶ順。AI だけは区切りの後ろに置く */
export const TOOLBAR_ITEMS: readonly ToolbarItem[] = [
	{ id: 'assist', label: '執筆支援', icon: 'pencil-bolt' },
	{ id: 'export', label: 'エクスポート', icon: 'download' },
	{ id: 'review', label: 'AI 添削用にコピー', icon: 'copy' },
	{ id: 'manuscript', label: '作品全体を通して読む', icon: 'book-2' },
	{ id: 'print', label: '印刷プレビュー', icon: 'printer' },
	{ id: 'history', label: 'バージョン履歴', icon: 'history' },
	{ id: 'proofread', label: '校正', icon: 'abc' },
	{ id: 'search', label: '検索・置換', icon: 'search', shortcut: 'Ctrl+Shift+F' },
	{ id: 'focus', label: '集中モード', icon: 'wallpaper' },
	{ id: 'memo', label: 'メモ', icon: 'clipboard-text', shortcut: 'Ctrl+Shift+M' },
	{ id: 'ai', label: 'AI パネル', icon: 'sparkles', shortcut: 'Ctrl+Shift+L', desktopOnly: true }
];

export const TOOLBAR_ITEM_IDS: readonly string[] = TOOLBAR_ITEMS.map((i) => i.id);

/** 保存値を、存在するボタンの id だけ(重複なし・登録順)にそろえる */
export function normalizeMenuIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const set = new Set(raw.filter((v): v is string => typeof v === 'string'));
	return TOOLBAR_ITEM_IDS.filter((id) => set.has(id));
}

/** 使えるボタン(デスクトップ専用は、デスクトップ版でだけ)を、ツールバーとメニューに分ける */
export function splitToolbar(
	menuIds: unknown,
	env: { desktop: boolean }
): { pinned: ToolbarItem[]; menu: ToolbarItem[] } {
	const inMenu = new Set(normalizeMenuIds(menuIds));
	const available = TOOLBAR_ITEMS.filter((i) => env.desktop || !i.desktopOnly);
	return {
		pinned: available.filter((i) => !inMenu.has(i.id)),
		menu: available.filter((i) => inMenu.has(i.id))
	};
}

/** id をメニューへ移す / ツールバーへ戻した結果の、保存する id の一覧 */
export function setInMenu(menuIds: unknown, id: string, inMenu: boolean): string[] {
	const set = new Set(normalizeMenuIds(menuIds));
	if (!TOOLBAR_ITEM_IDS.includes(id)) return [...set];
	if (inMenu) set.add(id);
	else set.delete(id);
	return normalizeMenuIds([...set]);
}
