import type { Scene } from '$lib/types';

let isOpen = $state(true);
let currentScene = $state<Scene | null>(null);
let content = $state('');
let isDirty = $state(false);
let isSaving = $state(false);
let writingMode = $state<'vertical' | 'horizontal'>('horizontal');
let fontSize = $state(16);

export const editorStore = {
	get isOpen() {
		return isOpen;
	},
	set isOpen(value: boolean) {
		isOpen = value;
	},
	get currentScene() {
		return currentScene;
	},
	set currentScene(value: Scene | null) {
		currentScene = value;
		if (value) {
			content = value.content;
			isDirty = false;
		} else {
			content = '';
		}
	},
	get content() {
		return content;
	},
	set content(value: string) {
		content = value;
		isDirty = true;
	},
	get isDirty() {
		return isDirty;
	},
	set isDirty(value: boolean) {
		isDirty = value;
	},
	get isSaving() {
		return isSaving;
	},
	set isSaving(value: boolean) {
		isSaving = value;
	},
	get writingMode() {
		return writingMode;
	},
	set writingMode(value: 'vertical' | 'horizontal') {
		writingMode = value;
	},
	get fontSize() {
		return fontSize;
	},
	set fontSize(value: number) {
		fontSize = value;
	},
	get characterCount() {
		return content.length;
	}
};
