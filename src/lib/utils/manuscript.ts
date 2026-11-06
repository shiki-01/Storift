/**
 * 作品全体の通読プレビュー用の、章・シーンの並べ替えと文字数の集計(純粋なロジック)。
 * 画面(描画・スクロール)には触れない。
 */
import type { Chapter, Scene } from '$lib/types';
import { removeRuby } from './ruby';

/** どの章にも属さないシーンをまとめる擬似章の ID */
export const ORPHAN_CHAPTER_ID = '__orphan__';

export interface ManuscriptOptions {
	/** 章に属さないシーンをまとめる擬似章の名前 */
	orphanChapterTitle?: string;
	/** 題名が空の章の表示名 */
	untitledChapterTitle?: string;
	/** 題名が空のシーンの表示名 */
	untitledSceneTitle?: string;
	/** true なら、ルビ・傍点の記法を除いた文字数で数える(既定はエディタと同じ content.length) */
	excludeRubyFromCount?: boolean;
}

export interface ManuscriptScene {
	id: string;
	title: string;
	content: string;
	chapterId: string;
	/** 作品全体での通し番号(0 始まり) */
	index: number;
	/** 章の中での番号(0 始まり) */
	indexInChapter: number;
	charCount: number;
	/** このシーンより前の累計文字数 */
	startChars: number;
	/** 本文が空白だけ */
	isEmpty: boolean;
}

export interface ManuscriptChapter {
	id: string;
	title: string;
	/** 章の通し番号(0 始まり) */
	index: number;
	/** どの章にも属さないシーンをまとめた擬似章 */
	orphan: boolean;
	scenes: ManuscriptScene[];
	charCount: number;
	startChars: number;
}

export interface TocScene {
	id: string;
	title: string;
	charCount: number;
	startChars: number;
	isEmpty: boolean;
}

export interface TocChapter {
	id: string;
	title: string;
	orphan: boolean;
	charCount: number;
	startChars: number;
	scenes: TocScene[];
}

export interface Manuscript {
	chapters: ManuscriptChapter[];
	/** 全シーンを読む順に並べたもの */
	scenes: ManuscriptScene[];
	/** 本文を持たない目次用の構造 */
	toc: TocChapter[];
	totalChars: number;
	sceneIndexById: Map<string, number>;
}

export interface ReadingProgress {
	/** 0〜1 */
	fraction: number;
	readChars: number;
	totalChars: number;
}

interface Ordered {
	order: number;
	createdAt: number;
	id: string;
}

/** 並び順(order)、同じなら作成日時、さらに同じなら ID で安定して並べる */
function compareOrdered(a: Ordered, b: Ordered): number {
	return a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * 章・シーンを読む順に並べ、目次と文字数の累計を作る。
 * - 章は order 順、章内のシーンも order 順
 * - 章に属さない(章が見つからない)シーンは、最後に擬似章としてまとめる
 * - ID が重複した項目は最初の 1 つだけ使う
 * 計算量は並べ替え(O(n log n))を除き線形。
 */
export function buildManuscript(
	chapters: readonly Chapter[],
	scenes: readonly Scene[],
	options: ManuscriptOptions = {}
): Manuscript {
	const orphanTitle = options.orphanChapterTitle ?? '章に属さないシーン';
	const untitledChapter = options.untitledChapterTitle ?? '無題の章';
	const untitledScene = options.untitledSceneTitle ?? '無題のシーン';

	const uniqueChapters = new Map<string, Chapter>();
	for (const c of chapters) if (!uniqueChapters.has(c.id)) uniqueChapters.set(c.id, c);
	const orderedChapters = [...uniqueChapters.values()].sort(compareOrdered);

	const byChapter = new Map<string, Scene[]>();
	const orphans: Scene[] = [];
	const seenScenes = new Set<string>();
	for (const s of scenes) {
		if (seenScenes.has(s.id)) continue;
		seenScenes.add(s.id);
		if (uniqueChapters.has(s.chapterId)) {
			const list = byChapter.get(s.chapterId);
			if (list) list.push(s);
			else byChapter.set(s.chapterId, [s]);
		} else {
			orphans.push(s);
		}
	}

	const result: Manuscript = {
		chapters: [],
		scenes: [],
		toc: [],
		totalChars: 0,
		sceneIndexById: new Map()
	};
	let cumulative = 0;

	const addChapter = (id: string, title: string, orphan: boolean, list: Scene[]) => {
		list.sort(compareOrdered);
		const chapterStart = cumulative;
		const chapterScenes: ManuscriptScene[] = [];
		const tocScenes: TocScene[] = [];
		list.forEach((s, indexInChapter) => {
			const content = s.content ?? '';
			const charCount = options.excludeRubyFromCount ? removeRuby(content).length : content.length;
			const isEmpty = content.trim() === '';
			const scene: ManuscriptScene = {
				id: s.id,
				title: s.title?.trim() ? s.title : untitledScene,
				content,
				chapterId: id,
				index: result.scenes.length,
				indexInChapter,
				charCount,
				startChars: cumulative,
				isEmpty
			};
			cumulative += charCount;
			result.sceneIndexById.set(scene.id, scene.index);
			result.scenes.push(scene);
			chapterScenes.push(scene);
			tocScenes.push({
				id: scene.id,
				title: scene.title,
				charCount,
				startChars: scene.startChars,
				isEmpty
			});
		});
		const chapterTitle = title?.trim() ? title : untitledChapter;
		const index = result.chapters.length;
		const charCount = cumulative - chapterStart;
		result.chapters.push({
			id,
			title: chapterTitle,
			index,
			orphan,
			scenes: chapterScenes,
			charCount,
			startChars: chapterStart
		});
		result.toc.push({
			id,
			title: chapterTitle,
			orphan,
			charCount,
			startChars: chapterStart,
			scenes: tocScenes
		});
	};

	for (const chapter of orderedChapters) {
		addChapter(chapter.id, chapter.title, false, byChapter.get(chapter.id) ?? []);
	}
	if (orphans.length > 0) addChapter(ORPHAN_CHAPTER_ID, orphanTitle, true, orphans);

	result.totalChars = cumulative;
	return result;
}

/**
 * 読んだ位置(シーン番号 + そのシーン内の割合 0〜1)から、全体に対する進捗を求める。
 * 範囲外のシーン番号・割合は丸める。
 */
export function progressAt(
	manuscript: Pick<Manuscript, 'scenes' | 'totalChars'>,
	sceneIndex: number,
	ratio: number
): ReadingProgress {
	const total = manuscript.totalChars;
	const scene = manuscript.scenes[Math.min(Math.max(sceneIndex, 0), manuscript.scenes.length - 1)];
	if (!scene || total <= 0) return { fraction: 0, readChars: 0, totalChars: Math.max(total, 0) };
	const r = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
	const readChars = Math.min(total, Math.round(scene.startChars + scene.charCount * r));
	return { fraction: readChars / total, readChars, totalChars: total };
}

/**
 * 本文を折り返した時のおおよその行数(未描画のシーンの大きさの見積り用)。
 * 改行で分けた段落ごとに、空行も 1 行として数える。
 */
export function estimateLines(content: string, charsPerLine: number): number {
	const per = Math.max(1, Math.floor(charsPerLine));
	let lines = 0;
	let from = 0;
	for (;;) {
		const nl = content.indexOf('\n', from);
		const len = (nl === -1 ? content.length : nl) - from;
		lines += Math.max(1, Math.ceil(len / per));
		if (nl === -1) break;
		from = nl + 1;
	}
	return lines;
}

/**
 * 読み込み直したデータが、表示中のものと(表示に影響する範囲で)同じか。
 * 同じなら再構築・再描画をしない。
 */
export function isSameSource(
	a: { chapters: readonly Chapter[]; scenes: readonly Scene[] },
	b: { chapters: readonly Chapter[]; scenes: readonly Scene[] }
): boolean {
	if (a.chapters.length !== b.chapters.length || a.scenes.length !== b.scenes.length) return false;
	for (let i = 0; i < a.chapters.length; i++) {
		const x = a.chapters[i];
		const y = b.chapters[i];
		if (x.id !== y.id || x.title !== y.title || x.order !== y.order) return false;
	}
	for (let i = 0; i < a.scenes.length; i++) {
		const x = a.scenes[i];
		const y = b.scenes[i];
		if (
			x.id !== y.id ||
			x.chapterId !== y.chapterId ||
			x.title !== y.title ||
			x.order !== y.order ||
			x.content !== y.content
		) {
			return false;
		}
	}
	return true;
}
