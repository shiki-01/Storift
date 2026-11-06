import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExitEvent, SendRequest } from '$lib/desktop/ai';
import { DEFAULT_AI_SETTINGS } from '../settings';
import type { AiRunRequest } from '../types';

const env = vi.hoisted(() => ({
	sent: [] as { req: SendRequest; resolve: (e: ExitEvent) => void; onLine: (l: string) => void }[],
	cancelled: [] as string[]
}));

vi.mock('$lib/desktop/ai', () => ({
	sendNativeRun: (req: SendRequest, onLine: (l: string) => void) =>
		new Promise<ExitEvent>((resolve) => env.sent.push({ req, resolve, onLine })),
	cancelNativeRun: async (id: string) => {
		env.cancelled.push(id);
	},
	getClaudeStatus: async () => ({
		found: true,
		version: '1.0',
		loggedIn: true,
		path: '/bin/claude'
	}),
	getOllamaStatus: async () => ({ found: true, version: 'Ollama 0.5', models: ['qwen3:8b'] })
}));

const { claudeCodeProvider } = await import('./claudeCode');
const { ollamaProvider } = await import('./ollama');

function request(over: Partial<AiRunRequest> = {}): AiRunRequest {
	const settings = structuredClone(DEFAULT_AI_SETTINGS);
	settings.claudeCode = { model: 'opus', claudePath: '/x/claude', allowWeb: true };
	settings.ollama = { url: 'http://h:1', model: 'qwen3:8b' };
	return {
		runId: 'r1',
		prompt: 'hi',
		editMode: 'confirm',
		appendSystemPrompt: 'extra',
		sessionId: 's1',
		settings,
		...over
	};
}

beforeEach(() => {
	env.sent.length = 0;
	env.cancelled.length = 0;
});

const exit: ExitEvent = { requestId: 'r1', code: 0, cancelled: false, stderr: '' };

describe('Claude Code のアダプタ', () => {
	it('Rust の送信リクエストに、これまでと同じ内容を渡す', async () => {
		const done = claudeCodeProvider.run(request(), () => {}, new AbortController().signal);
		expect(env.sent[0].req).toEqual({
			requestId: 'r1',
			prompt: 'hi',
			sessionId: 's1',
			provider: 'claude',
			model: 'opus',
			allowWeb: true,
			claudePath: '/x/claude',
			ollamaUrl: undefined,
			editMode: 'confirm',
			appendSystemPrompt: 'extra'
		});
		env.sent[0].resolve(exit);
		expect(await done).toEqual(exit);
	});

	it('中断するとネイティブ側の実行を止める(終了後の中断では止めない)', async () => {
		const controller = new AbortController();
		const done = claudeCodeProvider.run(request(), () => {}, controller.signal);
		controller.abort();
		expect(env.cancelled).toEqual(['r1']);
		env.sent[0].resolve({ ...exit, code: null, cancelled: true });
		await done;
		const again = new AbortController();
		const second = claudeCodeProvider.run(request({ runId: 'r2' }), () => {}, again.signal);
		env.sent[1].resolve(exit);
		await second;
		again.abort();
		expect(env.cancelled).toEqual(['r1']);
	});

	it('出力の行をそのまま emit へ流す', async () => {
		const lines: string[] = [];
		const done = claudeCodeProvider.run(
			request(),
			(l) => lines.push(l),
			new AbortController().signal
		);
		env.sent[0].onLine('{"type":"system"}');
		env.sent[0].resolve(exit);
		await done;
		expect(lines).toEqual(['{"type":"system"}']);
	});

	it('status は claude_status の結果をそのまま返す', async () => {
		expect(await claudeCodeProvider.status(request().settings)).toMatchObject({
			found: true,
			loggedIn: true
		});
	});
});

describe('Ollama のアダプタ', () => {
	it('provider: ollama と接続先・モデルを渡し、Web 検索は許可しない', async () => {
		const done = ollamaProvider.run(request(), () => {}, new AbortController().signal);
		expect(env.sent[0].req).toMatchObject({
			provider: 'ollama',
			model: 'qwen3:8b',
			ollamaUrl: 'http://h:1',
			allowWeb: false,
			editMode: 'confirm'
		});
		env.sent[0].resolve(exit);
		await done;
	});

	it('status はモデル一覧を含む', async () => {
		expect(await ollamaProvider.status(request().settings)).toEqual({
			found: true,
			version: 'Ollama 0.5',
			error: undefined,
			models: ['qwen3:8b']
		});
		expect(await ollamaProvider.listModels!(request().settings)).toEqual(['qwen3:8b']);
	});
});
