/**
 * 外部の AI に添削を頼むときに貼り付ける、Markdown の文書を組み立てる(純粋なロジック)。
 * データベースにも画面にも触れない。読み込みは services/reviewExport.service.ts が行う。
 */
import type { Chapter, Character, Plot, Project, Scene, Worldbuilding } from '$lib/types';
import { sortByOrder } from './ordering';
import { removeRuby } from './ruby';

export type ReviewScope = 'chapter' | 'work';

export interface ReviewBundleOptions {
	scope: ReviewScope;
	/** scope が chapter のときの対象の章 */
	chapterId?: string;
	/** ルビ・傍点の記法を取り除く */
	plainText: boolean;
	/** 作品の設定(あらすじ・人物・設定資料・プロット)を前置きに含める */
	includeSettings: boolean;
	/** 添削の依頼文のひな形を先頭に付ける */
	includePrompt: boolean;
}

export interface ReviewBundleInput {
	project: Pick<Project, 'title' | 'description'>;
	chapters: readonly Chapter[];
	scenes: readonly Scene[];
	characters: readonly Character[];
	worldbuilding: readonly Worldbuilding[];
	plots: readonly Plot[];
	/** シーン ID → 本文。無ければ scene.content を使う(共有作品の CRDT の本文など) */
	sceneTexts?: ReadonlyMap<string, string>;
}

export interface ReviewBundle {
	text: string;
	/** 本文(設定・依頼文を除く)の文字数 */
	bodyChars: number;
	/** 全体の文字数 */
	totalChars: number;
	chapterCount: number;
	sceneCount: number;
}

const CATEGORY_LABELS: Record<Worldbuilding['category'], string> = {
	term: '用語',
	timeline: '年表',
	location: '場所',
	other: 'その他'
};

const PLOT_STATUS_LABELS: Record<Plot['status'], string> = {
	idea: 'アイデア',
	planned: '構想済み',
	written: '執筆済み',
	revised: '推敲済み'
};

const PLOT_TYPE_LABELS: Record<Plot['type'], string> = {
	scene: 'シーン',
	chapter: '章',
	arc: '大筋'
};

/** 依頼文のひな形(先頭に付ける) */
export const REVIEW_PROMPT = [
	'以下は私が書いている小説の原稿です。添削をお願いします。',
	'',
	'- 誤字脱字、表記ゆれ、文法の誤りを指摘してください。',
	'- 読みにくい箇所、冗長な箇所、描写や心情の不足を、理由を添えて指摘してください。',
	'- 作品の設定(人物・用語・プロット)との矛盾があれば指摘してください。',
	'- 指摘は「該当箇所の引用 → 問題点 → 修正案」の形式でお願いします。',
	'- 文体や作風は変えず、私の書き方を尊重してください。'
].join('\n');

function body(text: string, plain: boolean): string {
	return plain ? removeRuby(text) : text;
}

function oneLine(text: string): string {
	return text.replace(/\s*\n\s*/g, ' ').trim();
}

function sectionCharacters(characters: readonly Character[], plain: boolean): string {
	if (characters.length === 0) return '';
	const byId = new Map(characters.map((c) => [c.id, c.name]));
	const out: string[] = ['### 登場人物', ''];
	for (const c of sortByOrder(characters)) {
		const meta = [c.role, c.gender, c.age !== undefined ? `${c.age}歳` : '']
			.filter((v) => v && v.trim())
			.join(' / ');
		out.push(`#### ${c.name}${meta ? `(${meta})` : ''}`);
		const fields: [string, string][] = [
			['外見', c.appearance],
			['性格', c.personality],
			['背景', c.background]
		];
		for (const [label, value] of fields) {
			if (value && value.trim()) out.push(`- ${label}: ${oneLine(body(value, plain))}`);
		}
		const relations = c.relationships
			.map((r) => {
				const name = byId.get(r.characterId);
				return name ? `${name}(${r.relation})` : '';
			})
			.filter(Boolean);
		if (relations.length > 0) out.push(`- 関係: ${relations.join('、')}`);
		out.push('');
	}
	return out.join('\n');
}

function sectionWorldbuilding(items: readonly Worldbuilding[], plain: boolean): string {
	if (items.length === 0) return '';
	const out: string[] = ['### 設定資料', ''];
	for (const category of Object.keys(CATEGORY_LABELS) as Worldbuilding['category'][]) {
		const group = sortByOrder(items.filter((i) => i.category === category));
		if (group.length === 0) continue;
		out.push(`#### ${CATEGORY_LABELS[category]}`, '');
		for (const item of group) {
			out.push(`##### ${item.title}`);
			if (item.content.trim()) out.push(body(item.content.trim(), plain));
			out.push('');
		}
	}
	return out.join('\n');
}

function sectionPlots(plots: readonly Plot[], plain: boolean): string {
	if (plots.length === 0) return '';
	const out: string[] = ['### プロット', ''];
	for (const p of sortByOrder(plots)) {
		out.push(`- ${p.title}(${PLOT_TYPE_LABELS[p.type]}・${PLOT_STATUS_LABELS[p.status]})`);
		if (p.content.trim()) {
			out.push(
				...body(p.content.trim(), plain)
					.split('\n')
					.map((line) => `  ${line}`)
			);
		}
	}
	out.push('');
	return out.join('\n');
}

/** 章の並び(order)とシーンの並び(order)で、対象の章とシーンを選ぶ */
function pickTargets(input: ReviewBundleInput, options: ReviewBundleOptions) {
	const sortedChapters = [...input.chapters].sort((a, b) => a.order - b.order);
	const chapters =
		options.scope === 'chapter'
			? sortedChapters.filter((c) => c.id === options.chapterId)
			: sortedChapters;
	return chapters.map((chapter) => ({
		chapter,
		// 章の通し番号は作品全体での位置(章だけ出すときも「第N章」がずれない)
		number: sortedChapters.findIndex((c) => c.id === chapter.id) + 1,
		scenes: input.scenes.filter((s) => s.chapterId === chapter.id).sort((a, b) => a.order - b.order)
	}));
}

/** 添削用の Markdown を組み立てる */
export function buildReviewBundle(
	input: ReviewBundleInput,
	options: ReviewBundleOptions
): ReviewBundle {
	const targets = pickTargets(input, options);
	const parts: string[] = [];

	if (options.includePrompt) parts.push(REVIEW_PROMPT, '', '---', '');

	parts.push(`# ${input.project.title}`, '');
	if (options.scope === 'chapter' && targets[0]) {
		parts.push(
			`(添削の対象: 第${targets[0].number}章「${targets[0].chapter.title}」のみ。作品全体の一部です)`,
			''
		);
	}

	let settings = '';
	if (options.includeSettings) {
		const blocks: string[] = [];
		if (input.project.description?.trim()) {
			blocks.push(
				'### 作品の概要',
				'',
				body(input.project.description.trim(), options.plainText),
				''
			);
		}
		const synopses = targets
			.filter((t) => t.chapter.synopsis?.trim())
			.map(
				(t) =>
					`- 第${t.number}章 ${t.chapter.title}: ${oneLine(body(t.chapter.synopsis, options.plainText))}`
			);
		if (synopses.length > 0) blocks.push('### 章のあらすじ', '', ...synopses, '');
		blocks.push(
			sectionCharacters(input.characters, options.plainText),
			sectionWorldbuilding(input.worldbuilding, options.plainText),
			sectionPlots(input.plots, options.plainText)
		);
		const joined = blocks.filter(Boolean).join('\n').trim();
		if (joined) settings = `## 作品の設定(参考資料。添削の対象ではありません)\n\n${joined}\n`;
	}
	if (settings) parts.push(settings, '', '---', '');

	parts.push('## 本文(添削の対象)', '');
	let bodyChars = 0;
	let sceneCount = 0;
	for (const { chapter, number, scenes } of targets) {
		parts.push(`### 第${number}章 ${chapter.title}`, '');
		for (const scene of scenes) {
			const raw = input.sceneTexts?.get(scene.id) ?? scene.content;
			const text = body(raw, options.plainText).trim();
			sceneCount += 1;
			bodyChars += text.length;
			parts.push(`#### ${scene.title || `シーン${scene.order + 1}`}`, '', text, '');
		}
	}

	const text = `${parts
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()}\n`;
	return {
		text,
		bodyChars,
		totalChars: text.length,
		chapterCount: targets.length,
		sceneCount
	};
}

/** 貼り付け先(チャット)に入りきらない恐れがある大きさ。文字数で目安を示す */
export const LARGE_PASTE_CHARS = 100_000;
