/**
 * デスクトップ版の MCP ツール(サーバー名 storift)の処理。
 *
 * Claude Code は src-tauri/src/mcp.rs の MCP サーバーを通じてこのツールを呼ぶ。
 * Rust 側は中継だけで、データの正本は IndexedDB なので、読み取りも編集案の記録もここで行う。
 * 結果は invoke('mcp_respond') で Rust へ返す。デスクトップ版でだけ動的に読み込む(Web 版には含めない)。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { editorStore } from '$lib/stores/editor.svelte';
import { claudeStore, type ToolResult } from '$lib/stores/claude.svelte';
import { entityContext, loadWorkspaceData, STATUS_LABELS, type WorkspaceData } from './workspace';
import {
	PLOT_STATUS_LABELS,
	PLOT_TYPE_LABELS,
	WORLD_LABELS,
	entityTitle,
	renderEntity
} from './entities';

/** Rust(mcp.rs)が emit する呼び出し */
interface McpRequest {
	reqId: string;
	runId: string;
	tool: string;
	args?: Record<string, unknown>;
}

type Args = Record<string, unknown>;
type Handler = (args: Args, runId: string) => Promise<ToolResult>;

/** 呼び出し側の誤り(引数の不備・対象が見つからない)。理由をそのまま Claude に返す */
class ToolError extends Error {}

const LIST_KINDS = [
	'characters',
	'plots',
	'worldbuilding',
	'memos',
	'progressLogs',
	'relationMaps',
	'history'
] as const;
type ListKind = (typeof LIST_KINDS)[number];

/** get_item で読める種類(章の概要を含む) */
const ITEM_KINDS = ['chapters', ...LIST_KINDS] as const;
type ItemKind = (typeof ITEM_KINDS)[number];

/** search の対象。history は既定では含めない(件数が多く、ノイズになりやすいため) */
const SEARCH_KINDS = [
	'scene',
	'chapters',
	'characters',
	'plots',
	'worldbuilding',
	'memos',
	'progressLogs',
	'relationMaps',
	'history'
] as const;
type SearchKind = (typeof SEARCH_KINDS)[number];
const DEFAULT_SEARCH_KINDS: SearchKind[] = SEARCH_KINDS.filter((k) => k !== 'history');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SCENE_CHUNK = 8000;
const MAX_SCENE_CHUNK = 20000;
const SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const RECENT_HISTORY = 50;

const toolOk = (text: string): ToolResult => ({ text, isError: false });

/* 引数の取り出し(不正なら ToolError) */

function str(args: Args, key: string): string {
	const value = args[key];
	if (typeof value !== 'string' || !value) throw new ToolError(`${key} を指定してください`);
	return value;
}

function optStr(args: Args, key: string): string | undefined {
	const value = args[key];
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string') throw new ToolError(`${key} は文字列で指定してください`);
	return value;
}

function optInt(args: Args, key: string, fallback: number, max: number): number {
	const value = args[key];
	if (value === undefined || value === null) return fallback;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
		throw new ToolError(`${key} は 0 以上の整数で指定してください`);
	return Math.min(value, max);
}

/** ページの続きを示す位置(一覧の cursor)。文字列でも数値でも受ける */
function cursorOf(args: Args): number {
	const value = args.cursor;
	if (value === undefined || value === null || value === '') return 0;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0)
		throw new ToolError('cursor は一覧が返した値をそのまま指定してください');
	return n;
}

function optStrList(args: Args, key: string): string[] | undefined {
	const value = args[key];
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))
		throw new ToolError(`${key} は文字列の配列で指定してください`);
	return value as string[];
}

/** 作品の指定。省略時は開いている作品 */
function projectOf(args: Args, data: WorkspaceData): string {
	const id = optStr(args, 'projectId') || claudeStore.openProjectId;
	if (!id)
		throw new ToolError(
			'作品が開かれていません。projectId を指定してください(list_projects で確認できます)'
		);
	if (!data.projects.some((p) => p.id === id)) throw new ToolError(`作品が見つかりません: ${id}`);
	return id;
}

/* 表示 */

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function timeLabel(ms: number): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 一覧の 1 行(id・題名・補足だけ。本文は含めない) */
interface Row {
	id: string;
	title: string;
	sub?: string;
}

function rowLines(rows: Row[]): string {
	return rows.map((r) => `- ${r.id}  ${oneLine(r.title)}${r.sub ? `(${r.sub})` : ''}`).join('\n');
}

/** シーンの本文。開いているシーンは未保存の編集を優先する */
function sceneText(scene: { id: string; content: string }): string {
	return claudeStore.openSceneId === scene.id ? editorStore.content : scene.content;
}

function inProject<T extends { projectId: string }>(items: T[], projectId: string): T[] {
	return items.filter((item) => item.projectId === projectId);
}

/** 一覧の並び順と表示内容。本文は含めない */
function listRows(kind: ListKind, data: WorkspaceData, projectId: string): Row[] {
	switch (kind) {
		case 'characters':
			return inProject(data.characters, projectId)
				.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
				.map((c) => ({ id: c.id, title: c.name, sub: c.role }));
		case 'plots':
			return inProject(data.plots, projectId)
				.sort((a, b) => a.order - b.order)
				.map((p) => ({
					id: p.id,
					title: p.title,
					sub: `${PLOT_TYPE_LABELS[p.type]} / ${PLOT_STATUS_LABELS[p.status]}`
				}));
		case 'worldbuilding': {
			const order = Object.keys(WORLD_LABELS);
			return inProject(data.worldbuilding, projectId)
				.sort(
					(a, b) =>
						order.indexOf(a.category) - order.indexOf(b.category) ||
						a.title.localeCompare(b.title, 'ja')
				)
				.map((w) => ({ id: w.id, title: w.title, sub: WORLD_LABELS[w.category] }));
		}
		case 'memos':
			return inProject(data.memos, projectId)
				.sort((a, b) => a.createdAt - b.createdAt)
				.map((m) => ({
					id: m.id,
					title: entityTitle('memos', m),
					sub: [m.done ? '完了' : '未完了', ...m.tags.map((t) => `#${t}`)].join(' ')
				}));
		case 'progressLogs':
			return inProject(data.progressLogs, projectId)
				.sort((a, b) => a.date.localeCompare(b.date))
				.map((l) => ({
					id: l.id,
					title: l.date,
					sub: `${l.charactersWritten}字 / ${l.timeSpent}分`
				}));
		case 'relationMaps':
			return inProject(data.relationMaps, projectId).map((m) => ({
				id: m.id,
				title: '相関図の配置',
				sub: `配置 ${Object.keys(m.positions).length} 件`
			}));
		case 'history':
			return inProject(data.history, projectId)
				.sort((a, b) => b.createdAt - a.createdAt)
				.map((h) => ({
					id: h.id,
					title: entityTitle('history', h),
					sub: timeLabel(h.createdAt)
				}));
	}
}

/** 一致を探す対象の 1 件(本文または項目の全文) */
interface Doc {
	id: string;
	title: string;
	text: string;
}

function documents(kind: SearchKind, data: WorkspaceData, projectId: string): Doc[] {
	const ctx = entityContext(data);
	if (kind === 'scene')
		return data.scenes
			.filter((s) => s.projectId === projectId)
			.map((s) => ({ id: s.id, title: s.title, text: sceneText(s) }));
	const items = inProject(data[kind] as unknown as { id: string; projectId: string }[], projectId);
	return items.map((item) => ({
		id: item.id,
		title: entityTitle(kind, item as never),
		text: renderEntity(kind, item as never, ctx)
	}));
}

/** 一致した箇所の前後を少しだけ示す */
function snippet(text: string, at: number, length: number): string {
	const start = Math.max(0, at - 30);
	const end = Math.min(text.length, at + length + 30);
	return oneLine(text.slice(start, end));
}

const HANDLERS: Record<string, Handler> = {
	async list_projects() {
		const data = await loadWorkspaceData();
		const rows: Row[] = [...data.projects]
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((p) => {
				const chars = data.scenes
					.filter((s) => s.projectId === p.id)
					.reduce((sum, s) => sum + s.characterCount, 0);
				const open = p.id === claudeStore.openProjectId ? ' / 開いている作品' : '';
				return {
					id: p.id,
					title: p.title,
					sub: `${STATUS_LABELS[p.status]} / ${chars}字${open}`
				};
			});
		return toolOk(rows.length ? rowLines(rows) : '作品はありません');
	},

	async get_outline(args) {
		const data = await loadWorkspaceData();
		const projectId = projectOf(args, data);
		const project = data.projects.find((p) => p.id === projectId);
		const chapters = inProject(data.chapters, projectId).sort((a, b) => a.order - b.order);
		const lines = [`# ${project?.title ?? ''}(projectId: ${projectId})`, ''];
		chapters.forEach((chapter, i) => {
			lines.push(`## 第${i + 1}章 ${chapter.title}(chapterId: ${chapter.id})`);
			const scenes = data.scenes
				.filter((s) => s.chapterId === chapter.id)
				.sort((a, b) => a.order - b.order);
			for (const s of scenes)
				lines.push(`- ${s.title}(sceneId: ${s.id}, ${sceneText(s).length}字)`);
			lines.push('');
		});
		if (!chapters.length) lines.push('(まだ章がありません)');
		return toolOk(lines.join('\n'));
	},

	async list_items(args) {
		const kind = str(args, 'kind');
		if (!(LIST_KINDS as readonly string[]).includes(kind))
			throw new ToolError(`kind は ${LIST_KINDS.join(' / ')} のいずれかです`);
		const data = await loadWorkspaceData();
		const projectId = projectOf(args, data);
		const limit = Math.max(1, optInt(args, 'limit', DEFAULT_LIMIT, MAX_LIMIT));
		const offset = cursorOf(args);
		const rows = listRows(kind as ListKind, data, projectId);
		if (!rows.length) return toolOk(`${kind} はありません`);
		const page = rows.slice(offset, offset + limit);
		if (!page.length) return toolOk(`${kind}: このページに項目はありません(全 ${rows.length} 件)`);
		const next =
			offset + limit < rows.length
				? `\n次のページ: cursor を "${offset + limit}" にして呼び出してください`
				: '';
		return toolOk(
			`${kind}: 全 ${rows.length} 件のうち ${offset + 1}〜${offset + page.length} 件目\n${rowLines(page)}${next}`
		);
	},

	async get_scene(args) {
		const sceneId = str(args, 'sceneId');
		const data = await loadWorkspaceData();
		const scene = data.scenes.find((s) => s.id === sceneId);
		if (!scene) throw new ToolError(`シーンが見つかりません: ${sceneId}`);
		const text = sceneText(scene);
		const offset = optInt(args, 'offset', 0, Number.MAX_SAFE_INTEGER);
		const limit = Math.max(1, optInt(args, 'limit', SCENE_CHUNK, MAX_SCENE_CHUNK));
		const chunk = text.slice(offset, offset + limit);
		const chapter = data.chapters.find((c) => c.id === scene.chapterId);
		const end = offset + chunk.length;
		const next = end < text.length ? `\n\n(続きは offset ${end} で取得できます)` : '';
		return toolOk(
			`# ${scene.title}\n(${chapter?.title ?? ''} / 全${text.length}字 / ${offset}〜${end}字目)\n\n${chunk}${next}`
		);
	},

	async get_item(args) {
		const kind = str(args, 'kind');
		if (!(ITEM_KINDS as readonly string[]).includes(kind))
			throw new ToolError(`kind は chapters / ${LIST_KINDS.join(' / ')} のいずれかです`);
		const id = str(args, 'id');
		const data = await loadWorkspaceData();
		const items = data[kind as ItemKind] as unknown as { id: string }[];
		const item = items.find((x) => x.id === id);
		if (!item) throw new ToolError(`項目が見つかりません: ${kind} ${id}`);
		return toolOk(renderEntity(kind as ItemKind, item as never, entityContext(data)));
	},

	async search(args) {
		const query = str(args, 'query').trim();
		if (!query) throw new ToolError('query を指定してください');
		const kinds = optStrList(args, 'kinds') ?? DEFAULT_SEARCH_KINDS;
		const unknown = kinds.find((k) => !(SEARCH_KINDS as readonly string[]).includes(k));
		if (unknown) throw new ToolError(`未対応の kinds です: ${unknown}`);
		const data = await loadWorkspaceData();
		const projectId = projectOf(args, data);
		const limit = Math.max(1, optInt(args, 'limit', SEARCH_LIMIT, MAX_SEARCH_LIMIT));
		const needle = query.toLowerCase();
		const hits: string[] = [];
		outer: for (const kind of kinds as SearchKind[]) {
			for (const doc of documents(kind, data, projectId)) {
				const at = doc.text.toLowerCase().indexOf(needle);
				if (at < 0) continue;
				hits.push(
					`- ${kind}  ${oneLine(doc.title)}(${doc.id})\n  …${snippet(doc.text, at, needle.length)}…`
				);
				if (hits.length >= limit) break outer;
			}
		}
		if (!hits.length) return toolOk(`"${query}" に一致する箇所はありません`);
		const more = hits.length >= limit ? '(上限まで表示)' : '';
		return toolOk(`"${query}" の一致 ${hits.length} 件${more}\n\n${hits.join('\n')}`);
	},

	async get_history(args) {
		const data = await loadWorkspaceData();
		const id = optStr(args, 'id');
		if (id) {
			const entry = data.history.find((h) => h.id === id);
			if (!entry) throw new ToolError(`履歴が見つかりません: ${id}`);
			return toolOk(renderEntity('history', entry, entityContext(data)));
		}
		const projectId = projectOf(args, data);
		const rows = listRows('history', data, projectId).slice(0, RECENT_HISTORY);
		if (!rows.length) return toolOk('履歴はありません');
		return toolOk(
			`${rowLines(rows)}\n\n(新しい順 ${RECENT_HISTORY} 件まで。詳細は id を指定して読めます)`
		);
	},

	async propose_edit(args, runId) {
		const kind = str(args, 'kind');
		const id = str(args, 'id');
		const old = str(args, 'old');
		if (typeof args.new !== 'string')
			throw new ToolError('new は文字列で指定してください(削除するときは空文字)');
		return claudeStore.proposeEdit(runId, { kind, id, old, new: args.new });
	},

	async propose_create(args, runId) {
		const kind = str(args, 'kind');
		if (args.fields === undefined || args.fields === null)
			throw new ToolError('fields を指定してください(項目名と値のオブジェクト)');
		return claudeStore.proposeCreate(runId, {
			kind,
			fields: args.fields,
			projectId: optStr(args, 'projectId')
		});
	},

	async propose_delete(args, runId) {
		return claudeStore.proposeDelete(runId, { kind: str(args, 'kind'), id: str(args, 'id') });
	}
};

/** ツールを 1 回呼ぶ。失敗は isError の結果として返し、例外は投げない */
export async function callTool(tool: string, args: Args, runId: string): Promise<ToolResult> {
	if (!Object.prototype.hasOwnProperty.call(HANDLERS, tool))
		return { text: `未対応のツールです: ${tool}`, isError: true };
	try {
		return await HANDLERS[tool](args ?? {}, runId);
	} catch (error) {
		const text = error instanceof ToolError ? error.message : `内部エラー: ${String(error)}`;
		return { text, isError: true };
	}
}

async function answer(request: McpRequest) {
	const result = await callTool(request.tool, request.args ?? {}, request.runId);
	try {
		await invoke('mcp_respond', { reqId: request.reqId, result });
	} catch (error) {
		console.error('mcp_respond に失敗しました', error);
	}
}

let started = false;

/** mcp://request を受け取り、ツールの結果を返す。アプリで 1 回だけ開始する */
export async function startMcpBridge(): Promise<void> {
	if (started) return;
	started = true;
	await listen<McpRequest>('mcp://request', (event) => {
		void answer(event.payload);
	});
}
