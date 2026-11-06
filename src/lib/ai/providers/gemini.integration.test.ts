// @vitest-environment node
/**
 * 偽の Gemini サーバー(http.createServer)に、実際の fetch で接続する統合テスト。
 * fetch の差し替えでは確かめられない、TCP 上の SSE の分割・接続の切断・ヘッダーを確かめる。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStreamLine, createTurnState, turnParts } from '$lib/desktop/stream';
import { DEFAULT_AI_SETTINGS } from '../settings';
import { geminiChunk } from '../test-helpers';
import type { AiRunRequest } from '../types';
import { createGeminiProvider } from './gemini';

const KEY = 'AIzaSyIntegration0123456789abcdef';

interface Seen {
	method?: string;
	url?: string;
	headers: http.IncomingHttpHeaders;
	body?: {
		contents: { role: string; parts: Record<string, unknown>[] }[];
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
	return createGeminiProvider({
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
			provider: 'gemini',
			gemini: { baseUrl: base, model: 'gemini-test', maxOutputTokens: 1000 }
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

describe('偽の Gemini サーバー', () => {
	it('SSE を細切れで受け取っても、テキストを組み立てられる。ヘッダー・URL・ボディの形も正しい', async () => {
		handlers.push((_req, res) => {
			sseHead(res);
			const bytes = Buffer.from(
				geminiChunk([{ text: 'こんにちは' }]) + geminiChunk([{ text: '、世界' }], 'STOP')
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
		expect(seen[0]).toMatchObject({
			method: 'POST',
			url: '/v1beta/models/gemini-test:streamGenerateContent?alt=sse'
		});
		expect(seen[0].url).not.toContain(KEY);
		expect(seen[0].headers['x-goog-api-key']).toBe(KEY);
		expect(seen[0].headers.authorization).toBeUndefined();
		expect(seen[0].body).toMatchObject({
			generationConfig: { maxOutputTokens: 1000 },
			toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
		});
		expect(seen[0].body).toHaveProperty('systemInstruction.parts');
		expect(JSON.stringify(seen[0].body)).not.toContain(KEY);
	});

	it('ツール呼び出しを挟む 2 往復の会話(functionCall → functionResponse、署名つき parts の保持)', async () => {
		const modelParts = [
			{ text: '調べます', thoughtSignature: 'sig-1' },
			{ functionCall: { name: 'search', args: { query: '月' } }, thoughtSignature: 'sig-2' }
		];
		handlers.push((_req, res) => {
			sseHead(res);
			res.write(geminiChunk(modelParts.slice(0, 1)));
			res.end(geminiChunk(modelParts.slice(1), 'STOP'));
		});
		handlers.push((_req, res, s) => {
			sseHead(res);
			const last = s.body?.contents.at(-1)?.parts[0] as {
				functionResponse: { response: { result: string } };
			};
			res.end(geminiChunk([{ text: `結果=${last.functionResponse.response.result}` }], 'STOP'));
		});
		const { turn, emit } = collector();
		const exit = await provider().run(request(), emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(seen).toHaveLength(2);
		expect(seen[1].body?.contents.at(-2)).toEqual({ role: 'model', parts: modelParts });
		expect(seen[1].body?.contents.at(-1)).toEqual({
			role: 'user',
			parts: [
				{
					functionResponse: { name: 'search', response: { result: 'search:{"query":"月"}' } }
				}
			]
		});
		expect(turnParts(turn).at(-1)).toEqual({ kind: 'text', text: '結果=search:{"query":"月"}' });
	});

	it('400 API_KEY_INVALID は認証のエラーとして返し、キーを含めない', async () => {
		handlers.push((_req, res) => {
			res.writeHead(400, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					error: {
						code: 400,
						status: 'INVALID_ARGUMENT',
						message: `API key not valid: ${KEY}`,
						details: [{ reason: 'API_KEY_INVALID' }]
					}
				})
			);
		});
		const exit = await provider().run(request(), collector().emit, new AbortController().signal);
		expect(exit).toMatchObject({ code: 1, authError: true });
		expect(exit.stderr).toContain('認証に失敗');
		expect(exit.stderr).not.toContain(KEY);
	});

	it('429 RESOURCE_EXHAUSTED を、利用上限として返す', async () => {
		handlers.push((_req, res) => {
			res.writeHead(429, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' }
				})
			);
		});
		const exit = await provider().run(request(), collector().emit, new AbortController().signal);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('利用上限');
	});

	it('ストリームの途中で中断すると、サーバーへの接続が閉じられ、cancelled で返る', async () => {
		let closed = false;
		handlers.push((req, res) => {
			sseHead(res);
			res.write(geminiChunk([{ text: 'ゆっくり' }]));
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

	it('モデル一覧と接続テスト(GET /v1beta/models?pageSize=100)', async () => {
		handlers.push((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					models: [
						{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/embed', supportedGenerationMethods: ['embedContent'] }
					]
				})
			);
		});
		const r = await provider().testConnection!(request().settings);
		expect(r).toMatchObject({ ok: true, models: ['gemini-test'] });
		expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1beta/models?pageSize=100' });
		expect(seen[0].headers['x-goog-api-key']).toBe(KEY);
		expect(seen[0].url).not.toContain(KEY);
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
