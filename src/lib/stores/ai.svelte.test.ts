import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExitEvent, SendRequest } from '$lib/desktop/ai';

const env = vi.hoisted(() => ({
	sent: [] as { req: SendRequest; resolve: (e: ExitEvent) => void; onLine: (l: string) => void }[],
	cancelled: [] as string[]
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('$lib/services/sync.service', () => ({ queueChanges: async () => {} }));
vi.mock('$lib/desktop/ai', () => ({
	sendNativeRun: (req: SendRequest, onLine: (l: string) => void) =>
		new Promise<ExitEvent>((resolve) => env.sent.push({ req, resolve, onLine })),
	releaseNativeRun: async () => {},
	attachNativeRun: async () => null,
	cancelNativeRun: async (id: string) => {
		env.cancelled.push(id);
	},
	getClaudeStatus: async () => ({ found: true, loggedIn: true }),
	getOllamaStatus: async () => ({ found: true, models: [] }),
	openClaudeLogin: async () => {},
	fetchToolDefinitions: async () => []
}));

async function loadStore() {
	vi.resetModules();
	return (await import('./ai.svelte')).aiStore;
}

beforeEach(() => {
	localStorage.clear();
	env.sent.length = 0;
	env.cancelled.length = 0;
});

describe('設定の読み込みと移行', () => {
	it('旧キーの旧形式の設定を、新キー・新形式で読み込み、旧キーは残す', async () => {
		const old = JSON.stringify({ provider: 'ollama', ollamaUrl: 'http://h:1', ollamaModel: 'm' });
		localStorage.setItem('storift:claude-settings', old);
		localStorage.setItem('storift:claude-panel', JSON.stringify({ open: true, width: 500 }));
		const store = await loadStore();
		expect(store.settings.provider).toBe('ollama');
		expect(store.settings.ollama).toEqual({ url: 'http://h:1', model: 'm' });
		expect(store.open).toBe(true);
		expect(store.width).toBe(500);
		expect(localStorage.getItem('storift:claude-settings')).toBe(old);
		expect(localStorage.getItem('storift:ai-panel')).toContain('500');
	});

	it('設定の変更は新キーに保存される', async () => {
		const store = await loadStore();
		store.updateSettings({ editMode: 'auto' });
		store.updateProviderSettings('openaiCompatible', { model: 'gpt-x' });
		const saved = JSON.parse(localStorage.getItem('storift:ai-settings') ?? '{}');
		expect(saved.editMode).toBe('auto');
		expect(saved.openaiCompatible.model).toBe('gpt-x');
		expect(localStorage.getItem('storift:claude-settings')).toBeNull();
	});

	it('保存された ID のプロバイダが無ければ Claude Code を使う', async () => {
		localStorage.setItem('storift:ai-settings', JSON.stringify({ provider: 'future-ai' }));
		const store = await loadStore();
		expect(store.settings.provider).toBe('future-ai');
		expect(store.provider.id).toBe('claude-code');
	});
});

describe('送信と中断', () => {
	it('選んだプロバイダ(Ollama)で送り、別のプロバイダのセッション ID は引き継がない', async () => {
		localStorage.setItem(
			'storift:ai-settings',
			JSON.stringify({ provider: 'ollama', ollama: { url: 'http://h:1', model: 'qwen' } })
		);
		const store = await loadStore();
		void store.send('こんにちは');
		await vi.waitFor(() => expect(env.sent).toHaveLength(1));
		expect(env.sent[0].req).toMatchObject({
			provider: 'ollama',
			model: 'qwen',
			ollamaUrl: 'http://h:1',
			prompt: expect.stringContaining('こんにちは')
		});
		expect(env.sent[0].req.sessionId).toBeUndefined();
		env.sent[0].onLine(
			JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ollama-abc' })
		);
		env.sent[0].resolve({ requestId: 'x', code: 0, cancelled: false, stderr: '' });
		await vi.waitFor(() => expect(store.isRunning).toBe(false));

		// 同じプロバイダなら続きの会話になる
		void store.send('続き');
		await vi.waitFor(() => expect(env.sent).toHaveLength(2));
		expect(env.sent[1].req.sessionId).toBe('ollama-abc');
		env.sent[1].resolve({ requestId: 'x', code: 0, cancelled: false, stderr: '' });
		await vi.waitFor(() => expect(store.isRunning).toBe(false));

		// Claude Code に切り替えると、Ollama のセッションは使わない
		store.updateSettings({ provider: 'claude-code' });
		void store.send('また別');
		await vi.waitFor(() => expect(env.sent).toHaveLength(3));
		expect(env.sent[2].req.provider).toBe('claude');
		expect(env.sent[2].req.sessionId).toBeUndefined();
		env.sent[2].resolve({ requestId: 'x', code: 0, cancelled: false, stderr: '' });
		await vi.waitFor(() => expect(store.isRunning).toBe(false));
	});

	it('キャンセルはネイティブ側の実行を止め、「中断しました」を残す', async () => {
		const store = await loadStore();
		void store.send('長い質問');
		await vi.waitFor(() => expect(env.sent).toHaveLength(1));
		await store.cancel();
		expect(env.cancelled).toEqual([env.sent[0].req.requestId]);
		env.sent[0].resolve({ requestId: 'x', code: null, cancelled: true, stderr: '' });
		await vi.waitFor(() => expect(store.isRunning).toBe(false));

		expect(store.messages.at(-1)).toMatchObject({ role: 'error', text: '中断しました。' });
	});

	it('認証のエラーは、どのプロバイダのものかを残す', async () => {
		localStorage.setItem('storift:ai-settings', JSON.stringify({ provider: 'ollama' }));
		const store = await loadStore();
		void store.send('q');
		await vi.waitFor(() => expect(env.sent).toHaveLength(1));
		env.sent[0].resolve({
			requestId: 'x',
			code: 1,
			cancelled: false,
			stderr: 'キーが違います',
			authError: true
		});
		await vi.waitFor(() => expect(store.isRunning).toBe(false));
		expect(store.messages.at(-1)).toMatchObject({ role: 'error', auth: true, provider: 'ollama' });
	});
});
