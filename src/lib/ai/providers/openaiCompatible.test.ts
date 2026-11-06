// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { applyStreamLine, createTurnState, turnParts } from '$lib/desktop/stream';
import { MAX_STEPS } from '../http/agent';
import {
	chunk,
	mockFetch,
	sse,
	sseResponse,
	streamOf,
	type RecordedRequest
} from '../test-helpers';
import { DEFAULT_AI_SETTINGS } from '../settings';
import type { AiRunRequest, AiSettings } from '../types';
import { createOpenAiCompatibleProvider, type OpenAiProviderDeps } from './openaiCompatible';

const KEY = 'sk-test-0123456789abcdefghijkl';
const TOOLS = [
	{ name: 'search', description: '検索', inputSchema: { type: 'object', properties: {} } },
	{ name: 'get_scene', description: '本文', inputSchema: { type: 'object', properties: {} } }
];

function settings(over: Partial<AiSettings['openaiCompatible']> = {}): AiSettings {
	return {
		...structuredClone(DEFAULT_AI_SETTINGS),
		provider: 'openai-compatible',
		openaiCompatible: {
			baseUrl: 'https://api.example.com/v1',
			model: 'test-model',
			presetId: 'openai',
			...over
		}
	};
}

function request(over: Partial<AiRunRequest> = {}): AiRunRequest {
	return {
		runId: 'run1',
		prompt: '質問です',
		editMode: 'suggest',
		settings: settings(),
		...over
	};
}

function setup(responses: Parameters<typeof mockFetch>[0], deps: Partial<OpenAiProviderDeps> = {}) {
	const { fetch, requests } = mockFetch(responses);
	const callTool = vi.fn(async (name: string) => ({ text: `${name} の結果`, isError: false }));
	const provider = createOpenAiCompatibleProvider({
		getFetch: async () => fetch,
		getKey: async () => KEY,
		loadTools: async () => TOOLS,
		callTool,
		...deps
	});
	const lines: string[] = [];
	const turn = createTurnState();
	const emit = (line: string) => {
		lines.push(line);
		applyStreamLine(turn, line);
	};
	return { provider, requests, callTool, lines, turn, emit };
}

const toolCallChunk = (
	index: number,
	fn: { name?: string; arguments?: string },
	id?: string
): string =>
	chunk({ tool_calls: [{ index, ...(id ? { id, type: 'function' } : {}), function: fn }] });

const messagesOf = (req: RecordedRequest) => req.body?.messages as Record<string, unknown>[];

describe('OpenAI 互換: テキストだけの応答', () => {
	it('テキストの差分を逐次流し、結果を返す', async () => {
		const t = setup([
			sseResponse([
				chunk({ content: 'こん' }),
				chunk({ content: 'にちは' }),
				chunk({}, 'stop'),
				sse('[DONE]')
			])
		]);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);

		expect(exit).toMatchObject({ code: 0, cancelled: false, requestId: 'run1' });
		expect(t.turn.done).toBe(true);
		expect(t.turn.isError).toBe(false);
		expect(t.turn.sessionId).toBe('openai-run1');
		expect(t.turn.model).toBe('test-model');
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: 'こんにちは' }]);
		// 逐次表示のイベントが流れている
		const deltas = t.lines.filter((l) => l.includes('text_delta'));
		expect(deltas).toHaveLength(2);
	});

	it('リクエストの形(URL・ヘッダー・ツール定義・メッセージ)', async () => {
		const t = setup([sseResponse([chunk({ content: 'ok' }, 'stop'), sse('[DONE]')])]);
		await t.provider.run(
			request({ editMode: 'confirm', appendSystemPrompt: '追加の指示' }),
			t.emit,
			new AbortController().signal
		);
		const [req] = t.requests;
		expect(req.url).toBe('https://api.example.com/v1/chat/completions');
		expect(req.init.method).toBe('POST');
		const headers = req.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Bearer ${KEY}`);
		expect(headers['Content-Type']).toBe('application/json');
		expect(req.body).toMatchObject({ model: 'test-model', stream: true, tool_choice: 'auto' });
		expect(req.body?.tools).toEqual([
			{
				type: 'function',
				function: { name: 'search', description: '検索', parameters: TOOLS[0].inputSchema }
			},
			{
				type: 'function',
				function: { name: 'get_scene', description: '本文', parameters: TOOLS[1].inputSchema }
			}
		]);
		const [system, user] = messagesOf(req);
		expect(system.role).toBe('system');
		expect(String(system.content)).toContain('小説の執筆を支える');
		expect(String(system.content)).toContain('追加の指示');
		expect(user).toEqual({ role: 'user', content: '質問です' });
	});

	it('キーが不要なサービス(LM Studio)では Authorization を付けない', async () => {
		const t = setup([sseResponse([chunk({ content: 'ok' }, 'stop')])], {
			getKey: async () => null
		});
		const exit = await t.provider.run(
			request({
				settings: settings({ presetId: 'lmstudio', baseUrl: 'http://localhost:1234/v1' })
			}),
			t.emit,
			new AbortController().signal
		);
		expect(exit.code).toBe(0);
		expect((t.requests[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
		expect(t.requests[0].url).toBe('http://localhost:1234/v1/chat/completions');
	});

	it('[DONE] が無くても、ストリームの終わりで完了する', async () => {
		const t = setup([sseResponse([chunk({ content: 'a' }), chunk({ content: 'b' }, 'stop')])]);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: 'ab' }]);
	});

	it('stream を無視して JSON で返すサーバーにも対応する', async () => {
		const body = JSON.stringify({
			choices: [{ message: { role: 'assistant', content: 'まとめて返答' } }]
		});
		const t = setup([new Response(body, { headers: { 'content-type': 'application/json' } })]);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: 'まとめて返答' }]);
	});
});

describe('OpenAI 互換: ツール呼び出し', () => {
	it('1 回のツール呼び出し: 引数の断片を結合して実行し、結果を渡して次のステップへ進む', async () => {
		const t = setup([
			sseResponse([
				chunk({ content: '調べます。' }),
				toolCallChunk(0, { name: 'search', arguments: '' }, 'call_a'),
				toolCallChunk(0, { arguments: '{"que' }),
				toolCallChunk(0, { arguments: 'ry":"主人' }),
				toolCallChunk(0, { arguments: '公"}' }),
				chunk({}, 'tool_calls'),
				sse('[DONE]')
			]),
			sseResponse([chunk({ content: '見つかりました。' }, 'stop'), sse('[DONE]')])
		]);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);

		expect(exit.code).toBe(0);
		expect(t.callTool).toHaveBeenCalledTimes(1);
		expect(t.callTool).toHaveBeenCalledWith('search', { query: '主人公' }, 'run1');

		// 2 回目のリクエストに、assistant の tool_calls と tool の結果が入る
		const second = messagesOf(t.requests[1]);
		expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
		expect(second[2]).toMatchObject({
			role: 'assistant',
			content: '調べます。',
			tool_calls: [
				{
					id: 'call_a',
					type: 'function',
					function: { name: 'search', arguments: '{"query":"主人公"}' }
				}
			]
		});
		expect(second[3]).toEqual({ role: 'tool', tool_call_id: 'call_a', content: 'search の結果' });

		// 画面側には、ツール名が mcp 形式で渡り、本文が並ぶ
		expect(turnParts(t.turn)).toEqual([
			{ kind: 'text', text: '調べます。' },
			{ kind: 'tool', name: 'search', summary: '"主人公"' },
			{ kind: 'text', text: '見つかりました。' }
		]);
		expect(t.lines.some((l) => l.includes('mcp__storift__search'))).toBe(true);
	});

	it('複数のツール呼び出し: index ごとに断片を結合し、出てきた順に実行して結果を並べる', async () => {
		const order: string[] = [];
		const t = setup(
			[
				sseResponse([
					toolCallChunk(0, { name: 'search', arguments: '' }, 'c0'),
					toolCallChunk(1, { name: 'get_scene', arguments: '' }, 'c1'),
					// 断片が index をまたいで交互に届く
					toolCallChunk(1, { arguments: '{"sceneId":' }),
					toolCallChunk(0, { arguments: '{"query":"a"}' }),
					toolCallChunk(1, { arguments: '"s1"}' }),
					chunk({}, 'tool_calls')
				]),
				sseResponse([chunk({ content: '完了' }, 'stop')])
			],
			{
				callTool: async (name, args) => {
					order.push(`${name}:${JSON.stringify(args)}`);
					return { text: `${name} 完了`, isError: false };
				}
			}
		);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(order).toEqual(['search:{"query":"a"}', 'get_scene:{"sceneId":"s1"}']);
		const second = messagesOf(t.requests[1]);
		expect(second.slice(3)).toEqual([
			{ role: 'tool', tool_call_id: 'c0', content: 'search 完了' },
			{ role: 'tool', tool_call_id: 'c1', content: 'get_scene 完了' }
		]);
		const names = turnParts(t.turn)
			.filter((p) => p.kind === 'tool')
			.map((p) => (p as { name: string }).name);
		expect(names).toEqual(['search', 'get_scene']);
	});

	it('ツールが失敗したら「エラー: …」としてモデルに返し、続行する', async () => {
		const t = setup(
			[
				sseResponse([
					toolCallChunk(0, { name: 'get_scene', arguments: '{}' }, 'c0'),
					chunk({}, 'tool_calls')
				]),
				sseResponse([chunk({ content: 'わかりました' }, 'stop')])
			],
			{ callTool: async () => ({ text: 'sceneId を指定してください', isError: true }) }
		);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(messagesOf(t.requests[1])[3]).toMatchObject({
			role: 'tool',
			content: 'エラー: sceneId を指定してください'
		});
	});

	it('callTool が例外を投げても、エラーとして返して続行する', async () => {
		const t = setup(
			[
				sseResponse([
					toolCallChunk(0, { name: 'search', arguments: '{}' }, 'c0'),
					chunk({}, 'tool_calls')
				]),
				sseResponse([chunk({ content: 'ok' }, 'stop')])
			],
			{
				callTool: async () => {
					throw new Error('db down');
				}
			}
		);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(0);
		expect(String(messagesOf(t.requests[1])[3].content)).toContain('db down');
	});

	it('引数が JSON として読めなければ実行せず、理由を返す', async () => {
		const t = setup([
			sseResponse([
				toolCallChunk(0, { name: 'search', arguments: '{"query": ' }, 'c0'),
				chunk({}, 'tool_calls')
			]),
			sseResponse([chunk({ content: 'ok' }, 'stop')])
		]);
		await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(t.callTool).not.toHaveBeenCalled();
		expect(String(messagesOf(t.requests[1])[3].content)).toContain('JSON');
	});

	it('id を返さないサーバーでも、tool メッセージと対応づける', async () => {
		const t = setup([
			sseResponse([
				toolCallChunk(0, { name: 'search', arguments: '{"query":"x"}' }),
				chunk({}, 'tool_calls')
			]),
			sseResponse([chunk({ content: 'ok' }, 'stop')])
		]);
		await t.provider.run(request(), t.emit, new AbortController().signal);
		const second = messagesOf(t.requests[1]);
		const callId = (second[2].tool_calls as { id: string }[])[0].id;
		expect(callId).toBeTruthy();
		expect(second[3].tool_call_id).toBe(callId);
	});

	it('最大ステップ(12)に達したら打ち切ってエラーにする', async () => {
		const responses = Array.from({ length: 20 }, (_, i) =>
			sseResponse([
				toolCallChunk(0, { name: 'search', arguments: '{}' }, `c${i}`),
				chunk({}, 'tool_calls')
			])
		);
		const t = setup(responses);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(MAX_STEPS).toBe(12);
		expect(t.requests).toHaveLength(12);
		expect(t.callTool).toHaveBeenCalledTimes(12);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('12 回');
		expect(t.turn.done).toBe(false);
	});
});

describe('OpenAI 互換: 会話の継続', () => {
	it('同じセッション ID なら履歴を引き継ぎ、別の ID なら新しく始める', async () => {
		const t = setup([
			sseResponse([chunk({ content: '一回目' }, 'stop')]),
			sseResponse([chunk({ content: '二回目' }, 'stop')]),
			sseResponse([chunk({ content: '三回目' }, 'stop')])
		]);
		await t.provider.run(request(), t.emit, new AbortController().signal);
		await t.provider.run(
			request({ runId: 'run2', prompt: '続き', sessionId: 'openai-run1' }),
			t.emit,
			new AbortController().signal
		);
		expect(messagesOf(t.requests[1]).map((m) => m.role)).toEqual([
			'system',
			'user',
			'assistant',
			'user'
		]);
		await t.provider.run(
			request({ runId: 'run3', sessionId: 'openai-unknown' }),
			t.emit,
			new AbortController().signal
		);
		expect(messagesOf(t.requests[2]).map((m) => m.role)).toEqual(['system', 'user']);
	});

	it('失敗した実行は履歴に残さない', async () => {
		const t = setup([
			sseResponse([chunk({ content: '一回目' }, 'stop')]),
			new Response('{"error":{"message":"boom"}}', { status: 500 }),
			sseResponse([chunk({ content: '三回目' }, 'stop')])
		]);
		await t.provider.run(request(), t.emit, new AbortController().signal);
		const failed = await t.provider.run(
			request({ runId: 'run2', sessionId: 'openai-run1' }),
			t.emit,
			new AbortController().signal
		);
		expect(failed.code).toBe(1);
		await t.provider.run(
			request({ runId: 'run3', sessionId: 'openai-run1' }),
			t.emit,
			new AbortController().signal
		);
		expect(messagesOf(t.requests[2]).map((m) => m.role)).toEqual([
			'system',
			'user',
			'assistant',
			'user'
		]);
	});
});

describe('OpenAI 互換: エラーの分類', () => {
	it.each([
		[401, '認証に失敗'],
		[403, '認証に失敗'],
		[404, 'Base URL とモデル名'],
		[429, 'レート制限'],
		[500, 'エラーが起きました'],
		[503, 'エラーが起きました']
	])('HTTP %i を日本語のメッセージにする(API キーを含めない)', async (status, word) => {
		const body = JSON.stringify({ error: { message: `bad key ${KEY}` } });
		const t = setup([new Response(body, { status })]);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(1);
		expect(exit.cancelled).toBe(false);
		expect(exit.stderr).toContain(word);
		expect(exit.stderr).not.toContain(KEY);
		expect(Boolean(exit.authError)).toBe(status === 401 || status === 403);
	});

	it('通信できないときのエラーにも API キーを含めない', async () => {
		const t = setup([
			() => {
				throw new Error(`fetch failed for key ${KEY}`);
			}
		]);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('接続できませんでした');
		expect(exit.stderr).not.toContain(KEY);
	});

	it('ストリームの途中で error が届いたらエラーにする', async () => {
		const t = setup([
			sseResponse([chunk({ content: '途中' }), sse({ error: { message: 'overloaded' } })])
		]);
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('overloaded');
		// それまでに届いた本文は画面に残る
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: '途中' }]);
		expect(t.turn.done).toBe(false);
	});

	it('API キー未設定・モデル未選択・不正な URL は、通信せずに説明する', async () => {
		const noKey = setup([], { getKey: async () => null });
		const a = await noKey.provider.run(request(), noKey.emit, new AbortController().signal);
		expect(a.code).toBe(1);
		expect(a.stderr).toContain('API キー');
		expect(a.authError).toBe(true);

		const noModel = setup([]);
		const b = await noModel.provider.run(
			request({ settings: settings({ model: ' ' }) }),
			noModel.emit,
			new AbortController().signal
		);
		expect(b.stderr).toContain('モデル');

		const badUrl = setup([]);
		const c = await badUrl.provider.run(
			request({ settings: settings({ baseUrl: 'http://example.com/v1' }) }),
			badUrl.emit,
			new AbortController().signal
		);
		expect(c.code).toBe(1);
		expect(c.stderr).toContain('localhost');
		expect(noKey.requests.length + noModel.requests.length + badUrl.requests.length).toBe(0);
	});

	it('キーはメッセージだけでなく、画面へ流す行にも含まれない', async () => {
		const t = setup([sseResponse([chunk({ content: 'ok' }, 'stop')])]);
		await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(t.lines.join('\n')).not.toContain(KEY);
	});
});

describe('OpenAI 互換: 中断とタイムアウト', () => {
	/** 中断されるまで応答しない fetch */
	const hang = (_req: RecordedRequest) => new Promise<Response>(() => {});

	function hangUntilAbort(): (req: RecordedRequest) => Promise<Response> {
		return (req) =>
			new Promise<Response>((_, reject) => {
				const signal = req.init.signal as AbortSignal;
				signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			});
	}

	it('実行前に中断済みなら、通信せずに中断として返す', async () => {
		const t = setup([hang]);
		const controller = new AbortController();
		controller.abort();
		const exit = await t.provider.run(request(), t.emit, controller.signal);
		expect(exit).toMatchObject({ code: null, cancelled: true });
		expect(t.requests).toHaveLength(0);
	});

	it('応答待ちの間に中断すると、cancelled で返る', async () => {
		const t = setup([hangUntilAbort()]);
		const controller = new AbortController();
		const done = t.provider.run(request(), t.emit, controller.signal);
		await vi.waitFor(() => expect(t.requests).toHaveLength(1));
		controller.abort();
		expect(await done).toMatchObject({ code: null, cancelled: true });
	});

	it('ストリームの途中で中断しても、cancelled で返り、それまでの本文は残る', async () => {
		const encoder = new TextEncoder();
		let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				controllerRef = c;
				c.enqueue(encoder.encode(chunk({ content: '途中まで' })));
			}
		});
		const t = setup([
			(req) => {
				(req.init.signal as AbortSignal).addEventListener('abort', () =>
					controllerRef.error(new DOMException('aborted', 'AbortError'))
				);
				return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
			}
		]);
		const controller = new AbortController();
		const done = t.provider.run(request(), t.emit, controller.signal);
		await vi.waitFor(() => expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: '途中まで' }]));
		controller.abort();
		expect(await done).toMatchObject({ code: null, cancelled: true });
	});

	it('ツールの実行の合間に中断すると、次のステップへ進まない', async () => {
		const controller = new AbortController();
		const t = setup(
			[
				sseResponse([
					toolCallChunk(0, { name: 'search', arguments: '{}' }, 'c0'),
					chunk({}, 'tool_calls')
				]),
				sseResponse([chunk({ content: '来ない' }, 'stop')])
			],
			{
				callTool: async () => {
					controller.abort();
					return { text: 'x', isError: false };
				}
			}
		);
		const exit = await t.provider.run(request(), t.emit, controller.signal);
		expect(exit).toMatchObject({ code: null, cancelled: true });
		expect(t.requests).toHaveLength(1);
	});

	it('1 リクエストが制限時間を超えたら、タイムアウトのエラーにする', async () => {
		const t = setup([hangUntilAbort()], { requestTimeoutMs: 30 });
		const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
		expect(exit.code).toBe(1);
		expect(exit.cancelled).toBe(false);
		expect(exit.stderr).toContain('タイムアウト');
	});
});

describe('OpenAI 互換: 状態・モデル一覧・接続テスト', () => {
	const modelsResponse = () =>
		new Response(
			JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }] }),
			{
				headers: { 'content-type': 'application/json' }
			}
		);

	it('status: キー・モデル・URL がそろっていれば使える', async () => {
		const t = setup([]);
		const ok = await t.provider.status(settings());
		expect(ok.found).toBe(true);
		expect(ok.version).toContain('OpenAI');
		expect(ok.version).toContain('api.example.com');
	});

	it('status: キー未設定・モデル未選択・不正な URL は理由を返す', async () => {
		const noKey = setup([], { getKey: async () => null });
		expect(await noKey.provider.status(settings())).toMatchObject({ found: false });
		expect((await noKey.provider.status(settings())).error).toContain('API キー');
		const t = setup([]);
		expect((await t.provider.status(settings({ model: '' }))).error).toContain('モデル');
		expect((await t.provider.status(settings({ baseUrl: 'ftp://x' }))).found).toBe(false);
		// ローカルのサーバーはキーが無くても使える
		expect(
			(
				await noKey.provider.status(
					settings({ presetId: 'lmstudio', baseUrl: 'http://localhost:1234/v1' })
				)
			).found
		).toBe(true);
	});

	it('listModels: /models の一覧を重複なく並べて返す', async () => {
		const t = setup([modelsResponse()]);
		const models = await t.provider.listModels!(settings());
		expect(models).toEqual(['a-model', 'b-model']);
		expect(t.requests[0].url).toBe('https://api.example.com/v1/models');
		expect(t.requests[0].init.method).toBe('GET');
		expect((t.requests[0].init.headers as Record<string, string>).Authorization).toBe(
			`Bearer ${KEY}`
		);
	});

	it('testConnection: 成功すると件数を、選択中のモデルが無ければ注意を返す', async () => {
		const t = setup([modelsResponse(), modelsResponse()]);
		const ok = await t.provider.testConnection!(settings({ model: 'a-model' }));
		expect(ok.ok).toBe(true);
		expect(ok.message).toContain('2 件');
		expect(ok.message).not.toContain('一覧にありません');
		const missing = await t.provider.testConnection!(settings({ model: 'zzz' }));
		expect(missing.ok).toBe(true);
		expect(missing.message).toContain('一覧にありません');
	});

	it('testConnection: 失敗の理由を日本語で返し、キーを含めない', async () => {
		const t = setup([new Response(`{"error":{"message":"${KEY} is invalid"}}`, { status: 401 })]);
		const r = await t.provider.testConnection!(settings());
		expect(r.ok).toBe(false);
		expect(r.message).toContain('認証に失敗');
		expect(r.message).not.toContain(KEY);
	});

	it('testConnection: 通信できない・応答が想定外・URL 不正を区別する', async () => {
		const down = setup([
			() => {
				throw new Error('connection refused');
			}
		]);
		expect((await down.provider.testConnection!(settings())).message).toContain(
			'接続できませんでした'
		);
		const weird = setup([new Response('not json', { headers: { 'content-type': 'text/html' } })]);
		expect((await weird.provider.testConnection!(settings())).ok).toBe(false);
		const bad = setup([]);
		const r = await bad.provider.testConnection!(settings({ baseUrl: 'http://example.com' }));
		expect(r.ok).toBe(false);
		expect(bad.requests).toHaveLength(0);
	});
});

describe('OpenAI 互換: ストリームの読み取り', () => {
	it('同じストリームを細かい断片で受け取っても結果が変わらない', async () => {
		const wire =
			chunk({ content: 'あ' }) +
			toolCallChunk(0, { name: 'search', arguments: '' }, 'c0') +
			toolCallChunk(0, { arguments: '{"query":"い"}' }) +
			chunk({}, 'tool_calls') +
			sse('[DONE]');
		const second = chunk({ content: '終わり' }, 'stop');
		for (const size of [1, 3, 7, 1000]) {
			const pieces = wire.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];
			const t = setup([
				new Response(streamOf(pieces), { headers: { 'content-type': 'text/event-stream' } }),
				sseResponse([second])
			]);
			const exit = await t.provider.run(request(), t.emit, new AbortController().signal);
			expect(exit.code, `size ${size}`).toBe(0);
			expect(t.callTool).toHaveBeenCalledWith('search', { query: 'い' }, 'run1');
			expect(turnParts(t.turn).at(-1)).toEqual({ kind: 'text', text: '終わり' });
		}
	});
});
