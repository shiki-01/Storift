/**
 * 開いている画面の判定(拡張向けの `page:change` イベント用)。ルート(`src/routes`)のパスから、
 * 固定の画面 ID を導く純関数。作品名・本文などは扱わない
 */

export type PageId =
	| 'home'
	| 'editor'
	| 'plot'
	| 'characters'
	| 'worldbuilding'
	| 'progress'
	| 'preview'
	| 'settings'
	| 'other';

export interface PageInfo {
	page: PageId;
	/** 作品の画面(/project/<id>/…)のときの作品 ID */
	projectId?: string;
}

/** 画面ごとの固定の表示名(拡張が「いまの画面」を表示するときの既定) */
export const PAGE_LABELS: Record<PageId, string> = {
	home: 'ホーム',
	editor: '執筆中',
	plot: 'プロットを練っています',
	characters: '人物を整理しています',
	worldbuilding: '世界観を作っています',
	progress: '進捗を見ています',
	preview: '通読しています',
	settings: '設定を開いています',
	other: 'Storift'
};

const PROJECT_PAGES: Record<string, PageId> = {
	editor: 'editor',
	plot: 'plot',
	characters: 'characters',
	worldbuilding: 'worldbuilding',
	progress: 'progress',
	preview: 'preview'
};

/** URL のパス名から、開いている画面を求める。知らないパスは 'other' */
export function pageFromPath(pathname: string): PageInfo {
	const segments = pathname.split('/').filter(Boolean);
	const [first, second, third] = segments;
	if (first === undefined || first === 'home') return { page: 'home' };
	if (first === 'settings') return { page: 'settings' };
	if (first === 'project' && second) {
		const page = third ? PROJECT_PAGES[third] : undefined;
		return page ? { page, projectId: decodeURIComponent(second) } : { page: 'other' };
	}
	return { page: 'other' };
}

export function pageLabel(page: PageId): string {
	return PAGE_LABELS[page];
}
