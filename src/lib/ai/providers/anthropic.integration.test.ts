// @vitest-environment node
/**
 * 偽の Anthropic サーバー(http.createServer)に、実際の fetch で接続する統合テスト。
 * fetch の差し替えでは確かめられない、TCP 上の SSE の分割・接続の切断・ヘッダーを確かめる。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStreamLine, createTurnState, turnParts } from '$lib/desktop/stream';
import { DEFAULT_AI_SETTINGS } from '../settings';
import { anthropicMessage, anthropicText, anthropicToolUse } from '../test-helpers';
import type { AiRunRequest } from '../types';
import { createAnthropicProvider } from './anthropic';

const KEY = 'sk-ant-integration-0123456789abcdef';

interface Seen {
	method?: string;
	url?: string;
	headers: http.IncomingHttpHeaders;
	body?: {
		messages: { role: string; content: unknown }[];
		tools?: unknown[];
		[k: string]: unknown;
	};
}

let server: http.Server;
let base: string;
let seen: Seen[];
let handlers: ((req: http.IncomingMessage, res: http.ServerResponse, seen: Seen) => void)[];

beforeEach(async () => {
	seen = [];
	handlers = [];
	server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const s: Seen = {
				method: req.method,
				url: req.url,
				headers: req.headers,
				body: raw ? JSON.parse(raw) : undefined
			};
			seen.push(s);
			const handler = handlers[seen.length - 1];
			if (!handler) {
				res.writeHead(500).end('no handler');
				return;
			}
			handler(req, res, s);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

function provider() {
	return createAnthropicProvider({
		getFetch: async () => globalThis.fetch,
		getKey: async () => KEY,
		loadTools: async () => [
			{
				name: 'search',
				description: '検索',
				inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
			}
		],
		callTool: async (name, args) => ({ text: `${name}:${JSON.stringify(args)}`, isError: false })
	});
}

function request(over: Partial<AiRunRequest> = {}): AiRunRequest {
	return {
		runId: 'r1',
		prompt: '質問',
		editMode: 'suggest',
		settings: {
			...structuredClone(DEFAULT_AI_SETTINGS),
			provider: 'anthropic',
			anthropic: { baseUrl: base, model: 'claude-test', maxTokens: 1000 }
		},
		...over
	};
}

function collector() {
	const turn = createTurnState();
	return { turn, emit: (line: string) => applyStreamLine(turn, line) };
}

const sseHead = (res: http.ServerResponse) =>
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });

describe('偽の Anthropic サーバー', () => {
	it('SSE を細切れで受け取っても、テキストを組み立てられる。ヘッダーとボディの形も正しい', async () => {
		handlers.push((_req, res) => {
			sseHead(res);
			const bytes = Buffer.from(
				anthropicMessage(anthropicText(0, 'こんにちは', '、世界')).join('')
			);
			let i = 0;
			const timer = setInterval(() => {
				if (i >= bytes.length) {
					clearInterval(timer);
					res.end();
					return;
				}
				res.write(bytes.subarray(i, i + 5));
				i += 5;
			}, 1);
		});
		const { turn, emit } = collector();
		const exit = await provider().run(request(), emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(turnParts(turn)).toEqual([{ kind: 'text', text: 'こんにちは、世界' }]);
		expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/messages' });
		expect(seen[0].headers['x-api-key']).toBe(KEY);
		expect(seen[0].headers['anthropic-version']).toBe('2023-06-01');
		expect(seen[0].headers['content-type']).toContain('application/json');
		expect(seen[0].headers.authorization).toBeUndefined();
		expect(seen[0].body).toMatchObject({ model: 'claude-test', max_tokens: 1000, stream: true });
		expect(typeof seen[0].body?.system).toBe('string');
	});

	it('ツール呼び出しを挟む 2 往復の会話(tool_use → tool_result)', async () => {
		handlers.push((_req, res) => {
			sseHead(res);
			res.end(
				anthropicMessage(
					[
						...anthropicText(0, '調べます'),
						...anthropicToolUse(1, 'toolu_1', 'search', '{"query":', '"月"}')
					],
					'tool_use'
				).join('')
			);
		});
		handlers.push((_req, res, s) => {
			sseHead(res);
			const last = s.body?.messages.at(-1)?.content as { content: string }[];
			res.end(anthropicMessage(anthropicText(0, `結果=${last[0].content}`)).join(''));
		});
		const { turn, emit } = collector();
		const exit = await provider().run(request(), emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(seen).toHaveLength(2);
		expect(seen[1].body?.messages.at(-1)).toEqual({
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'search:{"query":"月"}' }]
		});
		expect(seen[1].body?.messages.at(-2)).toEqual({
			role: 'assistant',
			content: [
				{ type: 'text', text: '調べます' },
				{ type: 'tool_use', id: 'toolu_1', name: 'search', input: { query: '月' } }
			]
		});
		expect(turnParts(turn).at(-1)).toEqual({ kind: 'text', text: '結果=search:{"query":"月"}' });
	});

	it('401 は認証のエラーとして返し、キーを含めない', async () => {
		handlers.push((_req, res) => {
			res.writeHead(401, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					type: 'error',
					error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` }
				})
			);
		});
		const exit = await provider().run(request(), collector().emit, new AbortController().signal);
		expect(exit).toMatchObject({ code: 1, authError: true });
		expect(exit.stderr).toContain('認証に失敗');
		expect(exit.stderr).not.toContain(KEY);
	});

	it('529 と retry-after を、過負荷として返す', async () => {
		handlers.push((_req, res) => {
			res.writeHead(529, { 'content-type': 'application/json', 'retry-after': '12' });
			res.end(
				JSON.stringify({
					type: 'error',
					error: { type: 'overloaded_error', message: 'Overloaded' }
				})
			);
		});
		const exit = await provider().run(request(), collector().emit, new AbortController().signal);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('混雑');
	});

	it('ストリームの途中で中断すると、サーバーへの接続が閉じられ、cancelled で返る', async () => {
		let closed = false;
		handlers.push((req, res) => {
			sseHead(res);
			res.write(anthropicText(0, 'ゆっくり').join(''));
			req.on('close', () => (closed = true));
			res.on('close', () => (closed = true));
		});
		const { turn, emit } = collector();
		const controller = new AbortController();
		const done = provider().run(request(), emit, controller.signal);
		await vi.waitFor(() => expect(turnParts(turn)).toEqual([{ kind: 'text', text: 'ゆっくり' }]));
		controller.abort();
		expect(await done).toMatchObject({ code: null, cancelled: true });
		await vi.waitFor(() => expect(closed).toBe(true));
	});

	it('モデル一覧と接続テスト(GET /v1/models?limit=100)', async () => {
		handlers.push((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ data: [{ id: 'claude-test' }, { id: 'n' }], has_more: false }));
		});
		const r = await provider().testConnection!(request().settings);
		expect(r).toMatchObject({ ok: true, models: ['claude-test', 'n'] });
		expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/models?limit=100' });
		expect(seen[0].headers['x-api-key']).toBe(KEY);
		expect(seen[0].headers['anthropic-version']).toBe('2023-06-01');
	});

	it('サーバーに接続できないときは、接続できない旨を返す', async () => {
		const settings = request().settings;
		await new Promise((resolve) => server.close(resolve));
		const r = await provider().testConnection!(settings);
		expect(r.ok).toBe(false);
		expect(r.message).toContain('接続できませんでした');
		expect(r.message).not.toContain(KEY);
		server = http.createServer();
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	});
});
