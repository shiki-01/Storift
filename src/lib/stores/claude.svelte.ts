/**
 * デスクトップ版の Claude Code サイドパネルの状態。
 * 会話は Claude Code のセッション(--resume)で続け、表示用の履歴は端末の localStorage に残す。
 */
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import {
	cancelClaude,
	getClaudeStatus,
	sendToClaude,
	syncWorkspace,
	type ClaudeStatus
} from '$lib/desktop/claude';
import { applyStreamLine, createTurnState, turnParts, type TurnPart } from '$lib/desktop/stream';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'error';
	/** user / error の本文 */
	text?: string;
	/** user: 添付したものの表示名 */
	attachments?: string[];
	/** assistant: 本文とツール呼び出し */
	parts?: TurnPart[];
	running?: boolean;
	costUsd?: number;
}

export interface ClaudeSettings {
	/** 空なら Claude Code の既定 */
	model: string;
	/** 空なら自動で探す */
	claudePath: string;
	/** WebSearch / WebFetch を許可する */
	allowWeb: boolean;
}

export interface SendOptions {
	attachSelection: boolean;
	attachScene: boolean;
}

export interface QuickAction {
	label: string;
	prompt: string;
	/** 既定で添付するもの */
	needs: 'scene' | 'project' | 'none';
}

export const QUICK_ACTIONS: QuickAction[] = [
	{
		label: '校正',
		needs: 'scene',
		prompt:
			'添付した文章を校正してください。誤字脱字、文法の誤り、表記ゆれ、読みにくい箇所を指摘し、「元の文 → 修正案」の形で理由とともに示してください。'
	},
	{
		label: '矛盾チェック',
		needs: 'scene',
		prompt:
			'添付した文章に、この作品のキャラクター設定・設定資料・プロット・これまでの本文と矛盾する点がないか調べてください。根拠にしたファイルと該当箇所も示してください。'
	},
	{
		label: '推敲の提案',
		needs: 'scene',
		prompt:
			'添付した文章を推敲するとしたら、どこをどう直すと良くなるか提案してください。描写・テンポ・台詞回しの観点で、優先度の高いものから挙げてください。'
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

const SETTINGS_KEY = 'storift:claude-settings';
const PANEL_KEY = 'storift:claude-panel';
const CHAT_KEY = 'storift:claude-chat';
const MAX_SAVED_MESSAGES = 100;
const MAX_SELECTION = 20000;

const DEFAULT_SETTINGS: ClaudeSettings = { model: '', claudePath: '', allowWeb: false };

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
const chat = load<{ sessionId?: string; messages: ChatMessage[] }>(CHAT_KEY, { messages: [] });

let open = $state(panel.open);
let width = $state(panel.width);
let settings = $state<ClaudeSettings>(load(SETTINGS_KEY, DEFAULT_SETTINGS));
let messages = $state<ChatMessage[]>(chat.messages.map((m) => ({ ...m, running: false })));
let sessionId = $state<string | undefined>(chat.sessionId);
let runningId = $state<string | null>(null);
let status = $state<ClaudeStatus | null>(null);
let selection = $state('');

function persistChat() {
	save(CHAT_KEY, {
		sessionId,
		messages: messages.slice(-MAX_SAVED_MESSAGES).map((m) => ({ ...m, running: false }))
	});
}

function newId(): string {
	return crypto.randomUUID();
}

/** パネルの外で選択された文章を覚えておく(パネルをクリックすると選択が外れるため) */
function onSelectionChange() {
	const sel = window.getSelection();
	const anchor = sel?.anchorNode;
	const el = anchor instanceof Element ? anchor : anchor?.parentElement;
	if (el?.closest('[data-claude-panel]')) return;
	selection = (sel?.toString() ?? '').slice(0, MAX_SELECTION);
}

function chapterTitle(chapterId: string): string | undefined {
	return currentProjectStore.chapters.find((c) => c.id === chapterId)?.title;
}

/** プロンプトの前に付ける、今アプリで開いているものの情報と添付 */
function buildPrompt(
	text: string,
	options: SendOptions,
	exported: Awaited<ReturnType<typeof syncWorkspace>>
): { prompt: string; attachments: string[] } {
	const project = currentProjectStore.project;
	const scene = editorStore.currentScene;
	const context: string[] = [];
	const attachments: string[] = [];
	const blocks: string[] = [];

	if (project) {
		context.push(
			`開いている作品: ${project.title}(${exported.projectDirs[project.id] ?? '未書き出し'}/)`
		);
	}
	if (scene && project && scene.projectId === project.id) {
		const chapter = chapterTitle(scene.chapterId);
		context.push(
			`開いているシーン: ${chapter ? `${chapter} / ` : ''}${scene.title}(${exported.sceneFiles[scene.id] ?? '未書き出し'})`
		);
		if (options.attachScene) {
			attachments.push(`シーン「${scene.title}」`);
			blocks.push(
				`<attached_text kind="scene" title="${scene.title.replace(/"/g, "'")}">\n${editorStore.content}\n</attached_text>`
			);
		}
	}
	if (options.attachSelection && selection.trim()) {
		attachments.push(`選択範囲(${selection.length}字)`);
		blocks.push(`<attached_text kind="selection">\n${selection}\n</attached_text>`);
	}

	const header = context.length
		? `<storift_context>\n${context.join('\n')}\n</storift_context>\n\n`
		: '';
	return {
		prompt: `${header}${blocks.join('\n\n')}${blocks.length ? '\n\n' : ''}${text}`,
		attachments
	};
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
	get messages() {
		return messages;
	},
	get sessionId() {
		return sessionId;
	},
	get isRunning() {
		return runningId !== null;
	},
	get status() {
		return status;
	},
	get selection() {
		return selection;
	},
	get hasScene() {
		const scene = editorStore.currentScene;
		return !!scene && scene.projectId === currentProjectStore.project?.id;
	},

	/** 選択範囲の監視を始める。戻り値で止める */
	watchSelection(): () => void {
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
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
		messages = [];
		sessionId = undefined;
		persistChat();
	},

	async cancel() {
		if (runningId) await cancelClaude(runningId);
	},

	async send(text: string, options: SendOptions) {
		const body = text.trim();
		if (!body || runningId) return;
		const requestId = newId();
		runningId = requestId;

		const userIndex = messages.push({ id: newId(), role: 'user', text: body }) - 1;
		const assistantIndex =
			messages.push({ id: requestId, role: 'assistant', parts: [], running: true }) - 1;
		const turn = createTurnState();
		let frame = 0;
		const render = () => {
			frame = 0;
			messages[assistantIndex].parts = turnParts(turn);
		};

		try {
			// 送るたびに書き出し直し、Claude が最新の原稿を読めるようにする
			const exported = await syncWorkspace();
			const { prompt, attachments } = buildPrompt(body, options, exported);
			messages[userIndex].attachments = attachments;

			const exit = await sendToClaude(
				{
					requestId,
					prompt,
					sessionId,
					model: settings.model || undefined,
					allowWeb: settings.allowWeb,
					claudePath: settings.claudePath || undefined
				},
				(line) => {
					applyStreamLine(turn, line);
					if (!frame) frame = requestAnimationFrame(render);
				}
			);
			if (frame) cancelAnimationFrame(frame);
			render();

			if (turn.sessionId) sessionId = turn.sessionId;
			messages[assistantIndex].costUsd = turn.costUsd;
			if (exit.cancelled) {
				messages.push({ id: newId(), role: 'error', text: '中断しました。' });
			} else if (!turn.done || turn.isError || (exit.code !== 0 && exit.code !== null)) {
				const detail = exit.stderr.trim() || turn.resultText || `終了コード ${exit.code}`;
				// 古いセッションが見つからないときは、次から新しい会話で始める
				if (/No conversation found/i.test(detail)) sessionId = undefined;
				messages.push({ id: newId(), role: 'error', text: detail });
			}
		} catch (error) {
			messages.push({ id: newId(), role: 'error', text: String(error) });
		} finally {
			messages[assistantIndex].running = false;
			if (!messages[assistantIndex].parts?.length) messages.splice(assistantIndex, 1);
			runningId = null;
			persistChat();
		}
	}
};
