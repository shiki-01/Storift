import type { MemoDraft, Scene } from '$lib/types';

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
	/** 章・シーン一覧のパネルを開いているか */
	sceneListOpen: boolean;
}

function loadPrefs(): EditorPrefs {
	const fallback: EditorPrefs = { typewriter: false, dimOthers: false, sceneListOpen: true };
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
		localStorage.setItem(PREFS_KEY, JSON.stringify({ typewriter, dimOthers, sceneListOpen }));
	} catch {
		// 保存できなくても動作には影響しない
	}
}

const initialPrefs = loadPrefs();
let typewriter = $state(initialPrefs.typewriter);
let dimOthers = $state(initialPrefs.dimOthers);
let sceneListOpen = $state(initialPrefs.sceneListOpen);
// 集中モード: 上下のバーをすべて隠す(永続化しない)
let focusMode = $state(false);

// メモパネル(執筆画面の右側。Claude パネルと同じ位置で排他)
let memoOpen = $state(false);
/** 本文の選択から開いたときの、新規メモの範囲 */
let memoDraft = $state<MemoDraft | null>(null);
/** パネルを開き直す(入力欄へフォーカスする)たびに増やす */
let memoRequest = $state(0);
/** メモが変わったたびに増やす(本文の強調表示などを読み直す) */
let memoVersion = $state(0);

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
	get sceneListOpen() {
		return sceneListOpen;
	},
	set sceneListOpen(value: boolean) {
		sceneListOpen = value;
		savePrefs();
	},
	get focusMode() {
		return focusMode;
	},
	set focusMode(value: boolean) {
		focusMode = value;
	},
	get memoOpen() {
		return memoOpen;
	},
	set memoOpen(value: boolean) {
		memoOpen = value;
	},
	get memoDraft() {
		return memoDraft;
	},
	set memoDraft(value: MemoDraft | null) {
		memoDraft = value;
	},
	get memoRequest() {
		return memoRequest;
	},
	get memoVersion() {
		return memoVersion;
	},
	/** メモパネルを開く。draft があれば、その範囲を新規メモの対象にする */
	requestMemo(draft: MemoDraft | null = null) {
		memoDraft = draft;
		memoOpen = true;
		memoRequest++;
	},
	/** メモを追加・変更・削除したことを知らせる */
	bumpMemos() {
		memoVersion++;
	},
	get characterCount() {
		return content.length;
	}
};
