import type { Scene } from '$lib/types';

let isOpen = $state(false);
let currentScene = $state<Scene | null>(null);
let content = $state('');
let isDirty = $state(false);
let isSaving = $state(false);
let writingMode = $state<'vertical' | 'horizontal'>('horizontal');
let fontSize = $state(16);

// 執筆体験の個人設定(端末ごとに localStorage へ保存)
const PREFS_KEY = 'storift:editor-prefs';
interface EditorPrefs {
	typewriter: boolean;
	dimOthers: boolean;
}

function loadPrefs(): EditorPrefs {
	const fallback: EditorPrefs = { typewriter: false, dimOthers: false };
	try {
		if (typeof localStorage === 'undefined') return fallback;
		const raw = localStorage.getItem(PREFS_KEY);
		return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
	} catch {
		return fallback;
	}
}

function savePrefs() {
	try {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ typewriter, dimOthers }));
	} catch {
		// 保存できなくても動作には影響しない
	}
}

const initialPrefs = loadPrefs();
let typewriter = $state(initialPrefs.typewriter);
let dimOthers = $state(initialPrefs.dimOthers);
// 集中モード: 上下のバーをすべて隠す(永続化しない)
let focusMode = $state(false);

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
		content = value?.content ?? '';
		isDirty = false;
	},
	/** 本文・未保存状態に触れずにシーンのメタ情報(文字数・更新日時など)だけ差し替える */
	updateSceneMeta(value: Scene) {
		currentScene = value;
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
	get typewriter() {
		return typewriter;
	},
	set typewriter(value: boolean) {
		typewriter = value;
		savePrefs();
	},
	get dimOthers() {
		return dimOthers;
	},
	set dimOthers(value: boolean) {
		dimOthers = value;
		savePrefs();
	},
	get focusMode() {
		return focusMode;
	},
	set focusMode(value: boolean) {
		focusMode = value;
	},
	get characterCount() {
		return content.length;
	}
};
