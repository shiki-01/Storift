import { db } from '$lib/db';
import { v4 as uuidv4 } from 'uuid';
import type { Project, Chapter, Scene, Character, Plot, Worldbuilding } from '$lib/types';
import type { ProgressLog } from '$lib/types/progress';

export interface ImportResult {
	success: boolean;
	projectIds: string[];
	errors: string[];
}

interface ImportedProjectData {
	project: Record<string, unknown>;
	chapters?: Record<string, unknown>[];
	scenes?: Record<string, unknown>[];
	characters?: Record<string, unknown>[];
	plots?: Record<string, unknown>[];
	worldbuilding?: Record<string, unknown>[];
	progressLogs?: Record<string, unknown>[];
}

/**
 * JSONファイルからプロジェクトをインポート
 */
export async function importFromJson(file: File): Promise<ImportResult> {
	const result: ImportResult = {
		success: false,
		projectIds: [],
		errors: []
	};

	try {
		const content = await file.text();
		const data = JSON.parse(content);

		// バージョンチェック
		if (!data.version) {
			result.errors.push('無効なバックアップファイルです');
			return result;
		}

		// 単一プロジェクトのインポート
		if (data.project) {
			const projectId = await importSingleProject(data);
			if (projectId) {
				result.projectIds.push(projectId);
				result.success = true;
			}
		}
		// 複数プロジェクトのインポート
		else if (data.projects && Array.isArray(data.projects)) {
			for (const projectData of data.projects) {
				try {
					const projectId = await importSingleProject(projectData);
					if (projectId) {
						result.projectIds.push(projectId);
					}
				} catch (error) {
					result.errors.push(
						`プロジェクト "${projectData.project?.title}" のインポートに失敗: ${error}`
					);
				}
			}
			result.success = result.projectIds.length > 0;
		} else {
			result.errors.push('サポートされていないファイル形式です');
		}
	} catch (error) {
		result.errors.push(`ファイルの読み込みに失敗: ${error}`);
	}

	return result;
}

/**
 * 単一プロジェクトをインポート
 */
async function importSingleProject(data: ImportedProjectData): Promise<string | null> {
	const newProjectId = uuidv4();
	const now = Date.now();

	// プロジェクトの作成
	const project = {
		...data.project,
		id: newProjectId,
		createdAt: now,
		updatedAt: now,
		syncedAt: undefined,
		_firestoreId: undefined,
		_version: 1
	} as Project;

	await db.projects.add(project);

	// 章のインポート（IDマッピング）
	const chapterIdMap = new Map<string, string>();
	if (data.chapters) {
		for (const chapter of data.chapters) {
			const newChapterId = uuidv4();
			chapterIdMap.set(chapter.id as string, newChapterId);

			await db.chapters.add({
				...chapter,
				id: newChapterId,
				projectId: newProjectId,
				createdAt: now,
				updatedAt: now,
				_version: 1
			} as Chapter);
		}
	}

	// シーンのインポート
	if (data.scenes) {
		for (const scene of data.scenes) {
			await db.scenes.add({
				...scene,
				id: uuidv4(),
				projectId: newProjectId,
				chapterId: chapterIdMap.get(scene.chapterId as string) || scene.chapterId,
				createdAt: now,
				updatedAt: now,
				_version: 1
			} as Scene);
		}
	}

	// キャラクターのインポート
	const characterIdMap = new Map<string, string>();
	if (data.characters) {
		for (const character of data.characters) {
			const newCharacterId = uuidv4();
			characterIdMap.set(character.id as string, newCharacterId);

			await db.characters.add({
				...character,
				id: newCharacterId,
				projectId: newProjectId,
				createdAt: now,
				updatedAt: now,
				_version: 1
			} as Character);
		}
	}

	// キャラクター関係性のIDを更新
	if (data.characters) {
		for (const character of data.characters) {
			const newCharacterId = characterIdMap.get(character.id as string);
			if (newCharacterId && character.relationships) {
				const relationships = character.relationships as Array<Record<string, unknown> & { characterId: string }>;
				const updatedRelationships = relationships.map((rel) => ({
					...rel,
					characterId: characterIdMap.get(rel.characterId) || rel.characterId
				})) as Character['relationships'];

				await db.characters.update(newCharacterId, {
					relationships: updatedRelationships
				});
			}
		}
	}

	// プロットのインポート
	if (data.plots) {
		for (const plot of data.plots) {
			const linkedSceneId = plot.linkedSceneId as string | undefined;
			const linkedChapterId = plot.linkedChapterId as string | undefined;
			
			await db.plots.add({
				...plot,
				id: uuidv4(),
				projectId: newProjectId,
				linkedSceneId: linkedSceneId
					? chapterIdMap.get(linkedSceneId) || linkedSceneId
					: undefined,
				linkedChapterId: linkedChapterId
					? chapterIdMap.get(linkedChapterId) || linkedChapterId
					: undefined,
				createdAt: now,
				updatedAt: now,
				_version: 1
			} as Plot);
		}
	}

	// 設定資料のインポート
	if (data.worldbuilding) {
		for (const item of data.worldbuilding) {
			await db.worldbuilding.add({
				...item,
				id: uuidv4(),
				projectId: newProjectId,
				createdAt: now,
				updatedAt: now,
				_version: 1
			} as Worldbuilding);
		}
	}

	// 進捗ログのインポート
	if (data.progressLogs) {
		for (const log of data.progressLogs) {
			await db.progressLogs.add({
				...log,
				id: uuidv4(),
				projectId: newProjectId,
				createdAt: now
			} as ProgressLog);
		}
	}

	return newProjectId;
}

/**
 * テキストファイルからプロジェクトを作成
 */
export async function importFromText(
	file: File,
	options: {
		title: string;
		chapterPattern?: RegExp;
		sceneBreaker?: string;
	}
): Promise<string> {
	const content = await file.text();
	const projectId = uuidv4();
	const now = Date.now();

	// プロジェクト作成
	await db.projects.add({
		id: projectId,
		title: options.title,
		description: `${file.name}からインポート`,
		createdAt: now,
		updatedAt: now,
		status: 'draft',
		settings: {
			writingMode: 'horizontal',
			fontSize: 16,
			theme: 'light',
			goal: { type: 'daily', target: 2000 }
		},
		_version: 1
	});

	// 章の検出パターン(デフォルト)
	const chapterPattern =
		options.chapterPattern || /^(?:第[0-9]+章|Chapter [0-9]+|#+ )(.+)$/gm;

	// 章ごとに分割
	const chapters: Array<{ title: string; content: string }> = [];
	const lines = content.split('\n');
	let currentChapter: { title: string; content: string } | null = null;

	for (const line of lines) {
		const match = line.match(chapterPattern);
		if (match) {
			if (currentChapter) {
				chapters.push(currentChapter);
			}
			currentChapter = {
				title: match[1] || match[0],
				content: ''
			};
		} else if (currentChapter) {
			currentChapter.content += line + '\n';
		} else {
			// 最初の章が見つかる前のテキスト
			if (!currentChapter) {
				currentChapter = {
					title: '序章',
					content: line + '\n'
				};
			}
		}
	}

	if (currentChapter) {
		chapters.push(currentChapter);
	}

	// 章がない場合は全体を1つの章として扱う
	if (chapters.length === 0) {
		chapters.push({
			title: '本文',
			content: content
		});
	}

	// IndexedDBに章とシーンを保存
	for (let i = 0; i < chapters.length; i++) {
		const chapter = chapters[i];
		const chapterId = uuidv4();

		await db.chapters.add({
			id: chapterId,
			projectId,
			title: chapter.title,
			order: i,
			synopsis: '',
			createdAt: now,
			updatedAt: now,
			_version: 1
		});

		// シーンブレーカーで分割
		const sceneBreaker = options.sceneBreaker || '\n\n***\n\n';
		const sceneParts = chapter.content.split(sceneBreaker);

		for (let j = 0; j < sceneParts.length; j++) {
			const sceneContent = sceneParts[j].trim();
			if (sceneContent) {
				await db.scenes.add({
					id: uuidv4(),
					chapterId,
					projectId,
					title: `シーン ${j + 1}`,
					content: sceneContent,
					order: j,
					characterCount: sceneContent.length,
					tags: [],
					createdAt: now,
					updatedAt: now,
					_version: 1
				});
			}
		}
	}

	return projectId;
}

/**
 * Markdownファイルからプロジェクトを作成
 */
export async function importFromMarkdown(file: File, title: string): Promise<string> {
	return importFromText(file, {
		title,
		chapterPattern: /^#{1,2} (.+)$/gm,
		sceneBreaker: '\n\n---\n\n'
	});
}
