import type { Project, Chapter, Scene } from '$lib/types';

let project = $state<Project | null>(null);
let chapters = $state<Chapter[]>([]);
let scenes = $state<Scene[]>([]);
let isLoading = $state(false);

export const currentProjectStore = {
	get project() {
		return project;
	},
	set project(value: Project | null) {
		project = value;
	},
	get chapters() {
		return chapters;
	},
	set chapters(value: Chapter[]) {
		chapters = value;
	},
	get scenes() {
		return scenes;
	},
	set scenes(value: Scene[]) {
		scenes = value;
	},
	get isLoading() {
		return isLoading;
	},
	set isLoading(value: boolean) {
		isLoading = value;
	},
	get totalCharacterCount() {
		return scenes.reduce((sum, scene) => sum + scene.characterCount, 0);
	},
	get scenesByChapter() {
		const map = new Map<string, Scene[]>();
		for (const chapter of chapters) {
			map.set(
				chapter.id,
				scenes.filter((s) => s.chapterId === chapter.id).sort((a, b) => a.order - b.order)
			);
		}
		return map;
	}
};
