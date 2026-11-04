import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExitEvent, SendRequest } from './claude';
import type { Chapter, Character, Project, Scene } from '$lib/types';

// ページ(開いている作品・シーン)と、Claude の実行(送信・出力・終了)を差し替える
const env = vi.hoisted(() => ({
	page: {
		params: { id: 'p1' } as Record<string, string>,
		url: new URL('http://localhost/project/p1')
	},
	sent: [] as {
		req: SendRequest;
		onLine: (line: string) => void;
		resolve: (e: ExitEvent) => void;
	}[]
}));

vi.mock('$app/state', () => ({ page: env.page }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('$lib/services/sync.service', () => ({ queueChange: async () => {} }));
vi.mock('$lib/desktop/claude', () => ({
	sendToClaude: (req: SendRequest, onLine: (line: string) => void) =>
		new Promise<ExitEvent>((resolve) => env.sent.push({ req, onLine, resolve })),
	releaseClaude: async () => {},
	attachClaude: async () => null,
	cancelClaude: async () => {},
	getClaudeStatus: async () => ({ found: true }),
	openClaudeLogin: async () => {},
	syncWorkspace: async () => ({ files: [], projectDirs: {}, sceneFiles: {}, entityFiles: {} })
}));

const { db, scenesDB } = await import('$lib/db');
const { callTool } = await import('./mcp');
const { claudeStore } = await import('$lib/stores/claude.svelte');
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

function character(id: string, name: string, appearance: string): Character {
	return {
		id,
		projectId: 'p1',
		name,
		role: '主人公',
		appearance,
		personality: '',
		background: '',
		relationships: [],
		createdAt: 0,
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
		character('ch1', 'アキ', '黒髪の少年'),
		character('ch2', 'ベニ', '赤い外套'),
		character('ch3', 'チカ', '白い仮面')
	]);
}

/** 実行を始める。送信は保留され、テストが出力と終了を決める */
function startRun(text: string) {
	const done = claudeStore.send(text);
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
	return claudeStore.messages.find((m) => m.id === requestId);
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
		claudeStore.newChat();
	});

	it('提案のみの設定では使えず、編集案も残らない', async () => {
		claudeStore.updateSettings({ editMode: 'suggest' });
		const { run, done } = startRun('直して');
		expect(run.req.editMode).toBe('suggest');
		expect(run.req.appendSystemPrompt).toBeUndefined();

		const result = await claudeStore.proposeEdit(run.req.requestId, {
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
		claudeStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('直して');
		expect(run.req.editMode).toBe('confirm');
		expect(run.req.appendSystemPrompt).toContain('propose_edit');
		expect(run.req.prompt).toContain('projectId: p1');

		const result = await claudeStore.proposeEdit(run.req.requestId, {
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
		await claudeStore.applyEdit(edit!);
		expect((await scenesDB.getById('s1'))?.content).toContain('朝焼けの街');
	});

	it('自動反映モードはその場で反映し、元に戻せる', async () => {
		claudeStore.updateSettings({ editMode: 'auto' });
		const { run, done } = startRun('直して');
		const result = await claudeStore.proposeEdit(run.req.requestId, {
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
		await claudeStore.revertEdit(edit);
		expect(edit.status).toBe('reverted');
		expect((await scenesDB.getById('s1'))?.content).toBe(SCENE_TEXT);
		await finishRun(run, done);
	});

	it('項目(キャラクター)も kind と id で指定して反映できる', async () => {
		claudeStore.updateSettings({ editMode: 'auto' });
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
		claudeStore.updateSettings({ editMode: 'confirm' });
		const { run, done } = startRun('直して');
		const id = run.req.requestId;

		const missing = await claudeStore.proposeEdit(id, {
			kind: 'scene',
			id: 's1',
			old: 'ない文',
			new: 'x'
		});
		expect(missing).toMatchObject({ isError: true });
		expect(missing.text).toContain('該当箇所が見つかりません');

		const many = await claudeStore.proposeEdit(id, {
			kind: 'scene',
			id: 's1',
			old: '。',
			new: '.'
		});
		expect(many).toMatchObject({ isError: true });
		expect(many.text).toContain('2 か所');

		const locked = await claudeStore.proposeEdit(id, {
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
		claudeStore.updateSettings({ editMode: 'auto' });
		const { run, done } = startRun('直して');
		const history = await claudeStore.proposeEdit(run.req.requestId, {
			kind: 'history',
			id: 'h1',
			old: 'a',
			new: 'b'
		});
		expect(history).toMatchObject({ isError: true });
		expect(history.text).toContain('履歴は読み取り専用');
		await finishRun(run, done);

		const late = await claudeStore.proposeEdit(run.req.requestId, {
			kind: 'scene',
			id: 's1',
			old: '夜明け',
			new: '朝焼け'
		});
		expect(late).toMatchObject({ isError: true });
		expect(late.text).toContain('回答中');
	});

	it('開いているシーンへの提案は、未保存の本文を基準に確かめる', async () => {
		claudeStore.updateSettings({ editMode: 'confirm' });
		editorStore.currentScene = (await db.scenes.get('s1')) ?? null;
		env.page.url = new URL('http://localhost/project/p1/editor');
		editorStore.content = '未保存の夜明け';

		const { run, done } = startRun('直して');
		const result = await claudeStore.proposeEdit(run.req.requestId, {
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
		const first = claudeStore.sessions[0];
		expect(first.sessionId).toBe('s');
		first.mcp = false;

		claudeStore.newChat();
		claudeStore.openSession(first.id);
		expect(claudeStore.sessions.find((s) => s.id === first.id)?.sessionId).toBeUndefined();
	});
});
