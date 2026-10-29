/**
 * デスクトップ版の Claude Code サイドパネルの状態。
 *
 * - 会話は作品ごと(作品を開いていないときは「全体」)に分け、Claude Code のセッション(--resume)で続ける。
 *   作品をまたいで履歴が混ざらないので、1 回あたりに読み直す会話が短く済む。
 * - 本文はプロンプトに毎回添付せず、ワークスペースのファイル(未保存の本文も反映)を Claude が必要なときに読む。
 * - 本文の編集は設定(editMode)に応じて、提案のみ / 差分を確認して反映 / 自動で反映 を切り替える。
 */
import { page } from '$app/state';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import { scenesDB } from '$lib/db';
import { queueChange } from '$lib/services/sync.service';
import {
	cancelClaude,
	getClaudeStatus,
	sendToClaude,
	syncWorkspace,
	type ClaudeStatus
} from '$lib/desktop/claude';
import { applyStreamLine, createTurnState, turnParts, type TurnPart } from '$lib/desktop/stream';
import { buildWorkspace, loadWorkspaceData } from '$lib/desktop/workspace';
import {
	EDIT_INSTRUCTIONS,
	parseEdits,
	replaceOnce,
	revertAt,
	type ReplaceResult
} from '$lib/desktop/edits';
import { scrollRangeIntoView, selectTextRange, textRange } from '$lib/utils/editorInput';

/** suggest: 提案のみ / confirm: 差分を見て反映 / auto: 自動で反映し、後から確認・元に戻す */
export type EditMode = 'suggest' | 'confirm' | 'auto';

export interface EditState {
	file: string;
	old: string;
	new: string;
	status: 'pending' | 'applied' | 'rejected' | 'failed' | 'reverted';
	error?: string;
	sceneId?: string;
	sceneTitle?: string;
	/** 反映した位置と、その直前の文(元に戻すときに同じ場所か確かめる) */
	appliedAt?: number;
	contextBefore?: string;
	/** 反映済みの変更を確認し終えた(エディタ上の色付けを消す)。Copilot の「保持」に当たる */
	reviewed?: boolean;
}

/** エディタ上に色付けして見せる編集 */
export interface EditorEdit {
	edit: EditState;
	message: ChatMessage;
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'error';
	/** user / error の本文 */
	text?: string;
	/** user: 引用した文章 */
	quote?: string;
	/** assistant: 本文とツール呼び出し */
	parts?: TurnPart[];
	/** assistant: 回答中の編集案(出てきた順)。回答が終わってから入る */
	edits?: EditState[];
	/** assistant: この回答のときの編集モード */
	editMode?: EditMode;
	running?: boolean;
	costUsd?: number;
}

interface Conversation {
	sessionId?: string;
	messages: ChatMessage[];
}

export interface Quote {
	text: string;
	sceneId: string;
	sceneTitle: string;
}

export interface ClaudeSettings {
	/** 空なら Claude Code の既定 */
	model: string;
	/** 空なら自動で探す */
	claudePath: string;
	/** WebSearch / WebFetch を許可する */
	allowWeb: boolean;
	editMode: EditMode;
}

export interface QuickAction {
	label: string;
	/** {target} は「引用した部分」か「開いているシーン」に置き換わる */
	prompt: string;
	needs: 'target' | 'project' | 'none';
}

export const QUICK_ACTIONS: QuickAction[] = [
	{
		label: '校正',
		needs: 'target',
		prompt:
			'{target}を校正してください。誤字脱字、文法の誤り、表記ゆれ、読みにくい箇所を指摘し、修正案を理由とともに示してください。'
	},
	{
		label: '矛盾チェック',
		needs: 'target',
		prompt:
			'{target}に、この作品のキャラクター設定・設定資料・プロット・これまでの本文と矛盾する点がないか調べてください。根拠にしたファイルと該当箇所も示してください。'
	},
	{
		label: '推敲',
		needs: 'target',
		prompt:
			'{target}を推敲してください。描写・テンポ・台詞回しの観点で、優先度の高いものから直し方を示してください。'
	},
	{
		label: '作品の要約',
		needs: 'project',
		prompt:
			'今開いている作品の本文を読み、ここまでのあらすじと主要な登場人物の現状をまとめてください。'
	},
	{
		label: '全作品で表記ゆれ',
		needs: 'none',
		prompt:
			'全作品を横断して、固有名詞・用語・漢字とひらがなの使い分けなどの表記ゆれを調べ、作品ごとに一覧にしてください。'
	}
];

export const EDIT_MODE_LABELS: Record<EditMode, string> = {
	suggest: '提案のみ',
	confirm: '差分を確認して反映',
	auto: '自動で反映(後から確認)'
};

const SETTINGS_KEY = 'storift:claude-settings';
const PANEL_KEY = 'storift:claude-panel';
const CHAT_KEY = 'storift:claude-chats';
const GLOBAL_KEY = '__global__';
const MAX_SAVED_MESSAGES = 100;

const DEFAULT_SETTINGS: ClaudeSettings = {
	model: '',
	claudePath: '',
	allowWeb: false,
	editMode: 'suggest'
};

function load<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
	} catch {
		return fallback;
	}
}

function save(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// 保存できなくても動作には影響しない
	}
}

const panel = load(PANEL_KEY, { open: false, width: 420 });

let open = $state(panel.open);
let width = $state(panel.width);
let settings = $state<ClaudeSettings>(load(SETTINGS_KEY, DEFAULT_SETTINGS));
const conversations = $state<Record<string, Conversation>>(load(CHAT_KEY, {}));
let runningId = $state<string | null>(null);
let status = $state<ClaudeStatus | null>(null);
let quote = $state<Quote | null>(null);
/** シーン ID → ワークスペースのファイル(未反映の編集案がどのシーン向けかの判定に使う) */
let sceneFiles = $state<Record<string, string>>({});
/** 入力欄へフォーカスしてほしいときに増やす */
let focusRequest = $state(0);

/** 今の会話のキー(開いている作品、なければ全体) */
function currentKey(): string {
	return page.params?.id ?? GLOBAL_KEY;
}

function conversation(key = currentKey()): Conversation {
	return (conversations[key] ??= { messages: [] });
}

function persistChats() {
	const out: Record<string, Conversation> = {};
	for (const [key, conv] of Object.entries(conversations)) {
		if (!conv.messages.length && !conv.sessionId) continue;
		out[key] = {
			sessionId: conv.sessionId,
			messages: conv.messages.slice(-MAX_SAVED_MESSAGES).map((m) => ({ ...m, running: false }))
		};
	}
	save(CHAT_KEY, out);
}

function newId(): string {
	return crypto.randomUUID();
}

function isEditorOpenOn(sceneId: string): boolean {
	return editorStore.currentScene?.id === sceneId && !!page.url?.pathname.endsWith('/editor');
}

/** シーンの本文を書き換える。開いているシーンはエディタ経由(自動保存される) */
async function updateScene(
	sceneId: string,
	change: (content: string) => ReplaceResult
): Promise<ReplaceResult> {
	const inEditor = isEditorOpenOn(sceneId);
	const content = inEditor ? editorStore.content : (await scenesDB.getById(sceneId))?.content;
	if (content == null) return { ok: false, reason: 'シーンが見つかりません' };
	const result = change(content);
	if (!result.ok) return result;

	if (inEditor) {
		editorStore.content = result.content;
	} else {
		await scenesDB.update(sceneId, { content: result.content });
		await queueChange('scenes', sceneId, 'update');
		const fresh = await scenesDB.getById(sceneId);
		const index = currentProjectStore.scenes.findIndex((s) => s.id === sceneId);
		if (fresh && index !== -1) currentProjectStore.scenes[index] = fresh;
	}
	return result;
}

/** ワークスペースのファイル → シーン(反映のたびに最新の対応を作る) */
async function findScene(file: string): Promise<{ id: string; title: string } | null> {
	const data = await loadWorkspaceData();
	const exported = buildWorkspace(data);
	const id = Object.entries(exported.sceneFiles).find(([, path]) => path === file)?.[0];
	const scene = id ? data.scenes.find((s) => s.id === id) : undefined;
	return scene ? { id: scene.id, title: scene.title } : null;
}

async function applyEdit(edit: EditState) {
	const scene = await findScene(edit.file);
	if (!scene) {
		edit.status = 'failed';
		edit.error = '本文のシーンファイルではないため反映できません';
		return;
	}
	edit.sceneId = scene.id;
	edit.sceneTitle = scene.title;
	const result = await updateScene(scene.id, (content) => replaceOnce(content, edit.old, edit.new));
	if (result.ok) {
		edit.status = 'applied';
		edit.error = undefined;
		edit.appliedAt = result.index;
		edit.contextBefore = result.content.slice(Math.max(0, result.index - 20), result.index);
	} else {
		edit.status = 'failed';
		edit.error = result.reason;
	}
}

function targetLabel(): string {
	return quote ? '引用した部分' : '開いているシーン';
}

/** プロンプトの前に付ける、今アプリで開いているものの情報と引用 */
function buildPrompt(
	text: string,
	exported: Awaited<ReturnType<typeof syncWorkspace>>,
	attached: Quote | null
): string {
	const project = currentProjectStore.project;
	const scene = editorStore.currentScene;
	const context: string[] = [];

	if (project && page.params?.id === project.id) {
		context.push(`開いている作品: ${project.title}(${exported.projectDirs[project.id]}/)`);
		if (scene && isEditorOpenOn(scene.id)) {
			context.push(`開いているシーン: ${scene.title}(${exported.sceneFiles[scene.id]})`);
		}
	}
	context.push(`本文の編集: ${EDIT_MODE_LABELS[settings.editMode]}`);

	let body = `<storift_context>\n${context.join('\n')}\n</storift_context>\n\n`;
	if (attached) {
		const file = exported.sceneFiles[attached.sceneId] ?? '';
		body += `<quote file="${file}">\n${attached.text}\n</quote>\n\n`;
	}
	return body + text;
}

export const claudeStore = {
	get open() {
		return open;
	},
	set open(value: boolean) {
		open = value;
		save(PANEL_KEY, { open, width });
		if (value && !status) void this.checkStatus();
	},
	toggle() {
		this.open = !open;
	},
	get width() {
		return width;
	},
	set width(value: number) {
		width = Math.round(Math.min(900, Math.max(320, value)));
		save(PANEL_KEY, { open, width });
	},
	get settings() {
		return settings;
	},
	updateSettings(changes: Partial<ClaudeSettings>) {
		const pathChanged =
			changes.claudePath !== undefined && changes.claudePath !== settings.claudePath;
		settings = { ...settings, ...changes };
		save(SETTINGS_KEY, settings);
		if (pathChanged) void this.checkStatus();
	},
	get messages(): ChatMessage[] {
		return conversations[currentKey()]?.messages ?? [];
	},
	/** 会話の範囲の表示名 */
	get scopeLabel() {
		const project = currentProjectStore.project;
		return page.params?.id && project?.id === page.params.id ? project.title : '全体';
	},
	get isRunning() {
		return runningId !== null;
	},
	get status() {
		return status;
	},
	get quote() {
		return quote;
	},
	get focusRequest() {
		return focusRequest;
	},
	get hasScene() {
		const scene = editorStore.currentScene;
		return !!scene && isEditorOpenOn(scene.id);
	},
	get hasProject() {
		return !!page.params?.id;
	},

	/** エディタで選んだ文章を引用して、パネルの入力欄へ */
	setQuote(value: Quote | null) {
		quote = value;
		if (value) {
			this.open = true;
			focusRequest++;
		}
	},

	actionPrompt(action: QuickAction): string {
		return action.prompt.replace('{target}', targetLabel());
	},

	async checkStatus() {
		try {
			status = await getClaudeStatus(settings.claudePath);
		} catch (error) {
			status = { found: false, error: String(error) };
		}
	},

	newChat() {
		if (runningId) return;
		conversations[currentKey()] = { messages: [] };
		persistChats();
	},

	async cancel() {
		if (runningId) await cancelClaude(runningId);
	},

	async send(text: string) {
		const body = text.trim();
		if (!body || runningId) return;
		const requestId = newId();
		runningId = requestId;

		// 実行中に作品を移っても、送った会話に書き込む
		const conv = conversation();
		const attached = quote;
		quote = null;
		const mode = settings.editMode;

		conv.messages.push({ id: newId(), role: 'user', text: body, quote: attached?.text });
		conv.messages.push({
			id: requestId,
			role: 'assistant',
			parts: [],
			running: true,
			editMode: mode
		});
		const assistant = conv.messages[conv.messages.length - 1];
		const turn = createTurnState();
		let frame = 0;
		const render = () => {
			frame = 0;
			assistant.parts = turnParts(turn);
		};

		try {
			// エディタの未保存の本文もファイルに反映してから送る
			const scene = editorStore.currentScene;
			const overrides =
				scene && isEditorOpenOn(scene.id) ? { [scene.id]: editorStore.content } : {};
			const exported = await syncWorkspace(overrides);
			sceneFiles = exported.sceneFiles;

			const exit = await sendToClaude(
				{
					requestId,
					prompt: buildPrompt(body, exported, attached),
					sessionId: conv.sessionId,
					model: settings.model || undefined,
					allowWeb: settings.allowWeb,
					claudePath: settings.claudePath || undefined,
					appendSystemPrompt: mode === 'suggest' ? undefined : EDIT_INSTRUCTIONS
				},
				(line) => {
					applyStreamLine(turn, line);
					if (!frame) frame = requestAnimationFrame(render);
				}
			);
			if (frame) cancelAnimationFrame(frame);
			render();

			if (turn.sessionId) conv.sessionId = turn.sessionId;
			assistant.costUsd = turn.costUsd;
			if (exit.cancelled) {
				conv.messages.push({ id: newId(), role: 'error', text: '中断しました。' });
			} else if (!turn.done || turn.isError || (exit.code !== 0 && exit.code !== null)) {
				const detail = exit.stderr.trim() || turn.resultText || `終了コード ${exit.code}`;
				// 古いセッションが見つからないときは、次から新しい会話で始める
				if (/No conversation found/i.test(detail)) conv.sessionId = undefined;
				conv.messages.push({ id: newId(), role: 'error', text: detail });
			}

			if (mode !== 'suggest' && !exit.cancelled) {
				const text = (assistant.parts ?? [])
					.map((p) => (p.kind === 'text' ? p.text : ''))
					.join('\n');
				assistant.edits = parseEdits(text).map((e) => ({ ...e, status: 'pending' }));
				if (mode === 'auto') {
					for (const edit of assistant.edits) await applyEdit(edit);
				}
			}
		} catch (error) {
			conv.messages.push({ id: newId(), role: 'error', text: String(error) });
		} finally {
			assistant.running = false;
			if (!assistant.parts?.length) conv.messages.splice(conv.messages.indexOf(assistant), 1);
			runningId = null;
			persistChats();
		}
	},

	/** 編集案を反映する(確認モードの「反映」) */
	async applyEdit(edit: EditState) {
		await applyEdit(edit);
		persistChats();
	},

	rejectEdit(edit: EditState) {
		edit.status = 'rejected';
		persistChats();
	},

	/** 反映した編集を元に戻す */
	async revertEdit(edit: EditState) {
		await revertEdit(edit);
		persistChats();
	},

	/** 回答に含まれる未反映の編集案をすべて反映する */
	async applyAll(message: ChatMessage) {
		for (const edit of message.edits ?? []) {
			if (edit.status === 'pending') await applyEdit(edit);
		}
		persistChats();
	},

	/** 回答で反映した編集をすべて元に戻す(後から反映したものから順に) */
	async revertAll(message: ChatMessage) {
		for (const edit of [...(message.edits ?? [])].reverse()) {
			if (edit.status === 'applied') await revertEdit(edit);
		}
		persistChats();
	},

	/** 未反映の編集案をすべて却下する */
	rejectAll(message: ChatMessage) {
		for (const edit of message.edits ?? []) {
			if (edit.status === 'pending') edit.status = 'rejected';
		}
		persistChats();
	},

	/** 確認し終えた(エディタの色付けを消す) */
	keepEdit(edit: EditState) {
		edit.reviewed = true;
		persistChats();
	},

	/** 今エディタで開いているシーンに対する、色付けして見せる編集(反映済みで未確認のもの・未反映の提案) */
	get editorEdits(): EditorEdit[] {
		const scene = editorStore.currentScene;
		if (!scene || !isEditorOpenOn(scene.id)) return [];
		const file = sceneFiles[scene.id];
		const out: EditorEdit[] = [];
		for (const message of conversations[currentKey()]?.messages ?? []) {
			for (const edit of message.edits ?? []) {
				const applied = edit.status === 'applied' && !edit.reviewed && edit.sceneId === scene.id;
				const pending = edit.status === 'pending' && !!file && edit.file === file;
				if (applied || pending) out.push({ edit, message });
			}
		}
		return out;
	},

	/** シーンとファイルの対応を作り直す(履歴から開いたときなど、まだ送信していない場合に使う) */
	async refreshSceneFiles() {
		sceneFiles = buildWorkspace(await loadWorkspaceData()).sceneFiles;
	},

	/** エディタ上の変更をまとめて操作する */
	async forEditorEdits(action: 'keep' | 'revert' | 'apply' | 'reject') {
		// 後ろの変更から処理し、前の変更の位置がずれないようにする
		for (const { edit } of [...this.editorEdits].reverse()) {
			if (action === 'keep' && edit.status === 'applied') edit.reviewed = true;
			else if (action === 'revert' && edit.status === 'applied') await revertEdit(edit);
			else if (action === 'apply' && edit.status === 'pending') await applyEdit(edit);
			else if (action === 'reject' && edit.status === 'pending') edit.status = 'rejected';
		}
		persistChats();
	},

	/** その編集のシーンをエディタで開いているか(「本文で表示」を出すか) */
	canReveal(edit: EditState): boolean {
		return !!edit.sceneId && isEditorOpenOn(edit.sceneId);
	},

	/** エディタで、反映した部分を選択して見せる */
	revealEdit(edit: EditState): boolean {
		const root = document.querySelector<HTMLElement>('.app-main [contenteditable="true"]');
		if (!root || !edit.sceneId || !isEditorOpenOn(edit.sceneId)) return false;
		const content = editorStore.content;
		const at =
			edit.appliedAt != null && content.startsWith(edit.new, edit.appliedAt)
				? edit.appliedAt
				: content.indexOf(edit.new);
		if (at < 0) return false;
		// 削除だけの編集は長さ 0 なので、前後 1 文字を含めて位置を示す
		const end = Math.min(content.length, at + Math.max(edit.new.length, 1));
		const start = Math.max(0, at - (edit.new ? 0 : 1));
		const range = textRange(root, start, end);
		const ok = !!range && selectTextRange(root, start, end);
		if (range && ok) {
			root.focus();
			scrollRangeIntoView(root, range);
		}
		return ok;
	}
};

async function revertEdit(edit: EditState) {
	const sceneId = edit.sceneId ?? (await findScene(edit.file))?.id;
	const result: ReplaceResult = sceneId
		? await updateScene(sceneId, (content) =>
				revertAt(content, edit.appliedAt, edit.contextBefore, edit.new, edit.old)
			)
		: { ok: false, reason: 'シーンが見つかりません' };
	if (result.ok) {
		edit.status = 'reverted';
		edit.error = undefined;
		edit.appliedAt = undefined;
	} else {
		edit.error = `元に戻せません: ${result.reason}`;
	}
}
