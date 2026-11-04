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
	db,
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
import { queueChanges } from '$lib/services/sync.service';
import {
	attachClaude,
	cancelClaude,
	getClaudeStatus,
	getOllamaStatus,
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
import {
	buildWorkspace,
	entityContextFor,
	entityFilePath,
	loadEntity,
	loadWorkspaceData,
	sceneFilePath
} from '$lib/desktop/workspace';
import {
	createEntity,
	prepareCreate,
	removeEntity,
	restoreEntity,
	type CreateSpec,
	type EntityRecord,
	type SyncChange,
	type Touched
} from '$lib/desktop/entityOps';
import {
	editEntityFile,
	entityTitle,
	isCreatableKind,
	isDeletableKind,
	isEditableKind,
	renderEntity,
	type DeletableKind,
	type EntityKind,
	type EntityMap,
	type EntityRef
} from '$lib/desktop/entities';
import { dataChange } from '$lib/stores/dataChange.svelte';
import {
	EDIT_INSTRUCTIONS,
	introducesRepeat,
	replaceOnce,
	revertAt,
	type ReplaceResult
} from '$lib/desktop/edits';
import { scrollRangeIntoView, selectTextRange, textRange } from '$lib/utils/editorInput';
import { remapEdgeStyles } from '$lib/utils/relationGraph';

/** suggest: 提案のみ / confirm: 差分を見て反映 / auto: 自動で反映し、後から確認・元に戻す */
export type EditMode = 'suggest' | 'confirm' | 'auto';

/** edit: 既存の本文・項目の置換 / create: 項目の新規追加 / delete: 項目の削除 */
export type EditAction = 'edit' | 'create' | 'delete';

export interface EditState {
	/** 編集の種類。以前の形式で保存された編集案には無く、その場合は edit */
	action?: EditAction;
	/** 画面に出すファイルのパス(対象の特定には sceneId / entity を使う) */
	file: string;
	old: string;
	new: string;
	status: 'pending' | 'applying' | 'applied' | 'reverting' | 'rejected' | 'failed' | 'reverted';
	error?: string;
	sceneId?: string;
	/** 画面に出す編集対象の名前(シーン名、または「キャラクター: 名前」など) */
	sceneTitle?: string;
	/** シーン以外(キャラクター・プロットなど)の項目ファイルを編集するときの対象 */
	entity?: EntityRef;
	/** 反映した位置と、その直前の文(元に戻すときに同じ場所か確かめる) */
	appliedAt?: number;
	contextBefore?: string;
	/** create: 追加する内容(検証済み)。反映すると entity に追加した項目が入る */
	create?: CreateSpec;
	/** delete: 削除した項目の丸ごとの写し(元に戻すと同じ ID で復元する)。create の取り消し後にも残る */
	snapshot?: EntityRecord;
	/** delete / create の取り消しで書き換えた他の項目(キャラクターの関係・相関図)の元の状態 */
	touched?: Touched;
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

/** propose_create の引数。fields は項目名 → 値(entities.ts の createFieldLabels) */
export interface ProposeCreateInput {
	kind: string;
	fields: unknown;
	projectId?: string;
}

/** propose_delete の引数 */
export interface ProposeDeleteInput {
	kind: string;
	id: string;
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

export type AiProvider = 'claude' | 'ollama';

export const PROVIDER_LABELS: Record<AiProvider, string> = {
	claude: 'Claude Code',
	ollama: 'Ollama'
};

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

export interface ClaudeSettings {
	/** どの AI で動かすか */
	provider: AiProvider;
	/** Ollama の接続先(空なら既定) */
	ollamaUrl: string;
	/** Ollama のモデル名 */
	ollamaModel: string;
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
	provider: 'claude',
	ollamaUrl: '',
	ollamaModel: '',
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
let ollamaModels = $state<string[]>([]);
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

/** 途中経過の状態(反映中・取り消し中)のまま保存されていたら、もとの状態に戻す */
function settleStatuses(scope: Scope) {
	for (const session of scope.sessions)
		for (const message of session.messages)
			for (const edit of message.edits ?? []) {
				if (edit.status === 'applying') edit.status = 'pending';
				else if (edit.status === 'reverting') edit.status = 'applied';
			}
}

function loadScopes(): Record<string, Scope> {
	const raw = load<Record<string, Scope | LegacyConversation>>(CHAT_KEY, {});
	const out: Record<string, Scope> = {};
	for (const [key, value] of Object.entries(raw)) {
		if ('sessions' in value) {
			settleStatuses(value);
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

/** 同期キューに積む変更のまとめ(反映の最後に 1 回だけ保存する) */
type SyncBatch = Map<string, SyncChange>;

function newBatch(): SyncBatch {
	return new Map();
}

function queueLater(batch: SyncBatch, changes: SyncChange[]) {
	for (const change of changes) {
		const key = `${change.type}:${change.id}`;
		// 作成したばかりのものへの更新は、作成のまま残す
		if (batch.get(key)?.action === 'create' && change.action === 'update') continue;
		batch.set(key, change);
	}
}

async function flushSync(batch: SyncBatch) {
	if (!batch.size) return;
	const changes = [...batch.values()];
	batch.clear();
	// 同期は数秒のデバウンスを待ち、連続して呼ぶと前の呼び出しが完了しないことがある。
	// 反映の完了を同期に結びつけないよう、待たずに任せる
	void queueChanges(changes).catch((error) =>
		console.error('同期キューへの登録に失敗しました', error)
	);
}

/** 開いている画面に、DB の項目が書き換わったことを知らせる(関係線は人物と相関図の両方に出る) */
function notifyChanged(...kinds: EntityKind[]) {
	const all = [...kinds];
	if (kinds.includes('characters') && !kinds.includes('relationMaps')) all.push('relationMaps');
	dataChange.notify(...all);
}

const ALL_KINDS: EntityKind[] = [
	'chapters',
	'characters',
	'plots',
	'worldbuilding',
	'memos',
	'progressLogs',
	'history',
	'relationMaps'
];

type ChangeFn = (content: string) => ReplaceResult;

/**
 * シーンの本文に changes を順に適用する(失敗した変更は飛ばし、結果は changes と同じ順で返す)。
 * 開いているシーンはエディタ経由(自動保存される)。保存は最後に 1 回だけ。
 */
async function editScene(
	sceneId: string,
	changes: ChangeFn[],
	save = true,
	batch?: SyncBatch
): Promise<ReplaceResult[]> {
	const inEditor = isEditorOpenOn(sceneId);
	const original = inEditor ? editorStore.content : (await scenesDB.getById(sceneId))?.content;
	if (original == null)
		return changes.map(() => ({ ok: false, reason: 'シーンが見つかりません' }) as ReplaceResult);
	let content = original;
	const results = changes.map((change): ReplaceResult => {
		const result = change(content);
		if (result.ok) content = result.content;
		return result;
	});
	// save が false のときは確かめるだけ(提案の時点で一致箇所を検証する)
	if (!save || content === original) return results;

	if (inEditor) {
		editorStore.content = content;
	} else {
		await scenesDB.update(sceneId, { content });
		const fresh = await scenesDB.getById(sceneId);
		const index = currentProjectStore.scenes.findIndex((s) => s.id === sceneId);
		if (fresh && index !== -1) currentProjectStore.scenes[index] = fresh;
		if (batch) queueLater(batch, [{ type: 'scenes', id: sceneId, action: 'update' }]);
		else await queueChanges([{ type: 'scenes', id: sceneId, action: 'update' }]);
	}
	return results;
}

async function updateScene(
	sceneId: string,
	change: ChangeFn,
	save = true,
	batch?: SyncBatch
): Promise<ReplaceResult> {
	return (await editScene(sceneId, [change], save, batch))[0];
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

/** 開いている作品の章の一覧(画面の状態)を、DB の変更に合わせる */
function syncChapterStore(chapter: Chapter | null, removedId?: string) {
	if (removedId) {
		currentProjectStore.chapters = currentProjectStore.chapters.filter((c) => c.id !== removedId);
		return;
	}
	if (!chapter || chapter.projectId !== currentProjectStore.project?.id) return;
	const rest = currentProjectStore.chapters.filter((c) => c.id !== chapter.id);
	currentProjectStore.chapters = [...rest, chapter].sort((a, b) => a.order - b.order);
}

/** 変更を DB と画面の状態へ反映する。同期対象は chapters / characters / plots / worldbuilding だけ */
async function saveEntityChanges(
	kind: EntityKind,
	entity: EntityMap[EntityKind],
	changes: Partial<EntityMap[EntityKind]>,
	batch: SyncBatch
): Promise<string | null> {
	const id = entity.id;
	switch (kind) {
		case 'chapters': {
			await chaptersDB.update(id, changes as Partial<Chapter>);
			queueLater(batch, [{ type: 'chapters', id, action: 'update' }]);
			const fresh = await chaptersDB.getById(id);
			if (fresh && currentProjectStore.chapters.some((c) => c.id === id)) syncChapterStore(fresh);
			return null;
		}
		case 'characters': {
			const rels = (changes as Partial<Character>).relationships;
			await charactersDB.update(id, changes as Partial<Character>);
			queueLater(batch, [{ type: 'characters', id, action: 'update' }]);
			if (rels) {
				// 関係の名前を変えたときは、線の見た目(色・形・矢印)を新しい関係へ引き継ぐ
				const character = entity as Character;
				const map = await relationMapsDB.get(character.projectId);
				const edgeStyles = remapEdgeStyles(map.edgeStyles, id, character.relationships ?? [], rels);
				if (JSON.stringify(edgeStyles) !== JSON.stringify(map.edgeStyles))
					await relationMapsDB.save({ ...map, edgeStyles });
			}
			return null;
		}
		case 'plots':
			await plotsDB.update(id, changes as Partial<Plot>);
			queueLater(batch, [{ type: 'plots', id, action: 'update' }]);
			return null;
		case 'worldbuilding':
			await worldbuildingDB.update(id, changes as Partial<Worldbuilding>);
			queueLater(batch, [{ type: 'worldbuilding', id, action: 'update' }]);
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

/**
 * 項目ファイルに changes を順に適用して書き戻す(失敗した変更は飛ばし、結果は changes と同じ順)。
 * 対象 1 件だけを DB から読み、書き込みも最後に 1 回だけ行う。
 */
async function editEntity(
	ref: EntityRef,
	changes: ChangeFn[],
	save = true,
	batch?: SyncBatch
): Promise<ReplaceResult[]> {
	const loaded = await loadEntity(ref);
	if (!loaded)
		return changes.map(() => ({ ok: false, reason: '編集対象が見つかりません' }) as ReplaceResult);
	const { ctx } = loaded;
	let entity = loaded.entity;
	let content = renderEntity(ref.kind, entity, ctx);
	const merged: Partial<EntityMap[EntityKind]> = {};
	let any = false;
	const results = changes.map((change): ReplaceResult => {
		const result = editEntityFile(ref.kind, entity as never, ctx, content, change);
		if (!result.ok) return result;
		any = true;
		Object.assign(merged, result.changes);
		// 次の変更は、この変更を反映した項目から組み立てたファイルに対して行う
		entity = { ...entity, ...result.changes } as typeof entity;
		content = renderEntity(ref.kind, entity, ctx);
		return { ok: true, content: result.content, index: result.index };
	});
	if (!save || !any) return results;
	const own = batch ?? newBatch();
	const error = await saveEntityChanges(ref.kind, loaded.entity, merged, own);
	if (!batch) await flushSync(own);
	if (error) return changes.map(() => ({ ok: false, reason: error }) as ReplaceResult);
	notifyChanged(ref.kind);
	return results;
}

const markApplied = (edit: EditState, result: { content: string; index: number }) => {
	edit.status = 'applied';
	edit.error = undefined;
	edit.appliedAt = result.index;
	edit.contextBefore = result.content.slice(Math.max(0, result.index - 20), result.index);
};

const markFailed = (edit: EditState, reason: string) => {
	edit.status = 'failed';
	edit.error = reason;
};

const actionOf = (edit: EditState): EditAction => edit.action ?? 'edit';

function sameTarget(a: EditState, b: EditState): boolean {
	if (a.sceneId || b.sceneId) return a.sceneId === b.sceneId;
	return !!a.entity && a.entity.kind === b.entity?.kind && a.entity.id === b.entity?.id;
}

function allEdits(): EditState[] {
	return Object.values(scopes).flatMap((scope) =>
		scope.sessions.flatMap((session) => session.messages.flatMap((m) => m.edits ?? []))
	);
}

/** 同じ対象で、まだ反映していない編集案(出てきた順)。提案の検証は、これらを反映した状態に対して行う */
function pendingOn(target: { sceneId?: string; entity?: EntityRef }): EditState[] {
	const probe = { ...target } as EditState;
	return allEdits().filter(
		(e) => actionOf(e) === 'edit' && e.status === 'pending' && sameTarget(e, probe)
	);
}

/** 提案を断る理由に、未反映の提案を踏まえて検証していることを添える(読み取りで見える本文とは食い違う) */
function withPendingNote(reason: string, pendingCount: number): string {
	if (!pendingCount || !reason.startsWith('該当箇所')) return reason;
	return `${reason}。同じ対象に未反映の提案が ${pendingCount} 件あり、それらを反映した後の本文に対して検証しています(読み取りで見える本文は反映前です)。old が先行の提案で書き換わる箇所と重なっていないか確認してください。重なる場合は、ユーザーが先行の提案を反映または却下してからやり直すか、先行の提案を含めた形で 1 つの提案にまとめてください`;
}

/** 反映できなかった理由に、同じ対象の別の編集と重なった可能性を添える */
function withConflictNote(edit: EditState, reason: string): string {
	if (!reason.startsWith('該当箇所')) return reason;
	const others = allEdits().filter(
		(e) => e !== edit && actionOf(e) === 'edit' && e.status === 'applied' && sameTarget(e, edit)
	);
	return others.length
		? `${reason}。同じ対象に反映済みの別の編集(${others.length} 件)と重なって、先に書き換わった可能性があります`
		: reason;
}

/** 対象(sceneId / entity)が決まっていなければ、ファイルから探して決める */
async function resolveTarget(edit: EditState): Promise<boolean> {
	if (edit.sceneId || edit.entity) return true;
	const target = await findTarget(edit.file);
	if (!target) {
		markFailed(edit, '編集できるファイルではないため反映できません');
		return false;
	}
	edit.sceneTitle = target.title;
	if (target.type === 'scene') edit.sceneId = target.id;
	else edit.entity = target.ref;
	return true;
}

async function applyCreate(edit: EditState, batch: SyncBatch) {
	let record: EntityRecord;
	if (edit.snapshot && edit.entity) {
		// 一度取り消したあとの再反映は、同じ ID で復元する
		const restored = await restoreEntity(edit.entity.kind, edit.snapshot, edit.touched);
		if (!restored.ok) return markFailed(edit, restored.reason);
		queueLater(batch, restored.sync);
		record = edit.snapshot;
	} else {
		if (!edit.create) return markFailed(edit, '追加する内容が記録されていません');
		const spec = edit.create;
		if (
			spec.kind === 'progressLogs' &&
			(await progressLogsDB.getByDate(spec.projectId, spec.init.date as string))
		)
			return markFailed(edit, `${spec.init.date} の進捗は既にあります`);
		const created = await createEntity(plainSpec(spec));
		queueLater(batch, created.sync);
		edit.entity = { kind: spec.kind, id: created.record.id };
		record = created.record;
	}
	if (edit.entity?.kind === 'chapters') syncChapterStore(record as Chapter);
	notifyChanged(...ALL_KINDS);
	edit.status = 'applied';
	edit.error = undefined;
}

const plainSpec = (spec: CreateSpec): CreateSpec => JSON.parse(JSON.stringify(spec));

async function applyDelete(edit: EditState, batch: SyncBatch) {
	if (!edit.entity) return markFailed(edit, '削除する項目が記録されていません');
	const removed = await removeEntity(edit.entity.kind as DeletableKind, edit.entity.id);
	if (!removed.ok) return markFailed(edit, removed.reason);
	queueLater(batch, removed.sync);
	edit.snapshot = removed.snapshot;
	edit.touched = removed.touched;
	if (edit.entity.kind === 'chapters') syncChapterStore(null, edit.entity.id);
	notifyChanged(...ALL_KINDS);
	edit.status = 'applied';
	edit.error = undefined;
}

/** 同じ対象への編集は、読み書きを 1 回にまとめて順に適用する。1 つの例外で残りを止めない */
async function applyEdits(edits: EditState[], batch: SyncBatch) {
	// 反映の途中であることを見せる(終わると applied か failed になる)
	for (const edit of edits) {
		edit.status = 'applying';
		edit.error = undefined;
	}
	const units: EditState[][] = [];
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- 関数内だけで使う一時的な入れ物で、リアクティブにする必要がない
	const byTarget = new Map<string, EditState[]>();
	for (const edit of edits) {
		if (actionOf(edit) !== 'edit') {
			units.push([edit]);
			continue;
		}
		try {
			if (!(await resolveTarget(edit))) continue;
		} catch (error) {
			markFailed(edit, `反映中にエラーが起きました: ${String(error)}`);
			continue;
		}
		const key = edit.sceneId ? `scene:${edit.sceneId}` : `${edit.entity!.kind}:${edit.entity!.id}`;
		const unit = byTarget.get(key);
		if (unit) unit.push(edit);
		else {
			const fresh = [edit];
			byTarget.set(key, fresh);
			units.push(fresh);
		}
	}

	for (const unit of units) {
		try {
			const first = unit[0];
			if (actionOf(first) === 'create') {
				await applyCreate(first, batch);
			} else if (actionOf(first) === 'delete') {
				await applyDelete(first, batch);
			} else {
				const changes = unit.map(
					(e): ChangeFn =>
						(content) =>
							replaceOnce(content, e.old, e.new)
				);
				const results = first.sceneId
					? await editScene(first.sceneId, changes, true, batch)
					: await editEntity(first.entity!, changes, true, batch);
				unit.forEach((edit, i) => {
					const result = results[i];
					if (result.ok) markApplied(edit, result);
					else markFailed(edit, result.reason);
				});
				for (const edit of unit)
					if (edit.status === 'failed') edit.error = withConflictNote(edit, edit.error ?? '');
			}
		} catch (error) {
			for (const edit of unit)
				if (edit.status !== 'applied')
					markFailed(edit, `反映中にエラーが起きました: ${String(error)}`);
		}
	}
}

/** 編集案を 1 件反映する(同期キューへの登録まで行う) */
async function applyEdit(edit: EditState) {
	const batch = newBatch();
	try {
		await applyEdits([edit], batch);
	} finally {
		await flushSyncSafely(batch);
	}
}

/** 同期キューへの登録に失敗しても、反映そのものは成功として扱う */
async function flushSyncSafely(batch: SyncBatch) {
	try {
		await flushSync(batch);
	} catch (error) {
		console.error('同期キューへの登録に失敗しました', error);
	}
}

/** 反映した編集を元に戻す。例外は edit.error に記録し、投げない */
async function revertEdit(edit: EditState, batch?: SyncBatch) {
	const own = batch ?? newBatch();
	const previous = edit.status;
	edit.status = 'reverting';
	try {
		await revertCore(edit, own);
	} catch (error) {
		edit.error = `元に戻せません: ${String(error)}`;
	} finally {
		// 戻せなかったときは、もとの状態(反映済み)に戻す
		if (edit.status === 'reverting') edit.status = previous;
		if (!batch) await flushSyncSafely(own);
	}
}

async function revertCore(edit: EditState, batch: SyncBatch) {
	const action = actionOf(edit);
	if (action === 'create' || action === 'delete') {
		const ref = edit.entity;
		if (!ref) {
			edit.error = '元に戻せません: 対象が記録されていません';
			return;
		}
		if (action === 'create') {
			// 追加の取り消しは削除。あとで再度反映できるよう、そのときの状態を残す
			const removed = await removeEntity(ref.kind as DeletableKind | 'chapters', ref.id);
			if (!removed.ok) {
				edit.error = `元に戻せません: ${removed.reason}`;
				return;
			}
			queueLater(batch, removed.sync);
			edit.snapshot = removed.snapshot;
			edit.touched = removed.touched;
			if (ref.kind === 'chapters') syncChapterStore(null, ref.id);
		} else {
			if (!edit.snapshot) {
				edit.error = '元に戻せません: 削除前の内容が記録されていません';
				return;
			}
			const restored = await restoreEntity(ref.kind, edit.snapshot, edit.touched);
			if (!restored.ok) {
				edit.error = `元に戻せません: ${restored.reason}`;
				return;
			}
			queueLater(batch, restored.sync);
		}
		notifyChanged(...ALL_KINDS);
		edit.status = 'reverted';
		edit.error = undefined;
		return;
	}

	const change: ChangeFn = (content) =>
		revertAt(content, edit.appliedAt, edit.contextBefore, edit.new, edit.old);
	let result: ReplaceResult;
	if (edit.entity) {
		result = (await editEntity(edit.entity, [change], true, batch))[0];
	} else {
		const target = edit.sceneId ? null : await findTarget(edit.file);
		const sceneId = edit.sceneId ?? (target?.type === 'scene' ? target.id : undefined);
		result = sceneId
			? await updateScene(sceneId, change, true, batch)
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

/** 新規・削除の見出しに使う種類の名前 */
const ACTION_KIND_LABELS: Record<EntityKind, string> = { ...KIND_LABELS, chapters: '章' };

const replacer =
	(edit: EditState): ChangeFn =>
	(content) =>
		replaceOnce(content, edit.old, edit.new);

/** 提案(propose_*)を受けられる状態か確かめる。だめなら MCP の失敗結果を返す */
function beginProposal(runId: string): { message: ChatMessage; mode: EditMode } | ToolResult {
	const message = runningAssistant(runId);
	if (!message) return toolError('この操作は Claude の回答中にだけ使えます');
	const mode = message.editMode ?? 'suggest';
	if (mode === 'suggest') return toolError('提案のみの設定では本文や項目を変更できません');
	return { message, mode };
}

/** 検証を通った提案を回答に記録する。confirm は承認待ち、auto はその場で反映して結果を返す */
async function recordProposal(
	message: ChatMessage,
	mode: EditMode,
	draft: Omit<EditState, 'status'>,
	label: string
): Promise<ToolResult> {
	if (!message.edits) message.edits = [];
	message.edits.push({ ...draft, status: 'pending' });
	const edit = message.edits[message.edits.length - 1];
	persistChats();
	if (mode === 'confirm') {
		return toolOk(`提案を記録しました(承認待ち): ${label}。ユーザーが差分を確認して反映します。`);
	}
	await applyEdit(edit);
	persistChats();
	return edit.status === 'applied'
		? toolOk(`反映しました: ${label}`)
		: toolError(`反映できませんでした: ${edit.error ?? '理由が不明です'}`);
}

/** 一括操作の実行中か(二重に実行しないための印) */
let busy = $state(false);

/** 一括操作を 1 つずつだけ実行する。実行中に呼ばれたら何もしない */
async function exclusive(task: () => Promise<void>) {
	if (busy) return;
	busy = true;
	try {
		await task();
	} finally {
		busy = false;
		persistChats();
	}
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
			(changes.claudePath !== undefined && changes.claudePath !== settings.claudePath) ||
			(changes.provider !== undefined && changes.provider !== settings.provider) ||
			(changes.ollamaUrl !== undefined && changes.ollamaUrl !== settings.ollamaUrl);
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
	/** Ollama に入っているモデル(接続を確かめたときの一覧) */
	get ollamaModels() {
		return ollamaModels;
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
	 * 同じ対象にまだ反映していない編集案があるときは、それらを反映した状態に対して確かめる。
	 */
	async proposeEdit(runId: string, input: ProposeInput): Promise<ToolResult> {
		const begun = beginProposal(runId);
		if ('isError' in begun) return begun;
		const change: ChangeFn = (content) => replaceOnce(content, input.old, input.new);
		let draft: Omit<EditState, 'status'>;
		let check: ReplaceResult;
		let pendingCount = 0;
		if (input.kind === 'scene') {
			const scene = await scenesDB.getById(input.id);
			if (!scene) return toolError(`シーンが見つかりません: ${input.id}`);
			const earlier = pendingOn({ sceneId: scene.id });
			pendingCount = earlier.length;
			const results = await editScene(scene.id, [...earlier.map(replacer), change], false);
			check = results[results.length - 1];
			draft = {
				action: 'edit',
				file: await sceneFilePath(scene.id),
				old: input.old,
				new: input.new,
				sceneId: scene.id,
				sceneTitle: scene.title
			};
		} else if (isEditableKind(input.kind)) {
			const kind = input.kind;
			const ref: EntityRef = { kind, id: input.id };
			const loaded = await loadEntity(ref);
			if (!loaded) return toolError(`項目が見つかりません: ${kind} ${input.id}`);
			const earlier = pendingOn({ entity: ref });
			pendingCount = earlier.length;
			const results = await editEntity(ref, [...earlier.map(replacer), change], false);
			check = results[results.length - 1];
			draft = {
				action: 'edit',
				file: await entityFilePath(kind, loaded.entity),
				old: input.old,
				new: input.new,
				entity: ref,
				sceneTitle: `${KIND_LABELS[kind]}: ${entityTitle(kind, loaded.entity as never)}`
			};
		} else {
			return toolError(
				input.kind === 'history'
					? '履歴は読み取り専用のため変更できません'
					: `編集できない種類です: ${input.kind}`
			);
		}
		if (!check.ok) return toolError(withPendingNote(check.reason, pendingCount));
		const recorded = await recordProposal(
			begun.message,
			begun.mode,
			draft,
			draft.file || draft.sceneTitle || ''
		);
		if (!recorded.isError && introducesRepeat(check.content, check.index, input.old, input.new))
			recorded.text +=
				'\n注意: 反映すると同じ文が続けて 2 回並びます。old に含めなかった元の文を new にも入れていないか確認し、重複していれば propose_edit で直してください。';
		return recorded;
	},

	/** Claude の propose_create(MCP)を処理する。項目の新規追加を提案として記録する(反映の扱いは propose_edit と同じ) */
	async proposeCreate(runId: string, input: ProposeCreateInput): Promise<ToolResult> {
		const begun = beginProposal(runId);
		if ('isError' in begun) return begun;
		if (!isCreatableKind(input.kind)) {
			return toolError(
				input.kind === 'scene'
					? 'シーンの新規作成には対応していません'
					: input.kind === 'history'
						? '履歴は読み取り専用のため変更できません'
						: `新規追加できない種類です: ${input.kind}`
			);
		}
		const projectId = input.projectId || page.params?.id;
		if (!projectId)
			return toolError(
				'作品が開かれていません。projectId を指定してください(list_projects で確認できます)'
			);
		if (!(await db.projects.get(projectId))) return toolError(`作品が見つかりません: ${projectId}`);
		const prepared = await prepareCreate(input.kind, projectId, input.fields);
		if (!prepared.ok) return toolError(prepared.reason);

		const kind = input.kind;
		const ctx = await entityContextFor(kind, prepared.draft as never);
		const title = entityTitle(kind, prepared.draft as never);
		const draft: Omit<EditState, 'status'> = {
			action: 'create',
			file: '',
			old: '',
			new: renderEntity(kind, prepared.draft as never, ctx),
			create: prepared.spec,
			sceneTitle: `新規: ${ACTION_KIND_LABELS[kind]} ${title}`
		};
		return recordProposal(begun.message, begun.mode, draft, draft.sceneTitle!);
	},

	/** Claude の propose_delete(MCP)を処理する。項目の削除を提案として記録する(反映の扱いは propose_edit と同じ) */
	async proposeDelete(runId: string, input: ProposeDeleteInput): Promise<ToolResult> {
		const begun = beginProposal(runId);
		if ('isError' in begun) return begun;
		if (!isDeletableKind(input.kind)) {
			return toolError(
				input.kind === 'history'
					? '履歴は読み取り専用のため削除できません'
					: input.kind === 'scene' || input.kind === 'chapters'
						? 'シーンと章の削除には対応していません'
						: `削除できない種類です: ${input.kind}`
			);
		}
		const kind = input.kind;
		const ref: EntityRef = { kind, id: input.id };
		const loaded = await loadEntity(ref);
		if (!loaded) return toolError(`項目が見つかりません: ${kind} ${input.id}`);
		if (
			allEdits().some(
				(e) =>
					actionOf(e) === 'delete' &&
					e.status === 'pending' &&
					e.entity?.kind === kind &&
					e.entity.id === input.id
			)
		)
			return toolError('この項目の削除は既に提案済みです');
		const draft: Omit<EditState, 'status'> = {
			action: 'delete',
			file: await entityFilePath(kind, loaded.entity),
			old: renderEntity(kind, loaded.entity as never, loaded.ctx),
			new: '',
			entity: ref,
			sceneTitle: `削除: ${ACTION_KIND_LABELS[kind]} ${entityTitle(kind, loaded.entity as never)}`
		};
		return recordProposal(begun.message, begun.mode, draft, draft.sceneTitle!);
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
			if (settings.provider === 'ollama') {
				const r = await getOllamaStatus(settings.ollamaUrl);
				ollamaModels = r.models;
				status = { found: r.found, version: r.version, error: r.error };
				return;
			}
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
					// 会話の ID は AI ごとに別物なので、切り替えたあとは引き継がない
					sessionId:
						conv.sessionId?.startsWith('ollama-') === (settings.provider === 'ollama')
							? conv.sessionId
							: undefined,
					provider: settings.provider,
					ollamaUrl: settings.ollamaUrl || undefined,
					model:
						(settings.provider === 'ollama' ? settings.ollamaModel : settings.model) || undefined,
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
		await exclusive(() => applyEdit(edit));
	},

	rejectEdit(edit: EditState) {
		edit.status = 'rejected';
		persistChats();
	},

	/** 反映した編集を元に戻す */
	async revertEdit(edit: EditState) {
		await exclusive(() => revertEdit(edit));
	},

	/** 一括操作の実行中か */
	get busy() {
		return busy;
	},

	/** 回答に含まれる未反映の編集案をすべて反映する(1 件の失敗で残りを止めない) */
	async applyAll(message: ChatMessage) {
		await exclusive(async () => {
			const batch = newBatch();
			const pending = (message.edits ?? []).filter((e) => e.status === 'pending');
			try {
				await applyEdits(pending, batch);
			} catch (error) {
				for (const edit of pending)
					if (edit.status === 'pending' || edit.status === 'applying')
						markFailed(edit, `反映中にエラーが起きました: ${String(error)}`);
			} finally {
				await flushSyncSafely(batch);
			}
		});
	},

	/** 回答で反映した編集をすべて元に戻す(後から反映したものから順に) */
	async revertAll(message: ChatMessage) {
		await exclusive(async () => {
			const batch = newBatch();
			try {
				for (const edit of [...(message.edits ?? [])].reverse()) {
					if (edit.status === 'applied') await revertEdit(edit, batch);
				}
			} finally {
				await flushSyncSafely(batch);
			}
		});
	},

	/** 未反映の編集案をすべて却下する */
	rejectAll(message: ChatMessage) {
		if (busy) return;
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
		await exclusive(async () => {
			const batch = newBatch();
			try {
				// 後ろの変更から処理し、前の変更の位置がずれないようにする
				for (const { edit } of [...this.editorEdits].reverse()) {
					if (action === 'keep' && edit.status === 'applied') edit.reviewed = true;
					else if (action === 'revert' && edit.status === 'applied') await revertEdit(edit, batch);
					else if (action === 'apply' && edit.status === 'pending') await applyEdits([edit], batch);
					else if (action === 'reject' && edit.status === 'pending') edit.status = 'rejected';
				}
			} finally {
				await flushSyncSafely(batch);
			}
		});
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
