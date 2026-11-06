import type { MemoDraft, Scene } from '$lib/types';

let isOpen = $state(false);
let currentScene = $state<Scene | null>(null);
let content = $state('');
let isDirty = $state(false);
// 共同編集(CRDT)中のシーン ID。本文は Y が正なので、同じシーンのメタ情報の差し替えで content を巻き戻さない
let crdtSceneId: string | null = null;
// 共同編集中に、エディタ以外(AI など)が本文を書き換えるための入口(Y のハンドルへ差分を入れる)
let externalTextSink: ((text: string) => boolean) | null = null;
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

// メモパネル(執筆画面の右側。AI パネルと同じ位置で排他)
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
		if (
			value &&
			crdtSceneId !== null &&
			value.id === currentScene?.id &&
			value.id === crdtSceneId
		) {
			currentScene = value;
			return;
		}
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
	/** 共同編集中のシーン ID(無ければ null)。設定中は、同じシーンの currentScene 差し替えで本文を変えない */
	get crdtSceneId() {
		return crdtSceneId;
	},
	set crdtSceneId(value: string | null) {
		crdtSceneId = value;
	},
	/** 共同編集の結合が、外部からの本文の書き換えを受け取る関数を登録する(解除は null) */
	set externalTextSink(value: ((text: string) => boolean) | null) {
		externalTextSink = value;
	},
	/**
	 * エディタ以外(AI の編集の反映など)が、開いているシーンの本文を書き換える。
	 * 共同編集中は Y のハンドルへ差分として入れ(失敗なら false)、そうでなければ従来どおり content を更新する。
	 */
	applyExternalText(value: string): boolean {
		if (externalTextSink) return externalTextSink(value);
		content = value;
		isDirty = true;
		return true;
	},
	/** 未保存の印を付けずに本文を差し替える(共同編集で Y の本文に追随するとき) */
	setContentFromSource(value: string) {
		content = value;
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
