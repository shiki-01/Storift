import { chaptersDB, charactersDB, plotsDB, projectsDB, scenesDB, worldbuildingDB } from '$lib/db';
import { getSceneText } from '$lib/services/sceneText.service';
import {
	buildReviewBundle,
	type ReviewBundle,
	type ReviewBundleOptions
} from '$lib/utils/reviewBundle';

/**
 * 添削用の Markdown を、データベースから集めて組み立てる。
 * 共有作品のシーンは CRDT 側の本文が正なので、getSceneText を通して読む。
 */
export async function loadReviewBundle(
	projectId: string,
	options: ReviewBundleOptions
): Promise<ReviewBundle> {
	const project = await projectsDB.getById(projectId);
	if (!project) throw new Error('作品が見つかりません');

	const [chapters, scenes, characters, worldbuilding, plots] = await Promise.all([
		chaptersDB.getByProjectId(projectId),
		scenesDB.getByProjectId(projectId),
		options.includeSettings ? charactersDB.getByProjectId(projectId) : Promise.resolve([]),
		options.includeSettings ? worldbuildingDB.getByProjectId(projectId) : Promise.resolve([]),
		options.includeSettings ? plotsDB.getByProjectId(projectId) : Promise.resolve([])
	]);

	const targetChapterIds = new Set(
		options.scope === 'chapter' && options.chapterId
			? [options.chapterId]
			: chapters.map((c) => c.id)
	);
	const sceneTexts = new Map<string, string>();
	await Promise.all(
		scenes
			.filter((s) => targetChapterIds.has(s.chapterId))
			.map(async (s) => {
				const text = await getSceneText(s.id);
				if (text !== undefined) sceneTexts.set(s.id, text);
			})
	);

	return buildReviewBundle(
		{ project, chapters, scenes, characters, worldbuilding, plots, sceneTexts },
		options
	);
}
