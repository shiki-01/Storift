/**
 * 執筆画面のツールバー(デスクトップ/タブレット)の、並べ替えできる操作ボタン。
 * ユーザーは各ボタンの並び順を変え、「ツールバーに常時表示する」か「三点メニュー(…)にまとめる」かを選べる。
 * 保存するのは次の 2 つ(どちらも未設定なら従来どおり: 既定の順で全部表示。あとで増えたボタンも既定では表示される)
 * - toolbarMenuItems: メニューへまとめるボタンの id
 * - toolbarOrder: ボタンの並び(id の配列)
 * 有効な拡張が出す項目は `ext:<拡張 ID>` の id で、組み込みのボタンと同じ仕組みで並べ替え・まとめができる。
 * 拡張が無効/非対応の間も、その id は保存値に残す(再び有効にしたとき、以前の位置・設定に戻る)。
 * AI パネルのボタンは並べ替えの対象外で、デスクトップ版のとき区切りの後ろ(右端側)に固定する。
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

const BUILTIN_ITEMS = [
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
] as const satisfies readonly ToolbarItem[];

/** 組み込みのボタンの id */
export type ToolbarItemId = (typeof BUILTIN_ITEMS)[number]['id'];

/** ツールバーに並ぶ既定の順。AI だけは並べ替えの対象外で、区切りの後ろに置く */
export const TOOLBAR_ITEMS: readonly (ToolbarItem & { id: ToolbarItemId })[] = BUILTIN_ITEMS;

export const TOOLBAR_ITEM_IDS: readonly string[] = TOOLBAR_ITEMS.map((i) => i.id);

/** 並べ替えの対象外で、末尾側に固定するボタン */
export const FIXED_LAST_ID: ToolbarItemId = 'ai';

/** 拡張が出す項目の id の接頭辞(registry.ts の EXTENSION_TOOLBAR_PREFIX と同じ値) */
const EXT_PREFIX = 'ext:';

export function isExtensionItemId(id: string): boolean {
	return id.startsWith(EXT_PREFIX) && id.length > EXT_PREFIX.length;
}

type Env = { desktop: boolean };

function strings(raw: unknown): string[] {
	return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/** 保存値の「メニューへまとめる id」を、存在する組み込みのボタン(登録順)+ 拡張の id(保存順)にそろえる。重複・不明な id は捨てる */
export function normalizeMenuIds(raw: unknown): string[] {
	const set = new Set(strings(raw));
	return [
		...TOOLBAR_ITEM_IDS.filter((id) => set.has(id)),
		...[...set].filter((id) => isExtensionItemId(id))
	];
}

/** 並べ替えの対象になるボタンの既定の並び(組み込み → 拡張。AI と、環境に合わないものは除く) */
function defaultOrder(env: Env, extensions: readonly ToolbarItem[]): string[] {
	return [
		...TOOLBAR_ITEMS.filter((i) => i.id !== FIXED_LAST_ID && (env.desktop || !i.desktopOnly)).map(
			(i) => i.id
		),
		...extensions.map((i) => i.id)
	];
}

/**
 * 保存された並びを、いま使えるボタンの並びにそろえる。
 * 使えない id(不明・無効な拡張・Web 版でのデスクトップ専用)と重複は除き、足りないボタンは既定の順で末尾に足す。
 * AI は含まない。未設定(空)なら既定の並び
 */
export function normalizeOrder(
	raw: unknown,
	env: Env,
	extensions: readonly ToolbarItem[] = []
): string[] {
	const base = defaultOrder(env, extensions);
	const usable = new Set(base);
	const seen = new Set<string>();
	const result: string[] = [];
	for (const id of strings(raw)) {
		if (usable.has(id) && !seen.has(id)) {
			seen.add(id);
			result.push(id);
		}
	}
	for (const id of base) if (!seen.has(id)) result.push(id);
	return result;
}

/** order の中の id を toIndex(移動後の位置・0 始まり)へ動かした新しい配列。範囲外は端に丸め、id が無ければそのまま */
export function moveItem(order: readonly string[], id: string, toIndex: number): string[] {
	const from = order.indexOf(id);
	if (from < 0) return [...order];
	const next = order.filter((_, i) => i !== from);
	const to = Math.min(Math.max(0, Math.trunc(toIndex)), next.length);
	next.splice(to, 0, id);
	return next;
}

/**
 * 画面に出ている並び(visible)を動かした結果を、保存する並びにする。
 * 保存値にだけ残っている id(無効な拡張の項目)はその位置に残し、見えている id の位置だけを入れ替える
 */
export function applyVisibleOrder(stored: unknown, visible: readonly string[]): string[] {
	const keep = new Set(visible);
	const rest = [...visible];
	const result: string[] = [];
	const seen = new Set<string>();
	for (const id of strings(stored)) {
		if (seen.has(id)) continue;
		seen.add(id);
		if (keep.has(id)) {
			const next = rest.shift();
			if (next !== undefined) result.push(next);
		} else if (isExtensionItemId(id)) {
			result.push(id);
		}
	}
	return [...result, ...rest];
}

/** id を toIndex へ動かした、保存する並び。ツールバーの設定の「並べ替え」の結果 */
export function reorderStored(
	stored: unknown,
	id: string,
	toIndex: number,
	env: Env,
	extensions: readonly ToolbarItem[] = []
): string[] {
	const visible = normalizeOrder(stored, env, extensions);
	return applyVisibleOrder(stored, moveItem(visible, id, toIndex));
}

/** 並べ替えできるボタンを並び順に、続けて(あれば)末尾固定の AI を返す。ツールバー・メニュー・設定の一覧の元 */
export function orderedItems(
	order: unknown,
	env: Env,
	extensions: readonly ToolbarItem[] = []
): ToolbarItem[] {
	const byId = new Map<string, ToolbarItem>(
		[...TOOLBAR_ITEMS, ...extensions].map((i) => [i.id, i])
	);
	const items = normalizeOrder(order, env, extensions).map((id) => byId.get(id)!);
	const last = TOOLBAR_ITEMS.find((i) => i.id === FIXED_LAST_ID);
	if (last && (env.desktop || !last.desktopOnly)) items.push(last);
	return items;
}

/**
 * 使えるボタン(デスクトップ専用は、デスクトップ版でだけ)を、ツールバーとメニューに分ける。
 * どちらも order の順(order 未設定なら既定の順)。AI は pinned の最後(メニューに入れた場合は menu の最後)
 */
export function splitToolbar(
	menuIds: unknown,
	env: Env,
	options: { order?: unknown; extensions?: readonly ToolbarItem[] } = {}
): { pinned: ToolbarItem[]; menu: ToolbarItem[] } {
	const inMenu = new Set(normalizeMenuIds(menuIds));
	const items = orderedItems(options.order, env, options.extensions ?? []);
	return {
		pinned: items.filter((i) => !inMenu.has(i.id)),
		menu: items.filter((i) => inMenu.has(i.id))
	};
}

/** id をメニューへ移す / ツールバーへ戻した結果の、保存する id の一覧(無効な拡張の id も残す) */
export function setInMenu(menuIds: unknown, id: string, inMenu: boolean): string[] {
	const set = new Set(normalizeMenuIds(menuIds));
	if (!TOOLBAR_ITEM_IDS.includes(id) && !isExtensionItemId(id)) return [...set];
	if (inMenu) set.add(id);
	else set.delete(id);
	return normalizeMenuIds([...set]);
}
