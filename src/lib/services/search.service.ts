import { db } from '$lib/db';
import type { Scene } from '$lib/types/scene';
import type { Chapter } from '$lib/types/chapter';
import type { Character } from '$lib/types/character';
import type { Plot } from '$lib/types/plot';
import type { Worldbuilding } from '$lib/types/worldbuilding';

export interface SearchOptions {
	query: string;
	caseSensitive?: boolean;
	wholeWord?: boolean;
	regex?: boolean;
	scopes?: Array<'scenes' | 'chapters' | 'characters' | 'plots' | 'worldbuilding'>;
}

export interface SearchResult {
	type: 'scene' | 'chapter' | 'character' | 'plot' | 'worldbuilding';
	id: string;
	title: string;
	preview: string;
	matches: number;
	highlights: Array<{ start: number; end: number; line: number }>;
	data: Scene | Chapter | Character | Plot | Worldbuilding;
}

export interface ReplaceOptions extends SearchOptions {
	replaceWith: string;
	replaceAll?: boolean;
}

/**
 * プロジェクト内を検索
 */
export async function searchInProject(
	projectId: string,
	options: SearchOptions
): Promise<SearchResult[]> {
	const results: SearchResult[] = [];
	const scopes = options.scopes || ['scenes', 'chapters', 'characters', 'plots', 'worldbuilding'];

	// 検索パターンの作成
	const pattern = createSearchPattern(options);

	// シーンを検索
	if (scopes.includes('scenes')) {
		const scenes = await db.scenes.where('projectId').equals(projectId).toArray();
		for (const scene of scenes) {
			const matches = findMatches(scene.content, pattern);
			if (matches.length > 0) {
				results.push({
					type: 'scene',
					id: scene.id,
					title: scene.title,
					preview: createPreview(scene.content, matches[0].start),
					matches: matches.length,
					highlights: matches,
					data: scene
				});
			}
		}
	}

	// 章を検索
	if (scopes.includes('chapters')) {
		const chapters = await db.chapters.where('projectId').equals(projectId).toArray();
		for (const chapter of chapters) {
			const searchText = `${chapter.title} ${chapter.synopsis}`;
			const matches = findMatches(searchText, pattern);
			if (matches.length > 0) {
				results.push({
					type: 'chapter',
					id: chapter.id,
					title: chapter.title,
					preview: createPreview(searchText, matches[0].start),
					matches: matches.length,
					highlights: matches,
					data: chapter
				});
			}
		}
	}

	// キャラクターを検索
	if (scopes.includes('characters')) {
		const characters = await db.characters.where('projectId').equals(projectId).toArray();
		for (const character of characters) {
			const searchText = `${character.name} ${character.appearance} ${character.personality} ${character.background}`;
			const matches = findMatches(searchText, pattern);
			if (matches.length > 0) {
				results.push({
					type: 'character',
					id: character.id,
					title: character.name,
					preview: createPreview(searchText, matches[0].start),
					matches: matches.length,
					highlights: matches,
					data: character
				});
			}
		}
	}

	// プロットを検索
	if (scopes.includes('plots')) {
		const plots = await db.plots.where('projectId').equals(projectId).toArray();
		for (const plot of plots) {
			const searchText = `${plot.title} ${plot.content}`;
			const matches = findMatches(searchText, pattern);
			if (matches.length > 0) {
				results.push({
					type: 'plot',
					id: plot.id,
					title: plot.title,
					preview: createPreview(searchText, matches[0].start),
					matches: matches.length,
					highlights: matches,
					data: plot
				});
			}
		}
	}

	// 設定資料を検索
	if (scopes.includes('worldbuilding')) {
		const worldbuilding = await db.worldbuilding.where('projectId').equals(projectId).toArray();
		for (const item of worldbuilding) {
			const searchText = `${item.title} ${item.content}`;
			const matches = findMatches(searchText, pattern);
			if (matches.length > 0) {
				results.push({
					type: 'worldbuilding',
					id: item.id,
					title: item.title,
					preview: createPreview(searchText, matches[0].start),
					matches: matches.length,
					highlights: matches,
					data: item
				});
			}
		}
	}

	return results;
}

/**
 * プロジェクト内で置換
 */
export async function replaceInProject(
	projectId: string,
	options: ReplaceOptions
): Promise<{
	replaced: number;
	sceneIds: string[];
}> {
	const pattern = createSearchPattern(options);
	const sceneIds: string[] = [];
	let replaced = 0;

	// シーン内を置換
	const scenes = await db.scenes.where('projectId').equals(projectId).toArray();

	for (const scene of scenes) {
		const newContent = options.replaceAll
			? scene.content.replace(pattern, options.replaceWith)
			: scene.content.replace(pattern, options.replaceWith);

		if (newContent !== scene.content) {
			// マッチ数をカウント
			const matches = scene.content.match(new RegExp(pattern, 'g'));
			replaced += matches ? matches.length : 0;

			// 更新
			await db.scenes.update(scene.id, {
				content: newContent,
				characterCount: newContent.length,
				updatedAt: Date.now(),
				_version: scene._version + 1
			});

			sceneIds.push(scene.id);
		}
	}

	return { replaced, sceneIds };
}

/**
 * 検索パターンを作成
 */
function createSearchPattern(options: SearchOptions): RegExp {
	let pattern = options.query;

	if (!options.regex) {
		// 正規表現の特殊文字をエスケープ
		pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	if (options.wholeWord) {
		pattern = `\\b${pattern}\\b`;
	}

	const flags = options.caseSensitive ? 'g' : 'gi';
	return new RegExp(pattern, flags);
}

/**
 * テキスト内のマッチを検索
 */
function findMatches(
	text: string,
	pattern: RegExp
): Array<{ start: number; end: number; line: number }> {
	const matches: Array<{ start: number; end: number; line: number }> = [];
	let match: RegExpExecArray | null;

	// 行番号を計算するためのマップ
	const lines = text.split('\n');
	const lineStarts = [0];
	for (let i = 0; i < lines.length - 1; i++) {
		lineStarts.push(lineStarts[i] + lines[i].length + 1);
	}

	while ((match = pattern.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;

		// 行番号を計算
		let line = 0;
		for (let i = 0; i < lineStarts.length; i++) {
			if (start >= lineStarts[i]) {
				line = i;
			} else {
				break;
			}
		}

		matches.push({ start, end, line });
	}

	return matches;
}

/**
 * プレビューテキストを作成
 */
function createPreview(text: string, position: number, contextLength = 50): string {
	const start = Math.max(0, position - contextLength);
	const end = Math.min(text.length, position + contextLength);
	let preview = text.substring(start, end);

	if (start > 0) preview = '...' + preview;
	if (end < text.length) preview = preview + '...';

	return preview;
}

/**
 * テキスト内のキーワードをハイライト
 */
export function highlightText(
	text: string,
	query: string,
	caseSensitive = false
): { html: string; count: number } {
	if (!query) return { html: text, count: 0 };

	const pattern = new RegExp(
		query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
		caseSensitive ? 'g' : 'gi'
	);

	let count = 0;
	const html = text.replace(pattern, (match) => {
		count++;
		return `<mark>${match}</mark>`;
	});

	return { html, count };
}

/**
 * 全プロジェクトから検索
 */
export async function searchAllProjects(options: SearchOptions): Promise<
	Array<{
		projectId: string;
		projectTitle: string;
		results: SearchResult[];
	}>
> {
	const projects = await db.projects.toArray();
	const allResults: Array<{
		projectId: string;
		projectTitle: string;
		results: SearchResult[];
	}> = [];

	for (const project of projects) {
		const results = await searchInProject(project.id, options);
		if (results.length > 0) {
			allResults.push({
				projectId: project.id,
				projectTitle: project.title,
				results
			});
		}
	}

	return allResults;
}

/**
 * 正規表現の検証
 */
export function validateRegex(pattern: string): { valid: boolean; error?: string } {
	try {
		new RegExp(pattern);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			error: error instanceof Error ? error.message : '無効な正規表現です'
		};
	}
}
