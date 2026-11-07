import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExitEvent, SendRequest } from './ai';
import type { Chapter, Character, Project, Scene } from '$lib/types';

// ページ(開いている作品・シーン)と、Claude の実行(送信・出力・終了)を差し替える
const env = vi.hoisted(() => ({
	page: {
		params: { id: 'p1' } as Record<string, string>,
		url: new URL('http://localhost/project/p1')
	},
	queued: [] as { type: string; id: string; action: string }[][],
	sent: [] as {
		req: SendRequest;
		onLine: (line: string) => void;
		resolve: (e: ExitEvent) => void;
	}[]
}));

vi.mock('$app/state', () => ({ page: env.page }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('$lib/services/sync.service', () => ({
	queueChanges: async (changes: { type: string; id: string; action: string }[]) => {
		env.queued.push(changes);
	}
}));
vi.mock('$lib/desktop/ai', () => ({
	sendNativeRun: (req: SendRequest, onLine: (line: string) => void) =>
		new Promise<ExitEvent>((resolve) => env.sent.push({ req, onLine, resolve })),
	releaseNativeRun: async () => {},
	attachNativeRun: async () => null,
	cancelNativeRun: async () => {},
	getClaudeStatus: async () => ({ found: true }),
	openClaudeLogin: async () => {},
	syncWorkspace: async () => ({ files: [], projectDirs: {}, sceneFiles: {}, entityFiles: {} })
}));

const { db, scenesDB, charactersDB } = await import('$lib/db');
const { callTool } = await import('./mcp');
const { aiStore } = await import('$lib/stores/ai.svelte');
const { editorStore } = await import('$lib/stores/editor.svelte');
const { currentProjectStore } = await import('$lib/stores/currentProject.svelte');

const SCENE_TEXT = '夜明けの街は静かだった。\n\n少年は駅へ向かった。';

function project(): Project {
	return {
		id: 'p1',
		title: '星の物語',
		description: '',
		createdAt: 0,
		updatedAt: 1,
		status: 'writing',
		settings: {
			writingMode: 'vertical',
			fontSize: 16,
			theme: 'light',
			goal: { type: 'daily', target: 1000 }
		},
		_version: 1
	};
}

function chapter(): Chapter {
	return {
		id: 'c1',
		projectId: 'p1',
		title: '一章',
		order: 0,
		synopsis: '',
		createdAt: 0,
		updatedAt: 0,
		_version: 1
	};
}

function scene(id: string, title: string, order: number, content: string): Scene {
	return {
		id,
		chapterId: 'c1',
		projectId: 'p1',
		title,
		content,
		order,
		characterCount: content.length,
		tags: [],
		createdAt: 0,
		updatedAt: 0,
		_version: 1
	};
}

function character(
	id: string,
	name: string,
	appearance: string,
	createdAt = 0,
	order?: number
): Character {
	return {
		id,
		projectId: 'p1',
		name,
		role: '主人公',
		appearance,
		personality: '',
		background: '',
		relationships: [],
		order,
		createdAt,
		updatedAt: 0,
		_version: 1
	};
}

async function seed() {
	await Promise.all(db.tables.map((table) => table.clear()));
	await db.projects.put(project());
	await db.chapters.put(chapter());
	await db.scenes.bulkPut([
		scene('s1', '始まり', 0, SCENE_TEXT),
		scene('s2', '出会い', 1, '別の場面')
	]);
	await db.characters.bulkPut([
		character('ch1', 'アキ', '黒髪の少年', 1),
		// 一覧は手動順(order が無ければ作成順)。作成順は アキ・チカ・ベニ
		character('ch2', 'ベニ', '赤い外套', 3),
		character('ch3', 'チカ', '白い仮面', 2)
	]);
}

/** 実行を始める。送信は保留され、テストが出力と終了を決める */
function startRun(text: string) {
	const done = aiStore.send(text);
	const run = env.sent[env.sent.length - 1];
	return { run, done };
}

/** 実行を正常に終えて、送信の完了を待つ */
async function finishRun(run: (typeof env.sent)[number], done: Promise<void>) {
	run.onLine(
		JSON.stringify({
			type: 'result',
			subtype: 'success',
			is_error: false,
			result: '完了',
			session_id: 's'
		})
	);
	run.resolve({ requestId: run.req.requestId, code: 0, cancelled: false, stderr: '' });
	await done;
}

/** 実行中の回答メッセージ(MCP の呼び出し元) */
function assistantOf(requestId: string) {
	return aiStore.messages.find((m) => m.id === requestId);
}

describe('MCP の読み取り', () => {
	beforeEach(async () => {
		await seed();
		env.page.params = { id: 'p1' };
		env.page.url = new URL('http://localhost/project/p1');
		editorStore.currentScene = null;
	});

	it('一覧は id・題名・補足だけで、本文を含まない', async () => {
		const result = await callTool('list_items', { kind: 'characters' }, 'x');
		expect(result.isError).toBe(false);
		expect(result.text).toContain('アキ');
		expect(result.text).toContain('主人公');
		expect(result.text).not.toContain('黒髪');
	});

	it('一覧は手動順(order)で並ぶ。order が無ければ作成順', async () => {
		const names = (text: string) => [...text.matchAll(/ch\d {2}(\S+?)\(/g)].map((m) => m[1]);
		const before = await callTool('list_items', { kind: 'characters' }, 'x');
		expect(names(before.text)).toEqual(['アキ', 'チカ', 'ベニ']);

		await db.characters.update('ch2', { order: 1024 });
		await db.characters.update('ch1', { order: 2048 });
		await db.characters.update('ch3', { order: 3072 });
		const after = await callTool('list_items', { kind: 'characters' }, 'x');
		expect(names(after.text)).toEqual(['ベニ', 'アキ', 'チカ']);

		// order はファイルに書き出す項目ではない
		const item = await callTool('get_item', { kind: 'characters', id: 'ch2' }, 'x');
		expect(item.text).not.toMatch(/order/i);
	});

	it('limit と cursor で続きのページを取れる', async () => {
		const first = await callTool('list_items', { kind: 'characters', limit: 2 }, 'x');
		expect(first.text).toContain('全 3 件のうち 1〜2 件目');
		expect(first.text).toContain('cursor を "2"');
		expect(first.text).not.toContain('ベニ');

		const next = await callTool('list_items', { kind: 'characters', limit: 2, cursor: '2' }, 'x');
		expect(next.text).toContain('ベニ');
		expect(next.text).not.toContain('アキ');
		expect(next.text).not.toContain('次のページ');
	});

	it('項目の種類と作品の指定を確かめる', async () => {
		expect((await callTool('list_items', { kind: 'chapters' }, 'x')).isError).toBe(true);
		expect(
			(await callTool('list_items', { kind: 'characters', projectId: 'nope' }, 'x')).isError
		).toBe(true);
		env.page.params = {};
		const noProject = await callTool('get_outline', {}, 'x');
		expect(noProject).toMatchObject({ isError: true });
		expect(noProject.text).toContain('projectId を指定');
	});

	it('開いているシーンは未保存の本文を優先して読む', async () => {
		editorStore.currentScene = (await db.scenes.get('s1')) ?? null;
		env.page.url = new URL('http://localhost/project/p1/editor');
		editorStore.content = '未保存の本文';

		const result = await callTool('get_scene', { sceneId: 's1' }, 'x');
		expect(result.text).toContain('未保存の本文');
		expect(result.text).not.toContain('夜明け');

		const other = await callTool('get_scene', { sceneId: 's2' }, 'x');
		expect(other.text).toContain('別の場面');
	});

	it('get_scene は offset と limit で区切って読める', async () => {
		const result = await callTool('get_scene', { sceneId: 's1', limit: 4 }, 'x');
		expect(result.text).toContain('夜明け');
		expect(result.text).toContain('offset 4');
	});

	it('search は一致した箇所を返し、未対応の kinds を拒否する', async () => {
		const hit = await callTool('search', { query: '夜明け' }, 'x');
		expect(hit.text).toContain('一致 1 件');
		expect(hit.text).toContain('(s1)');

		const character = await callTool('search', { query: '黒髪', kinds: ['characters'] }, 'x');
		expect(character.text).toContain('アキ');

		const bad = await callTool('search', { query: '夜明け', kinds: ['nope'] }, 'x');
		expect(bad.isError).toBe(true);
	});

	it('get_item は項目のファイルと同じ内容を返す', async () => {
		const result = await callTool('get_item', { kind: 'characters', id: 'ch1' }, 'x');
		expect(result.text).toContain('# アキ');
		expect(result.text).toContain('黒髪の少年');
	});

	it('未知のツールは isError で返す', async () => {
		expect(await callTool('nope', {}, 'x')).toMatchObject({ isError: true });
	});
});

describe('propose_edit', () => {
	beforeEach(async () => {
		await seed();
		env.sent.length = 0;
		env.page.params = { id: 'p1' };
		env.page.url = new URL('http://localhost/project/p1');
		editorStore.currentScene = null;
		currentProjectStore.project = project();
		aiStore.newChat();
	});

	it('提案のみの設定では使えず、編集案も残らない', async () => {
		aiStore.updateSettings({ editMode: 'suggest' });
		const { run, done } = startRun('直して');
		expect(run.req.editMode).toBe('suggest');
		expect(run.req.appendSystemPrompt).toBeUndefined();

		const result = await aiStore.proposeEdit(run.req.requestId, {
			kind: 'scene',
			id: 's1',
			old: '夜明け',
			new: '朝焼け'
		});
		expect(result).toMatchObject({ isError: true });
		expect(result.text).toContain('提案のみ');
		expect(assistantOf(run.req.requestId)?.edits).toBeUndefined();
		await finishRun(run, done);
	});

	it('確認モードは承認待ちとして記録し、本文は変えない', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('直して');
		expect(run.req.editMode).toBe('confirm');
		expect(run.req.appendSystemPrompt).toContain('propose_edit');
		expect(run.req.prompt).toContain('projectId: p1');

		const result = await aiStore.proposeEdit(run.req.requestId, {
			kind: 'scene',
			id: 's1',
			old: '夜明け',
			new: '朝焼け'
		});
		expect(result).toMatchObject({ isError: false });
		expect(result.text).toContain('承認待ち');

		const edit = assistantOf(run.req.requestId)?.edits?.[0];
		expect(edit).toMatchObject({ status: 'pending', sceneId: 's1' });
		expect(edit?.file).toBe('projects/星の物語/本文/01_一章/01_始まり.md');
		expect((await scenesDB.getById('s1'))?.content).toBe(SCENE_TEXT);

		await finishRun(run, done);
		// 承認(反映)すると本文に入る
		await aiStore.applyEdit(edit!);
		expect((await scenesDB.getById('s1'))?.content).toContain('朝焼けの街');
	});

	it('自動反映モードはその場で反映し、元に戻せる', async () => {
		aiStore.updateSettings({ editMode: 'auto' });
		const { run, done } = startRun('直して');
		const result = await aiStore.proposeEdit(run.req.requestId, {
			kind: 'scene',
			id: 's1',
			old: '夜明け',
			new: '朝焼け'
		});
		expect(result).toMatchObject({ isError: false });
		expect(result.text).toContain('反映しました');
		expect((await scenesDB.getById('s1'))?.content).toContain('朝焼けの街');

		const edit = assistantOf(run.req.requestId)!.edits![0];
		expect(edit.status).toBe('applied');
		await aiStore.revertEdit(edit);
		expect(edit.status).toBe('reverted');
		expect((await scenesDB.getById('s1'))?.content).toBe(SCENE_TEXT);
		await finishRun(run, done);
	});

	it('項目(キャラクター)も kind と id で指定して反映できる', async () => {
		aiStore.updateSettings({ editMode: 'auto' });
		const { run, done } = startRun('直して');
		const result = await callTool(
			'propose_edit',
			{ kind: 'characters', id: 'ch1', old: '黒髪', new: '銀髪' },
			run.req.requestId
		);
		expect(result).toMatchObject({ isError: false });
		expect((await db.characters.get('ch1'))?.appearance).toBe('銀髪の少年');
		await finishRun(run, done);
	});

	it('検証に失敗したら理由を返し、編集案は残さない', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('直して');
		const id = run.req.requestId;

		const missing = await aiStore.proposeEdit(id, {
			kind: 'scene',
			id: 's1',
			old: 'ない文',
			new: 'x'
		});
		expect(missing).toMatchObject({ isError: true });
		expect(missing.text).toContain('該当箇所が見つかりません');

		const many = await aiStore.proposeEdit(id, {
			kind: 'scene',
			id: 's1',
			old: '。',
			new: '.'
		});
		expect(many).toMatchObject({ isError: true });
		expect(many.text).toContain('2 か所');

		const locked = await aiStore.proposeEdit(id, {
			kind: 'characters',
			id: 'ch1',
			old: 'アキ',
			new: 'ユウ'
		});
		expect(locked).toMatchObject({ isError: true });
		expect(locked.text).toContain('編集できない部分');

		expect(assistantOf(id)?.edits ?? []).toHaveLength(0);
		await finishRun(run, done);
	});

	it('履歴は編集できず、回答中でなければ使えない', async () => {
		aiStore.updateSettings({ editMode: 'auto' });
		const { run, done } = startRun('直して');
		const history = await aiStore.proposeEdit(run.req.requestId, {
			kind: 'history',
			id: 'h1',
			old: 'a',
			new: 'b'
		});
		expect(history).toMatchObject({ isError: true });
		expect(history.text).toContain('履歴は読み取り専用');
		await finishRun(run, done);

		const late = await aiStore.proposeEdit(run.req.requestId, {
			kind: 'scene',
			id: 's1',
			old: '夜明け',
			new: '朝焼け'
		});
		expect(late).toMatchObject({ isError: true });
		expect(late.text).toContain('回答中');
	});

	it('開いているシーンへの提案は、未保存の本文を基準に確かめる', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		editorStore.currentScene = (await db.scenes.get('s1')) ?? null;
		env.page.url = new URL('http://localhost/project/p1/editor');
		editorStore.content = '未保存の夜明け';

		const { run, done } = startRun('直して');
		const result = await aiStore.proposeEdit(run.req.requestId, {
			kind: 'scene',
			id: 's1',
			old: '未保存',
			new: '保存前'
		});
		expect(result).toMatchObject({ isError: false });
		await finishRun(run, done);
		editorStore.currentScene = null;
	});

	it('以前の形式の会話は、開き直すと古い --resume を捨てる', async () => {
		const { run, done } = startRun('最初の質問');
		await finishRun(run, done);
		const first = aiStore.sessions[0];
		expect(first.sessionId).toBe('s');
		first.mcp = false;

		aiStore.newChat();
		aiStore.openSession(first.id);
		expect(aiStore.sessions.find((s) => s.id === first.id)?.sessionId).toBeUndefined();
	});
});

/** 提案系のテストの共通の準備 */
async function prepareProposals() {
	await seed();
	env.sent.length = 0;
	env.queued.length = 0;
	env.page.params = { id: 'p1' };
	env.page.url = new URL('http://localhost/project/p1');
	editorStore.currentScene = null;
	currentProjectStore.project = project();
	currentProjectStore.chapters = [chapter()];
	aiStore.newChat();
}

const queuedFlat = () => env.queued.flat();

describe('propose_create', () => {
	beforeEach(prepareProposals);

	it('確認モードは承認待ちで記録し、反映すると追加され、取り消すと削除される', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('キャラを足して');
		expect(run.req.appendSystemPrompt).toContain('propose_create');
		const result = await callTool(
			'propose_create',
			{ kind: 'characters', fields: { 名前: 'タロウ', 役割: '友人', 外見: '茶髪' } },
			run.req.requestId
		);
		expect(result).toMatchObject({ isError: false });
		expect(result.text).toContain('承認待ち');
		expect(await db.characters.count()).toBe(3);

		const edit = assistantOf(run.req.requestId)!.edits![0];
		expect(edit).toMatchObject({ action: 'create', status: 'pending', old: '' });
		expect(edit.sceneTitle).toBe('新規: キャラクター タロウ');
		expect(edit.new).toContain('茶髪');
		await finishRun(run, done);

		await aiStore.applyEdit(edit);
		expect(edit.status).toBe('applied');
		const created = await db.characters.get(edit.entity!.id);
		expect(created).toMatchObject({
			name: 'タロウ',
			role: '友人',
			appearance: '茶髪',
			projectId: 'p1'
		});
		expect(queuedFlat()).toContainEqual({ type: 'characters', id: created!.id, action: 'create' });

		await aiStore.revertEdit(edit);
		expect(edit.status).toBe('reverted');
		expect(await db.characters.get(created!.id)).toBeUndefined();
		expect(queuedFlat().at(-1)).toEqual({ type: 'characters', id: created!.id, action: 'delete' });

		// 取り消したあとの再反映は同じ ID で復元される
		await aiStore.applyEdit(edit);
		expect(edit.status).toBe('applied');
		expect((await db.characters.get(created!.id))?.name).toBe('タロウ');
	});

	it('自動モードは種類ごとにその場で追加する(章は画面の状態も更新)', async () => {
		aiStore.updateSettings({ editMode: 'auto' });
		const { run, done } = startRun('足して');
		const id = run.req.requestId;
		const call = (kind: string, fields: Record<string, unknown>) =>
			callTool('propose_create', { kind, fields }, id);

		expect(
			await call('plots', { タイトル: '起', 種類: '章', 状態: '予定', 内容: '導入' })
		).toMatchObject({ isError: false });
		expect(await db.plots.toArray()).toMatchObject([
			{ title: '起', type: 'chapter', status: 'planned', content: '導入' }
		]);

		expect(
			await call('worldbuilding', {
				タイトル: '王国',
				分類: '場所',
				タグ: ['国', '北'],
				内容: '寒い'
			})
		).toMatchObject({ isError: false });
		expect(await db.worldbuilding.toArray()).toMatchObject([
			{ title: '王国', category: 'location', tags: ['国', '北'], content: '寒い' }
		]);

		expect(await call('memos', { 本文: '伏線を回収する', タグ: '要確認' })).toMatchObject({
			isError: false
		});
		expect(await db.memos.toArray()).toMatchObject([
			{ text: '伏線を回収する', tags: ['要確認'], projectId: 'p1' }
		]);

		expect(
			await call('progressLogs', { 日付: '2026-01-02', 文字数: 1200, '時間(分)': 30 })
		).toMatchObject({ isError: false });
		expect(await db.progressLogs.toArray()).toMatchObject([
			{ date: '2026-01-02', charactersWritten: 1200, timeSpent: 30 }
		]);

		expect(await call('chapters', { タイトル: '二章', 概要: '旅立ち' })).toMatchObject({
			isError: false
		});
		const chapter2 = (await db.chapters.toArray()).find((c) => c.title === '二章');
		expect(chapter2).toMatchObject({ synopsis: '旅立ち', order: 1 });
		expect(currentProjectStore.chapters.map((c) => c.title)).toEqual(['一章', '二章']);
		expect(queuedFlat()).toContainEqual({ type: 'chapters', id: chapter2!.id, action: 'create' });
		// 端末内だけのデータは同期しない
		expect(
			queuedFlat().filter(
				(c) => c.type !== 'chapters' && c.type !== 'plots' && c.type !== 'worldbuilding'
			)
		).toEqual([]);

		const chapterEdit = assistantOf(id)!.edits!.at(-1)!;
		await aiStore.revertEdit(chapterEdit);
		expect(await db.chapters.get(chapter2!.id)).toBeUndefined();
		expect(currentProjectStore.chapters.map((c) => c.title)).toEqual(['一章']);
		await finishRun(run, done);
	});

	it('章にシーンが追加されていたら取り消せない', async () => {
		aiStore.updateSettings({ editMode: 'auto' });
		const { run, done } = startRun('足して');
		await callTool(
			'propose_create',
			{ kind: 'chapters', fields: { タイトル: '三章' } },
			run.req.requestId
		);
		const edit = assistantOf(run.req.requestId)!.edits![0];
		await db.scenes.put({ ...scene('sx', '新', 0, 'x'), chapterId: edit.entity!.id });
		await aiStore.revertEdit(edit);
		expect(edit.status).toBe('applied');
		expect(edit.error).toContain('シーンがある');
		await finishRun(run, done);
	});

	it('不正な入力は理由を返し、編集案を残さない', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('足して');
		const id = run.req.requestId;
		await db.progressLogs.put({
			id: 'l1',
			projectId: 'p1',
			date: '2026-02-01',
			charactersWritten: 0,
			timeSpent: 0,
			sceneIds: [],
			createdAt: 0
		});
		const cases: [Record<string, unknown>, string][] = [
			[{ kind: 'characters', fields: { 役割: '友人' } }, '「名前」は必須'],
			[{ kind: 'characters', fields: { 名前: 'A', 年齢: '3' } }, '未対応の項目名'],
			[{ kind: 'characters', fields: 'x' }, 'オブジェクト'],
			[{ kind: 'plots', fields: { タイトル: 'A', 種類: '謎' } }, '「種類」'],
			[{ kind: 'plots', fields: { タイトル: 'A', 種類: '章', 状態: '謎' } }, '「状態」の値が不正'],
			[{ kind: 'worldbuilding', fields: { タイトル: 'A', 分類: '謎' } }, '「分類」'],
			[{ kind: 'memos', fields: { タグ: 'a' } }, '「本文」は必須'],
			[{ kind: 'progressLogs', fields: { 日付: '2026-13-40' } }, '「日付」の値が不正'],
			[{ kind: 'progressLogs', fields: { 日付: '2026-02-01' } }, '既にあります'],
			[
				{ kind: 'progressLogs', fields: { 日付: '2026-03-01', 文字数: 'abc' } },
				'「文字数」の値が不正'
			],
			[{ kind: 'scene', fields: { タイトル: 'A' } }, 'シーンの新規作成'],
			[{ kind: 'relationMaps', fields: {} }, '新規追加できない種類'],
			[{ kind: 'characters', fields: { 名前: 'A' }, projectId: 'nope' }, '作品が見つかりません']
		];
		for (const [args, message] of cases) {
			const result = await callTool('propose_create', args, id);
			expect(result.isError, JSON.stringify(args)).toBe(true);
			expect(result.text, JSON.stringify(args)).toContain(message);
		}
		const noFields = await callTool('propose_create', { kind: 'characters' }, id);
		expect(noFields.isError).toBe(true);
		expect(assistantOf(id)?.edits ?? []).toHaveLength(0);
		await finishRun(run, done);
	});

	it('提案のみの設定では使えない', async () => {
		aiStore.updateSettings({ editMode: 'suggest' });
		const { run, done } = startRun('足して');
		const result = await callTool(
			'propose_create',
			{ kind: 'characters', fields: { 名前: 'A' } },
			run.req.requestId
		);
		expect(result).toMatchObject({ isError: true });
		expect(result.text).toContain('提案のみ');
		await finishRun(run, done);
	});
});

describe('propose_delete', () => {
	beforeEach(async () => {
		await prepareProposals();
		await charactersDB.update('ch1', { relationships: [{ characterId: 'ch2', relation: '友人' }] });
		await charactersDB.update('ch2', {
			relationships: [
				{ characterId: 'ch1', relation: '友人' },
				{ characterId: 'ch3', relation: '宿敵' }
			]
		});
		await db.relationMaps.put({
			id: 'p1',
			projectId: 'p1',
			positions: { ch1: { x: 1, y: 2 }, ch2: { x: 3, y: 4 }, ch3: { x: 5, y: 6 } },
			groups: [],
			edgeStyles: { 'ch1>ch2>友人': { color: 'red' }, 'ch2>ch1>友人': {}, 'ch2>ch3>宿敵': {} },
			updatedAt: 0
		});
		env.queued.length = 0;
	});

	it('確認モードは承認待ちで、反映するとキャラクターと参照が消え、取り消すと丸ごと戻る', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('消して');
		const before = (await db.characters.get('ch1'))!;
		const result = await callTool(
			'propose_delete',
			{ kind: 'characters', id: 'ch1' },
			run.req.requestId
		);
		expect(result).toMatchObject({ isError: false });
		expect(result.text).toContain('承認待ち');
		expect(await db.characters.get('ch1')).toBeDefined();
		const edit = assistantOf(run.req.requestId)!.edits![0];
		expect(edit).toMatchObject({ action: 'delete', status: 'pending', new: '' });
		expect(edit.sceneTitle).toBe('削除: キャラクター アキ');
		expect(edit.old).toContain('黒髪の少年');
		// 同じ削除の二重提案は断る
		const again = await callTool(
			'propose_delete',
			{ kind: 'characters', id: 'ch1' },
			run.req.requestId
		);
		expect(again.isError).toBe(true);
		await finishRun(run, done);

		await aiStore.applyEdit(edit);
		expect(edit.status).toBe('applied');
		expect(await db.characters.get('ch1')).toBeUndefined();
		expect((await db.characters.get('ch2'))?.relationships).toEqual([
			{ characterId: 'ch3', relation: '宿敵' }
		]);
		const map = (await db.relationMaps.get('p1'))!;
		expect(Object.keys(map.positions).sort()).toEqual(['ch2', 'ch3']);
		expect(Object.keys(map.edgeStyles)).toEqual(['ch2>ch3>宿敵']);
		expect(queuedFlat()).toContainEqual({ type: 'characters', id: 'ch1', action: 'delete' });
		expect(queuedFlat()).toContainEqual({ type: 'characters', id: 'ch2', action: 'update' });

		await aiStore.revertEdit(edit);
		expect(edit.status).toBe('reverted');
		const restored = (await db.characters.get('ch1'))!;
		expect(restored).toEqual(before);
		expect((await db.characters.get('ch2'))?.relationships).toHaveLength(2);
		const restoredMap = (await db.relationMaps.get('p1'))!;
		expect(restoredMap.positions.ch1).toEqual({ x: 1, y: 2 });
		expect(Object.keys(restoredMap.edgeStyles).sort()).toEqual([
			'ch1>ch2>友人',
			'ch2>ch1>友人',
			'ch2>ch3>宿敵'
		]);
	});

	it('自動モードは種類ごとにその場で削除する', async () => {
		aiStore.updateSettings({ editMode: 'auto' });
		await db.plots.put({
			id: 'pl1',
			projectId: 'p1',
			title: '起',
			type: 'arc',
			status: 'idea',
			content: '',
			position: { x: 0, y: 0 },
			color: '#000',
			order: 0,
			createdAt: 0,
			updatedAt: 0,
			_version: 1
		});
		await db.worldbuilding.put({
			id: 'w1',
			projectId: 'p1',
			category: 'term',
			title: '語',
			content: '',
			tags: [],
			attachments: [],
			createdAt: 0,
			updatedAt: 0,
			_version: 1
		});
		await db.memos.put({
			id: 'm1',
			projectId: 'p1',
			text: 'メモ',
			tags: [],
			done: false,
			createdAt: 0,
			updatedAt: 0
		});
		await db.progressLogs.put({
			id: 'l1',
			projectId: 'p1',
			date: '2026-02-01',
			charactersWritten: 0,
			timeSpent: 0,
			sceneIds: [],
			createdAt: 0
		});
		const { run, done } = startRun('消して');
		const id = run.req.requestId;
		for (const [kind, target] of [
			['plots', 'pl1'],
			['worldbuilding', 'w1'],
			['memos', 'm1'],
			['progressLogs', 'l1']
		]) {
			expect(await callTool('propose_delete', { kind, id: target }, id)).toMatchObject({
				isError: false
			});
		}
		expect(await db.plots.count()).toBe(0);
		expect(await db.worldbuilding.count()).toBe(0);
		expect(await db.memos.count()).toBe(0);
		expect(await db.progressLogs.count()).toBe(0);
		// 取り消しで丸ごと戻る
		const edits = assistantOf(id)!.edits!;
		for (const edit of edits) await aiStore.revertEdit(edit);
		expect((await db.memos.get('m1'))?.text).toBe('メモ');
		expect((await db.progressLogs.get('l1'))?.date).toBe('2026-02-01');
		expect((await db.plots.get('pl1'))?.title).toBe('起');
		expect((await db.worldbuilding.get('w1'))?.title).toBe('語');
		await finishRun(run, done);
	});

	it('削除できない種類・存在しない項目は理由を返す', async () => {
		aiStore.updateSettings({ editMode: 'auto' });
		const { run, done } = startRun('消して');
		const id = run.req.requestId;
		for (const [kind, target, message] of [
			['chapters', 'c1', '章の削除'],
			['scene', 's1', 'シーン'],
			['history', 'h', '読み取り専用'],
			['relationMaps', 'p1', '削除できない種類'],
			['characters', 'nope', '見つかりません']
		]) {
			const result = await callTool('propose_delete', { kind, id: target }, id);
			expect(result.isError, kind).toBe(true);
			expect(result.text, kind).toContain(message);
		}
		expect(await db.chapters.count()).toBe(1);
		expect(assistantOf(id)?.edits ?? []).toHaveLength(0);
		await finishRun(run, done);
	});
});

describe('まとめて反映', () => {
	beforeEach(prepareProposals);

	it('1 件が例外になっても残りを反映し、失敗した編集に理由を残す', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('直して');
		const id = run.req.requestId;
		await callTool('propose_edit', { kind: 'characters', id: 'ch1', old: '黒髪', new: '銀髪' }, id);
		await callTool('propose_edit', { kind: 'characters', id: 'ch2', old: '赤い', new: '青い' }, id);
		await callTool('propose_edit', { kind: 'scene', id: 's2', old: '別の', new: '同じ' }, id);
		await finishRun(run, done);
		const message = assistantOf(id)!;

		const spy = vi.spyOn(charactersDB, 'update').mockRejectedValueOnce(new Error('disk full'));
		await aiStore.applyAll(message);
		spy.mockRestore();

		const [first, second, third] = message.edits!;
		expect(first.status).toBe('failed');
		expect(first.error).toContain('disk full');
		expect(second.status).toBe('applied');
		expect(third.status).toBe('applied');
		expect((await db.characters.get('ch2'))?.appearance).toBe('青い外套');
		expect((await scenesDB.getById('s2'))?.content).toBe('同じ場面');
		expect(aiStore.busy).toBe(false);
		// 同期キューへの登録は 1 回にまとまる
		expect(env.queued).toHaveLength(1);
		expect(env.queued[0]).toEqual(
			expect.arrayContaining([
				{ type: 'characters', id: 'ch2', action: 'update' },
				{ type: 'scenes', id: 's2', action: 'update' }
			])
		);

		// 元に戻すときも 1 件の例外で止まらない
		const revertSpy = vi.spyOn(scenesDB, 'update').mockRejectedValueOnce(new Error('locked'));
		await aiStore.revertAll(message);
		revertSpy.mockRestore();
		expect(third.status).toBe('applied');
		expect(third.error).toContain('locked');
		expect(second.status).toBe('reverted');
	});

	it('実行中の二重実行を防ぎ、同じ対象への編集は 1 回の書き込みにまとめる', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('直して');
		const id = run.req.requestId;
		await callTool('propose_edit', { kind: 'scene', id: 's1', old: '夜明け', new: '朝焼け' }, id);
		await callTool('propose_edit', { kind: 'scene', id: 's1', old: '少年', new: '少女' }, id);
		await finishRun(run, done);
		const message = assistantOf(id)!;

		const spy = vi.spyOn(scenesDB, 'update');
		const first = aiStore.applyAll(message);
		expect(aiStore.busy).toBe(true);
		const second = aiStore.applyAll(message);
		await Promise.all([first, second]);
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
		expect(aiStore.busy).toBe(false);
		expect(message.edits!.map((e) => e.status)).toEqual(['applied', 'applied']);
		const content = (await scenesDB.getById('s1'))!.content;
		expect(content).toContain('朝焼けの街');
		expect(content).toContain('少女は駅');

		await aiStore.revertAll(message);
		expect((await scenesDB.getById('s1'))?.content).toBe(SCENE_TEXT);
	});

	it('同じ対象の未反映の編集を踏まえて検証し、重なる提案は提案時に断る', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('直して');
		const id = run.req.requestId;
		const ok = await callTool(
			'propose_edit',
			{ kind: 'scene', id: 's1', old: '夜明けの街', new: '朝の街' },
			id
		);
		expect(ok.isError).toBe(false);
		// 先行の提案で消える文は、もう指定できない
		const overlap = await callTool(
			'propose_edit',
			{ kind: 'scene', id: 's1', old: '夜明け', new: '日暮れ' },
			id
		);
		expect(overlap.isError).toBe(true);
		expect(overlap.text).toContain('該当箇所が見つかりません');
		// 先行の提案が入れる文には依存できる
		const depends = await callTool(
			'propose_edit',
			{ kind: 'scene', id: 's1', old: '朝の街は', new: '朝の村は' },
			id
		);
		expect(depends.isError).toBe(false);
		await finishRun(run, done);

		const [first, second] = assistantOf(id)!.edits!;
		// 順番を逆にすると、依存した編集は反映できない
		await aiStore.applyEdit(second);
		expect(second.status).toBe('failed');
		await aiStore.applyEdit(first);
		await aiStore.applyEdit(second);
		expect(second.status).toBe('applied');
		expect((await scenesDB.getById('s1'))?.content).toContain('朝の村は静かだった');
	});

	it('反映済みの別の編集と重なって失敗したときは、そのことを添える', async () => {
		aiStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('直して');
		const id = run.req.requestId;
		await callTool('propose_edit', { kind: 'scene', id: 's1', old: '夜明け', new: '朝焼け' }, id);
		await callTool('propose_edit', { kind: 'scene', id: 's1', old: '少年', new: '少女' }, id);
		await finishRun(run, done);
		const [first, second] = assistantOf(id)!.edits!;
		await aiStore.applyEdit(first);
		// 間に本文が書き換わった
		await scenesDB.update('s1', { content: '全く別の本文' });
		await aiStore.applyEdit(second);
		expect(second.status).toBe('failed');
		expect(second.error).toContain('該当箇所が見つかりません');
		expect(second.error).toContain('反映済みの別の編集');
	});
});
