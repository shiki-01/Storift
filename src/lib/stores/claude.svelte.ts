/**
 * デスクトップ版の Claude Code サイドパネルの状態。
 *
 * - 会話は作品ごと(作品を開いていないときは「全体」)に分け、Claude Code のセッション(--resume)で続ける。
 *   作品をまたいで履歴が混ざらないので、1 回あたりに読み直す会話が短く済む。
 * - 作品ごとに複数の会話(セッション)を履歴として残し、パネルを開くと前回の会話を開く。
 * - 質問は送った時点で保存する。回答中に画面を再読み込みしても Claude Code は止まらず、
 *   戻ってきたらネイティブ側に溜まった出力を受け取り直して続きを表示する。
 * - 本文やデータはプロンプトに添付せず、Claude が MCP ツール(storift)で必要なときに読む。プロンプトには ID だけを付ける。
 * - 編集は MCP の propose_edit で届き、設定(editMode)に応じて、提案のみ / 差分を確認して反映 / 自動で反映 を切り替える。
 *   過去の回答に書かれた <storift-edit> タグは履歴の表示にだけ使い、新しい実行では解析しない。
 */
import { page } from '$app/state';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import {
	chaptersDB,
	charactersDB,
	memosDB,
	plotsDB,
	progressLogsDB,
	relationMapsDB,
	scenesDB,
	worldbuildingDB
} from '$lib/db';
import type {
	Chapter,
	Character,
	Memo,
	Plot,
	ProgressLog,
	RelationMap,
	Worldbuilding
} from '$lib/types';
import { queueChange } from '$lib/services/sync.service';
import {
	attachClaude,
	cancelClaude,
	getClaudeStatus,
	openClaudeLogin,
	releaseClaude,
	sendToClaude,
	type ClaudeStatus,
	type ExitEvent
} from '$lib/desktop/claude';
import { isDesktop } from '$lib/desktop/platform';
import {
	applyStreamLine,
	createTurnState,
	isAuthError,
	turnParts,
	type TurnPart
} from '$lib/desktop/stream';
import { buildWorkspace, entityContext, loadWorkspaceData } from '$lib/desktop/workspace';
import {
	editEntityFile,
	entityTitle,
	isEditableKind,
	type EntityKind,
	type EntityMap,
	type EntityRef
} from '$lib/desktop/entities';
import { EDIT_INSTRUCTIONS, replaceOnce, revertAt, type ReplaceResult } from '$lib/desktop/edits';
import { scrollRangeIntoView, selectTextRange, textRange } from '$lib/utils/editorInput';

/** suggest: 提案のみ / confirm: 差分を見て反映 / auto: 自動で反映し、後から確認・元に戻す */
export type EditMode = 'suggest' | 'confirm' | 'auto';

export interface EditState {
	/** 画面に出すファイルのパス(対象の特定には sceneId / entity を使う) */
	file: string;
	old: string;
	new: string;
	status: 'pending' | 'applied' | 'rejected' | 'failed' | 'reverted';
	error?: string;
	sceneId?: string;
	/** 画面に出す編集対象の名前(シーン名、または「キャラクター: 名前」など) */
	sceneTitle?: string;
	/** シーン以外(キャラクター・プロットなど)の項目ファイルを編集するときの対象 */
	entity?: EntityRef;
	/** 反映した位置と、その直前の文(元に戻すときに同じ場所か確かめる) */
	appliedAt?: number;
	contextBefore?: string;
	/** 反映済みの変更を確認し終えた(エディタ上の色付けを消す)。UI 上の「保持」に当たる */
	reviewed?: boolean;
}

/** エディタ上に色付けして見せる編集 */
export interface EditorEdit {
	edit: EditState;
	message: ChatMessage;
}

/** MCP の結果(Claude に返す本文と、失敗かどうか) */
export interface ToolResult {
	text: string;
	isError: boolean;
}

/** propose_edit の引数(kind は 'scene' または編集できる項目の種類) */
export interface ProposeInput {
	kind: string;
	id: string;
	old: string;
	new: string;
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'error';
	/** user / error の本文 */
	text?: string;
	/** user: 引用した文章 */
	quote?: string;
	/** user: 引用の元(送り直すときに同じ引用を付ける) */
	quoteRef?: Quote;
	/** assistant: 本文とツール呼び出し */
	parts?: TurnPart[];
	/** assistant: 編集案(出てきた順)。propose_edit の呼び出しごとに入る */
	edits?: EditState[];
	/** assistant: この回答のときの編集モード */
	editMode?: EditMode;
	running?: boolean;
	costUsd?: number;
	/** error: ログインが切れている・未ログインのエラー */
	auth?: boolean;
}

/** 1 つの会話。Claude Code のセッション 1 つに当たる */
export interface ChatSession {
	id: string;
	/** Claude Code のセッション ID(--resume に渡す) */
	sessionId?: string;
	/** MCP 版(現在の方式)で始めた会話か。false・未設定の会話は古い --resume を続けない */
	mcp?: boolean;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
}

/** 作品ごと(または全体)の会話の一覧と、開いている会話 */
interface Scope {
	currentId: string | null;
	sessions: ChatSession[];
}

/** 以前の保存形式(作品ごとに会話 1 つ) */
interface LegacyConversation {
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
const MAX_SAVED_SESSIONS = 30;

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
const scopes = $state<Record<string, Scope>>(loadScopes());
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

function newId(): string {
	return crypto.randomUUID();
}

/** 会話の見出し(最初の質問の冒頭) */
function titleOf(messages: ChatMessage[]): string {
	const first = messages
		.find((m) => m.role === 'user')
		?.text?.replace(/\s+/g, ' ')
		.trim();
	if (!first) return '新しい会話';
	return first.length > 40 ? first.slice(0, 40) + '…' : first;
}

function createSession(): ChatSession {
	const now = Date.now();
	return { id: newId(), title: '新しい会話', createdAt: now, updatedAt: now, messages: [] };
}

function isEmpty(session: ChatSession): boolean {
	return !session.messages.length && !session.sessionId;
}

function loadScopes(): Record<string, Scope> {
	const raw = load<Record<string, Scope | LegacyConversation>>(CHAT_KEY, {});
	const out: Record<string, Scope> = {};
	for (const [key, value] of Object.entries(raw)) {
		if ('sessions' in value) {
			out[key] = value;
			continue;
		}
		// 以前の形式は、その会話を 1 件目の履歴として引き継ぐ
		const now = Date.now();
		const session: ChatSession = {
			id: newId(),
			sessionId: value.sessionId,
			title: titleOf(value.messages ?? []),
			createdAt: now,
			updatedAt: now,
			messages: value.messages ?? []
		};
		out[key] = { currentId: session.id, sessions: [session] };
	}
	return out;
}

function scopeOf(key = currentKey()): Scope {
	return (scopes[key] ??= { currentId: null, sessions: [] });
}

/** 開いている会話(読むだけ。無ければ null) */
function currentSession(key = currentKey()): ChatSession | null {
	const scope = scopes[key];
	return scope?.sessions.find((s) => s.id === scope.currentId) ?? null;
}

/** 開いている会話。無ければ作る(送信時など、状態を書き換えてよい場面でだけ使う) */
function conversation(key = currentKey()): ChatSession {
	const scope = scopeOf(key);
	let session = scope.sessions.find((s) => s.id === scope.currentId);
	if (!session) {
		scope.sessions.unshift(createSession());
		session = scope.sessions[0];
		scope.currentId = session.id;
	}
	return session;
}

function persistChats() {
	const out: Record<string, Scope> = {};
	for (const [key, scope] of Object.entries(scopes)) {
		const sessions = scope.sessions
			.filter((s) => !isEmpty(s))
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, MAX_SAVED_SESSIONS)
			.map((s) => ({
				...s,
				messages: s.messages.slice(-MAX_SAVED_MESSAGES).map((m) => ({ ...m }))
			}));
		if (!sessions.length) continue;
		out[key] = { currentId: scope.currentId, sessions };
	}
	save(CHAT_KEY, out);
}

function isEditorOpenOn(sceneId: string): boolean {
	return editorStore.currentScene?.id === sceneId && !!page.url?.pathname.endsWith('/editor');
}

/** シーンの本文を書き換える。開いているシーンはエディタ経由(自動保存される) */
async function updateScene(
	sceneId: string,
	change: (content: string) => ReplaceResult,
	save = true
): Promise<ReplaceResult> {
	const inEditor = isEditorOpenOn(sceneId);
	const content = inEditor ? editorStore.content : (await scenesDB.getById(sceneId))?.content;
	if (content == null) return { ok: false, reason: 'シーンが見つかりません' };
	const result = change(content);
	if (!result.ok) return result;
	// save が false のときは確かめるだけ(提案の時点で一致箇所を検証する)
	if (!save) return result;

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

const KIND_LABELS: Record<EntityKind, string> = {
	chapters: '章の概要',
	characters: 'キャラクター',
	plots: 'プロット',
	worldbuilding: '設定資料',
	memos: 'メモ',
	progressLogs: '進捗',
	history: '履歴',
	relationMaps: '相関図'
};

type Target =
	| { type: 'scene'; id: string; title: string }
	| { type: 'entity'; ref: EntityRef; title: string };

function entityOf<K extends EntityKind>(
	data: Awaited<ReturnType<typeof loadWorkspaceData>>,
	ref: { kind: K; id: string }
): EntityMap[K] | undefined {
	const list = data[ref.kind] as { id: string }[];
	return list.find((x) => x.id === ref.id) as EntityMap[K] | undefined;
}

/** ワークスペースのファイル → 編集対象(反映のたびに最新の対応を作る) */
async function findTarget(file: string): Promise<Target | null> {
	const data = await loadWorkspaceData();
	const exported = buildWorkspace(data);
	const sceneId = Object.entries(exported.sceneFiles).find(([, path]) => path === file)?.[0];
	const scene = sceneId ? data.scenes.find((s) => s.id === sceneId) : undefined;
	if (scene) return { type: 'scene', id: scene.id, title: scene.title };
	const ref = exported.entityFiles[file];
	const entity = ref && entityOf(data, ref);
	if (!ref || !entity) return null;
	return {
		type: 'entity',
		ref,
		title: `${KIND_LABELS[ref.kind]}: ${entityTitle(ref.kind, entity as never)}`
	};
}

/** 変更を DB と画面の状態へ反映する。同期対象は chapters / characters / plots / worldbuilding だけ */
async function saveEntityChanges(
	kind: EntityKind,
	entity: EntityMap[EntityKind],
	changes: Partial<EntityMap[EntityKind]>
): Promise<string | null> {
	const id = entity.id;
	switch (kind) {
		case 'chapters': {
			await chaptersDB.update(id, changes as Partial<Chapter>);
			await queueChange('chapters', id, 'update');
			const fresh = await chaptersDB.getById(id);
			const index = currentProjectStore.chapters.findIndex((c) => c.id === id);
			if (fresh && index !== -1) currentProjectStore.chapters[index] = fresh;
			return null;
		}
		case 'characters':
			await charactersDB.update(id, changes as Partial<Character>);
			await queueChange('characters', id, 'update');
			return null;
		case 'plots':
			await plotsDB.update(id, changes as Partial<Plot>);
			await queueChange('plots', id, 'update');
			return null;
		case 'worldbuilding':
			await worldbuildingDB.update(id, changes as Partial<Worldbuilding>);
			await queueChange('worldbuilding', id, 'update');
			return null;
		case 'memos':
			// メモ・進捗ログ・相関図は端末内だけのデータで、同期しない
			await memosDB.update(id, changes as Partial<Memo>);
			return null;
		case 'progressLogs': {
			const log = entity as ProgressLog;
			const date = (changes as Partial<ProgressLog>).date;
			if (date && date !== log.date && (await progressLogsDB.getByDate(log.projectId, date)))
				return `${date} の進捗は既にあります`;
			await progressLogsDB.update(id, changes as Partial<ProgressLog>);
			return null;
		}
		case 'relationMaps':
			await relationMapsDB.save({
				...(entity as RelationMap),
				...(changes as Partial<RelationMap>)
			});
			return null;
		default:
			return '読み取り専用のため変更できません';
	}
}

/** 項目ファイルに change を適用して書き戻す */
async function updateEntity(
	ref: EntityRef,
	change: (content: string) => ReplaceResult,
	save = true
): Promise<ReplaceResult> {
	const data = await loadWorkspaceData();
	const exported = buildWorkspace(data);
	const path = Object.entries(exported.entityFiles).find(
		([, r]) => r.kind === ref.kind && r.id === ref.id
	)?.[0];
	const entity = entityOf(data, ref);
	const content = exported.files.find((f) => f.path === path)?.content;
	if (!entity || content == null) return { ok: false, reason: '編集対象が見つかりません' };

	const result = editEntityFile(ref.kind, entity as never, entityContext(data), content, change);
	if (!result.ok) return result;
	if (!save) return { ok: true, content: result.content, index: result.index };
	const error = await saveEntityChanges(ref.kind, entity, result.changes);
	if (error) return { ok: false, reason: error };
	return { ok: true, content: result.content, index: result.index };
}

/** 編集案を反映する。対象(sceneId / entity)が決まっていればそのまま使い、無ければファイルから探す */
async function applyEdit(edit: EditState) {
	const change = (content: string) => replaceOnce(content, edit.old, edit.new);
	let result: ReplaceResult;
	if (edit.sceneId) {
		result = await updateScene(edit.sceneId, change);
	} else if (edit.entity) {
		result = await updateEntity(edit.entity, change);
	} else {
		const target = await findTarget(edit.file);
		if (!target) {
			edit.status = 'failed';
			edit.error = '編集できるファイルではないため反映できません';
			return;
		}
		edit.sceneTitle = target.title;
		if (target.type === 'scene') {
			edit.sceneId = target.id;
			result = await updateScene(target.id, change);
		} else {
			edit.entity = target.ref;
			result = await updateEntity(target.ref, change);
		}
	}
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

/** 実行中の回答(MCP 呼び出しの持ち主)を探す。実行 ID は回答のメッセージ ID */
function runningAssistant(runId: string): ChatMessage | null {
	for (const scope of Object.values(scopes))
		for (const session of scope.sessions)
			for (const message of session.messages)
				if (message.id === runId && message.role === 'assistant' && message.running) return message;
	return null;
}

const toolOk = (text: string): ToolResult => ({ text, isError: false });
const toolError = (text: string): ToolResult => ({ text, isError: true });

/** MCP 版より前に始めた会話の Claude Code セッションは、今のツール構成と食い違うので続けない */
function detachLegacy(session: ChatSession) {
	if (!session.mcp) session.sessionId = undefined;
}

function targetLabel(): string {
	return quote ? '引用した部分' : '開いているシーン';
}

/** プロンプトの前に付ける、今アプリで開いているものの ID と引用。本文や項目は Claude が MCP で読む */
function buildPrompt(text: string, mode: EditMode, attached: Quote | null): string {
	const project = currentProjectStore.project;
	const scene = editorStore.currentScene;
	const context: string[] = [];

	if (project && page.params?.id === project.id) {
		context.push(`開いている作品: ${project.title}(projectId: ${project.id})`);
		if (scene && isEditorOpenOn(scene.id)) {
			context.push(`開いているシーン: ${scene.title}(sceneId: ${scene.id})`);
		}
	}
	context.push(`本文の編集: ${EDIT_MODE_LABELS[mode]}`);

	let body = `<storift_context>\n${context.join('\n')}\n</storift_context>\n\n`;
	if (attached) {
		body += `<quote sceneId="${attached.sceneId}" sceneTitle="${attached.sceneTitle}">\n${attached.text}\n</quote>\n\n`;
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
		return currentSession()?.messages ?? [];
	},
	/** 今の作品(または全体)の会話の履歴。新しく話した順 */
	get sessions(): ChatSession[] {
		return (scopes[currentKey()]?.sessions ?? [])
			.filter((s) => !isEmpty(s))
			.sort((a, b) => b.updatedAt - a.updatedAt);
	},
	get currentSessionId(): string | null {
		return scopes[currentKey()]?.currentId ?? null;
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

	/** 開いている作品の ID(作品のページを開いていないときは null) */
	get openProjectId(): string | null {
		return page.params?.id ?? null;
	},

	/** エディタで本文を開いているシーンの ID(開いていなければ null) */
	get openSceneId(): string | null {
		const scene = editorStore.currentScene;
		return scene && isEditorOpenOn(scene.id) ? scene.id : null;
	},

	/**
	 * Claude の propose_edit(MCP)を処理する。対象と一致箇所を先に確かめ、通ったものだけ編集案として回答に記録する。
	 * confirm は承認待ちとして残し、auto はその場で反映して結果を返す。
	 */
	async proposeEdit(runId: string, input: ProposeInput): Promise<ToolResult> {
		const message = runningAssistant(runId);
		if (!message) return toolError('この操作は Claude の回答中にだけ使えます');
		const mode = message.editMode ?? 'suggest';
		if (mode === 'suggest') return toolError('提案のみの設定では本文や項目を変更できません');

		const change = (content: string) => replaceOnce(content, input.old, input.new);
		const data = await loadWorkspaceData();
		const exported = buildWorkspace(data);
		let draft: Omit<EditState, 'status'>;
		let check: ReplaceResult;
		if (input.kind === 'scene') {
			const scene = data.scenes.find((s) => s.id === input.id);
			if (!scene) return toolError(`シーンが見つかりません: ${input.id}`);
			check = await updateScene(scene.id, change, false);
			draft = {
				file: exported.sceneFiles[scene.id] ?? '',
				old: input.old,
				new: input.new,
				sceneId: scene.id,
				sceneTitle: scene.title
			};
		} else if (isEditableKind(input.kind)) {
			const kind = input.kind;
			const item = (data[kind] as unknown as { id: string }[]).find((x) => x.id === input.id);
			if (!item) return toolError(`項目が見つかりません: ${kind} ${input.id}`);
			const ref: EntityRef = { kind, id: input.id };
			check = await updateEntity(ref, change, false);
			const path = Object.entries(exported.entityFiles).find(
				([, r]) => r.kind === kind && r.id === input.id
			)?.[0];
			draft = {
				file: path ?? '',
				old: input.old,
				new: input.new,
				entity: ref,
				sceneTitle: `${KIND_LABELS[kind]}: ${entityTitle(kind, item as never)}`
			};
		} else {
			return toolError(
				input.kind === 'history'
					? '履歴は読み取り専用のため変更できません'
					: `編集できない種類です: ${input.kind}`
			);
		}
		if (!check.ok) return toolError(check.reason);

		if (!message.edits) message.edits = [];
		message.edits.push({ ...draft, status: 'pending' });
		const edit = message.edits[message.edits.length - 1];
		persistChats();
		if (mode === 'confirm') {
			return toolOk(
				`提案を記録しました(承認待ち): ${edit.file}。ユーザーが差分を確認して反映します。`
			);
		}
		await applyEdit(edit);
		persistChats();
		return edit.status === 'applied'
			? toolOk(`反映しました: ${edit.file}`)
			: toolError(`反映できませんでした: ${edit.error ?? '理由が不明です'}`);
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

	/** 新しい会話を始める(今の会話が空ならそのまま使う) */
	newChat() {
		if (runningId) return;
		const scope = scopeOf();
		const current = currentSession();
		if (current && isEmpty(current)) return;
		const session = createSession();
		scope.sessions.unshift(session);
		scope.currentId = session.id;
		persistChats();
	},

	/** 履歴から会話を開く */
	openSession(id: string) {
		if (runningId) return;
		const scope = scopeOf();
		const target = scope.sessions.find((s) => s.id === id);
		if (!target) return;
		// 開いていた空の会話は残さない
		scope.sessions = scope.sessions.filter((s) => s.id === id || !isEmpty(s));
		scope.currentId = id;
		detachLegacy(target);
		persistChats();
	},

	/** 履歴から会話を消す */
	deleteSession(id: string) {
		const scope = scopeOf();
		if (runningId && scope.currentId === id) return;
		scope.sessions = scope.sessions.filter((s) => s.id !== id);
		if (scope.currentId === id) scope.currentId = this.sessions[0]?.id ?? null;
		persistChats();
	},

	/** ターミナルでログインを始める */
	async openLogin() {
		await openClaudeLogin(settings.claudePath);
	},

	async cancel() {
		if (runningId) await cancelClaude(runningId);
	},

	/** 質問を送る。options.quote を渡すとその引用を付ける(省略時は今の引用) */
	async send(text: string, options: { quote?: Quote | null } = {}) {
		const body = text.trim();
		if (!body || runningId) return;
		const requestId = newId();
		runningId = requestId;

		// 実行中に作品を移っても、送った会話に書き込む
		const conv = conversation();
		if (!conv.mcp) {
			detachLegacy(conv);
			conv.mcp = true;
		}
		const attached = options.quote !== undefined ? options.quote : quote;
		if (options.quote === undefined) quote = null;
		const mode = settings.editMode;

		conv.messages.push({
			id: newId(),
			role: 'user',
			text: body,
			quote: attached?.text,
			quoteRef: attached ?? undefined
		});
		conv.updatedAt = Date.now();
		if (conv.title === '新しい会話') conv.title = titleOf(conv.messages);
		conv.messages.push({
			id: requestId,
			role: 'assistant',
			parts: [],
			running: true,
			editMode: mode
		});
		const assistant = conv.messages[conv.messages.length - 1];
		// 送った時点で保存し、再読み込みしても質問と回答中の状態が残るようにする
		persistChats();

		await follow(conv, assistant, (onLine) =>
			sendToClaude(
				{
					requestId,
					prompt: buildPrompt(body, mode, attached),
					sessionId: conv.sessionId,
					model: settings.model || undefined,
					allowWeb: settings.allowWeb,
					claudePath: settings.claudePath || undefined,
					editMode: mode,
					appendSystemPrompt: mode === 'suggest' ? undefined : EDIT_INSTRUCTIONS
				},
				onLine
			)
		);
	},

	/** 最後の質問か(再生成・編集で送り直せるのは最後の質問だけ) */
	isLastQuestion(message: ChatMessage): boolean {
		const messages = currentSession()?.messages ?? [];
		return [...messages].reverse().find((m) => m.role === 'user')?.id === message.id;
	},

	/**
	 * 最後の質問を送り直す(text を渡すと書き換えて送る)。それ以降の回答は一覧から消える。
	 * Claude Code のセッションには前の回答も残るので、会話の流れとしては「もう一度聞いた」形になる
	 */
	async retry(message: ChatMessage, text = message.text ?? '') {
		const conv = currentSession();
		if (!conv || runningId || !this.isLastQuestion(message) || !text.trim()) return;
		conv.messages.splice(conv.messages.findIndex((m) => m.id === message.id));
		if (!conv.messages.some((m) => m.role === 'user')) conv.title = '新しい会話';
		await this.send(text, { quote: message.quoteRef ?? null });
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
		for (const message of currentSession()?.messages ?? []) {
			for (const edit of message.edits ?? []) {
				const applied = edit.status === 'applied' && !edit.reviewed && edit.sceneId === scene.id;
				const pending =
					edit.status === 'pending' &&
					(edit.sceneId ? edit.sceneId === scene.id : !!file && edit.file === file);
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

/**
 * 実行の出力を受け取って回答に反映し、終わったら後始末する(送信と、再読み込み後の再開で共通)。
 * run が null を返したら、ネイティブ側に記録が無い(アプリを終了した等)ので途中で止まった扱いにする
 */
async function follow(
	conv: ChatSession,
	assistant: ChatMessage,
	run: (onLine: (line: string) => void) => Promise<ExitEvent | null>
) {
	const requestId = assistant.id;
	const turn = createTurnState();
	let frame = 0;
	const render = () => {
		frame = 0;
		assistant.parts = turnParts(turn);
	};
	let exit: ExitEvent | null = null;

	try {
		exit = await run((line) => {
			applyStreamLine(turn, line);
			if (!frame) frame = requestAnimationFrame(render);
		});
		if (frame) cancelAnimationFrame(frame);
		render();

		if (!exit) {
			conv.messages.push({
				id: newId(),
				role: 'error',
				text: 'アプリを終了したため、この回答は途中で止まりました。もう一度送ってください。'
			});
			return;
		}

		if (turn.sessionId) conv.sessionId = turn.sessionId;
		assistant.costUsd = turn.costUsd;
		if (exit.cancelled) {
			conv.messages.push({ id: newId(), role: 'error', text: '中断しました。' });
		} else if (!turn.done || turn.isError || (exit.code !== 0 && exit.code !== null)) {
			const detail = exit.stderr.trim() || turn.resultText || `終了コード ${exit.code}`;
			// 古いセッションが見つからないときは、次から新しい会話で始める
			if (/No conversation found/i.test(detail)) conv.sessionId = undefined;
			const auth = isAuthError(detail);
			if (auth && status) status = { ...status, loggedIn: false };
			conv.messages.push({ id: newId(), role: 'error', text: detail, auth });
		}
	} catch (error) {
		conv.messages.push({ id: newId(), role: 'error', text: String(error) });
	} finally {
		assistant.running = false;
		if (!assistant.parts?.length) conv.messages.splice(conv.messages.indexOf(assistant), 1);
		conv.updatedAt = Date.now();
		if (runningId === requestId) runningId = null;
		persistChats();
		if (exit) void releaseClaude(requestId).catch(() => {});
	}
}

/** 再読み込みの前に回答中だったものを、ネイティブ側に溜まった出力から受け取り直して続ける */
function resumeRuns() {
	for (const scope of Object.values(scopes)) {
		for (const session of scope.sessions) {
			for (const message of session.messages) {
				if (message.role !== 'assistant' || !message.running) continue;
				// 同時に走るのは 1 つだけのはずなので、2 つ目以降は止まった扱いにする
				if (runningId) {
					message.running = false;
					continue;
				}
				runningId = message.id;
				void follow(session, message, (onLine) => attachClaude(message.id, onLine));
			}
		}
	}
}

if (typeof window !== 'undefined' && isDesktop()) {
	queueMicrotask(resumeRuns);
	// デスクトップ専用の MCP 処理は、必要になるまで読み込まない
	queueMicrotask(() => void import('$lib/desktop/mcp').then((m) => m.startMcpBridge()));
}

async function revertEdit(edit: EditState) {
	const change = (content: string) =>
		revertAt(content, edit.appliedAt, edit.contextBefore, edit.new, edit.old);
	let result: ReplaceResult;
	if (edit.entity) {
		result = await updateEntity(edit.entity, change);
	} else {
		const target = edit.sceneId ? null : await findTarget(edit.file);
		const sceneId = edit.sceneId ?? (target?.type === 'scene' ? target.id : undefined);
		result = sceneId
			? await updateScene(sceneId, change)
			: { ok: false, reason: 'シーンが見つかりません' };
	}
	if (result.ok) {
		edit.status = 'reverted';
		edit.error = undefined;
		edit.appliedAt = undefined;
	} else {
		edit.error = `元に戻せません: ${result.reason}`;
	}
}
