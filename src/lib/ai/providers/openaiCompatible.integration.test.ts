// @vitest-environment node
/**
 * 偽の OpenAI 互換サーバー(http.createServer)に、実際の fetch で接続する統合テスト。
 * fetch の差し替えでは確かめられない、TCP 上の SSE の分割・接続の切断・ヘッダーを確かめる。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStreamLine, createTurnState, turnParts } from '$lib/desktop/stream';
import { DEFAULT_AI_SETTINGS } from '../settings';
import type { AiRunRequest } from '../types';
import { createOpenAiCompatibleProvider } from './openaiCompatible';

const KEY = 'sk-integration-0123456789abcdef';

interface Seen {
	method?: string;
	url?: string;
	auth?: string;
	body?: { messages: Record<string, unknown>[]; tools?: unknown[]; stream?: boolean };
}

let server: http.Server;
let base: string;
let seen: Seen[];
/** リクエストごとの応答(順番に使う) */
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
				auth: req.headers.authorization,
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
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterEach(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

function provider() {
	return createOpenAiCompatibleProvider({
		getFetch: async () => globalThis.fetch,
		getKey: async () => KEY,
		loadTools: async () => [
			{ name: 'search', description: '検索', inputSchema: { type: 'object', properties: {} } }
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
			provider: 'openai-compatible',
			openaiCompatible: { baseUrl: base, model: 'm', presetId: 'custom' }
		},
		...over
	};
}

function collector() {
	const turn = createTurnState();
	return { turn, emit: (line: string) => applyStreamLine(turn, line) };
}

const data = (delta: unknown, finish: string | null = null) =>
	`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

const sseHead = (res: http.ServerResponse) =>
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });

describe('偽の OpenAI 互換サーバー', () => {
	it('SSE を 1 バイトずつに近い細切れで受け取っても、テキストを組み立てられる', async () => {
		handlers.push((_req, res) => {
			sseHead(res);
			const wire =
				data({ content: 'こんにちは' }) + data({ content: '、世界' }, 'stop') + 'data: [DONE]\n\n';
			const bytes = Buffer.from(wire);
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
		expect(seen[0]).toMatchObject({
			method: 'POST',
			url: '/v1/chat/completions',
			auth: `Bearer ${KEY}`
		});
		expect(seen[0].body?.stream).toBe(true);
	});

	it('ツール呼び出しを挟む 2 往復の会話', async () => {
		handlers.push((_req, res) => {
			sseHead(res);
			res.write(
				data({
					tool_calls: [
						{
							index: 0,
							id: 'call_1',
							type: 'function',
							function: { name: 'search', arguments: '' }
						}
					]
				})
			);
			res.write(data({ tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] }));
			res.write(
				data({ tool_calls: [{ index: 0, function: { arguments: '"月"}' } }] }, 'tool_calls')
			);
			res.end('data: [DONE]\n\n');
		});
		handlers.push((_req, res, s) => {
			sseHead(res);
			const tool = s.body?.messages.at(-1);
			res.end(data({ content: `結果=${String(tool?.content)}` }, 'stop') + 'data: [DONE]\n\n');
		});
		const { turn, emit } = collector();
		const exit = await provider().run(request(), emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(seen).toHaveLength(2);
		expect(seen[1].body?.messages.at(-1)).toEqual({
			role: 'tool',
			tool_call_id: 'call_1',
			content: 'search:{"query":"月"}'
		});
		expect(turnParts(turn).at(-1)).toEqual({ kind: 'text', text: '結果=search:{"query":"月"}' });
	});

	it('401 は認証のエラーとして返し、キーを含めない', async () => {
		handlers.push((_req, res) => {
			res.writeHead(401, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: { message: `Invalid key ${KEY}` } }));
		});
		const { emit } = collector();
		const exit = await provider().run(request(), emit, new AbortController().signal);
		expect(exit).toMatchObject({ code: 1, authError: true });
		expect(exit.stderr).toContain('認証に失敗');
		expect(exit.stderr).not.toContain(KEY);
	});

	it('ストリームの途中で中断すると、サーバーへの接続が閉じられ、cancelled で返る', async () => {
		let closed = false;
		handlers.push((req, res) => {
			sseHead(res);
			res.write(data({ content: 'ゆっくり' }));
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

	it('モデル一覧と接続テスト(GET /models)', async () => {
		handlers.push((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ object: 'list', data: [{ id: 'm' }, { id: 'n' }] }));
		});
		const r = await provider().testConnection!(request().settings);
		expect(r).toMatchObject({ ok: true, models: ['m', 'n'] });
		expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/models', auth: `Bearer ${KEY}` });
	});

	it('サーバーに接続できないときは、接続できない旨を返す', async () => {
		const settings = request().settings;
		await new Promise((resolve) => server.close(resolve));
		const r = await provider().testConnection!(settings);
		expect(r.ok).toBe(false);
		expect(r.message).toContain('接続できませんでした');
		expect(r.message).not.toContain(KEY);
		// afterEach が閉じ直せるよう、再び待ち受ける
		server = http.createServer();
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	});
});
