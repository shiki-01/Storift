// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { applyStreamLine, createTurnState, turnParts } from '$lib/desktop/stream';
import { MAX_STEPS } from '../http/agent';
import {
	anthropicEvent,
	anthropicMessage,
	anthropicText,
	anthropicToolUse,
	mockFetch,
	sseResponse,
	streamOf,
	type RecordedRequest
} from '../test-helpers';
import { DEFAULT_AI_SETTINGS } from '../settings';
import { STORIFT_TOOLS } from '../tool-fixtures';
import type { AiRunRequest, AiSettings } from '../types';
import { ANTHROPIC_MODEL_EXAMPLES, createAnthropicProvider } from './anthropic';
import { toAnthropicTools } from './anthropicChat';
import type { AnthropicProviderDeps } from './anthropic';

const KEY = 'sk-ant-test-0123456789abcdefghijkl';
const TOOLS = [
	{
		name: 'search',
		description: '検索',
		inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
	},
	{ name: 'get_scene', description: '本文', inputSchema: { type: 'object', properties: {} } }
];

function settings(over: Partial<AiSettings['anthropic']> = {}): AiSettings {
	return {
		...structuredClone(DEFAULT_AI_SETTINGS),
		provider: 'anthropic',
		anthropic: {
			baseUrl: 'https://api.example.com',
			model: 'claude-test',
			maxTokens: 4096,
			...over
		}
	};
}

function request(over: Partial<AiRunRequest> = {}): AiRunRequest {
	return { runId: 'run1', prompt: '質問です', editMode: 'suggest', settings: settings(), ...over };
}

function setup(
	responses: Parameters<typeof mockFetch>[0],
	deps: Partial<AnthropicProviderDeps> = {}
) {
	const { fetch, requests } = mockFetch(responses);
	const callTool = vi.fn(async (name: string) => ({ text: `${name} の結果`, isError: false }));
	const provider = createAnthropicProvider({
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

const run = (t: ReturnType<typeof setup>, req = request()) =>
	t.provider.run(req, t.emit, new AbortController().signal);

type Msg = { role: string; content: string | Record<string, unknown>[] };
const messagesOf = (req: RecordedRequest) => req.body?.messages as Msg[];

describe('Anthropic: テキストだけの応答', () => {
	it('テキストの差分を逐次流し、結果を返す', async () => {
		const t = setup([sseResponse(anthropicMessage(anthropicText(0, 'こん', 'にちは')))]);
		const exit = await run(t);
		expect(exit).toMatchObject({ code: 0, cancelled: false, requestId: 'run1' });
		expect(t.turn.done).toBe(true);
		expect(t.turn.sessionId).toBe('anthropic-run1');
		expect(t.turn.model).toBe('claude-test');
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: 'こんにちは' }]);
		expect(t.lines.filter((l) => l.includes('text_delta'))).toHaveLength(2);
	});

	it('リクエストの形(URL・ヘッダー・system・max_tokens・tools・messages)', async () => {
		const t = setup([sseResponse(anthropicMessage(anthropicText(0, 'ok')))]);
		await run(t, request({ appendSystemPrompt: '追加の指示' }));
		const [req] = t.requests;
		expect(req.url).toBe('https://api.example.com/v1/messages');
		expect(req.init.method).toBe('POST');
		const headers = req.init.headers as Record<string, string>;
		expect(headers['x-api-key']).toBe(KEY);
		expect(headers['anthropic-version']).toBe('2023-06-01');
		expect(headers['content-type']).toBe('application/json');
		expect(headers.Authorization).toBeUndefined();
		// キーは URL にも本文にも含まれない
		expect(req.url).not.toContain(KEY);
		expect(JSON.stringify(req.body)).not.toContain(KEY);
		expect(req.body).toMatchObject({ model: 'claude-test', max_tokens: 4096, stream: true });
		expect(String(req.body?.system)).toContain('小説の執筆を支える');
		expect(String(req.body?.system)).toContain('追加の指示');
		expect(req.body?.tools).toEqual([
			{ name: 'search', description: '検索', input_schema: TOOLS[0].inputSchema },
			{ name: 'get_scene', description: '本文', input_schema: TOOLS[1].inputSchema }
		]);
		// system はメッセージに入れない
		expect(messagesOf(req)).toEqual([{ role: 'user', content: '質問です' }]);
	});

	it('max_tokens は設定の値を送る', async () => {
		const t = setup([sseResponse(anthropicMessage(anthropicText(0, 'ok')))]);
		await run(t, request({ settings: settings({ maxTokens: 123 }) }));
		expect(t.requests[0].body?.max_tokens).toBe(123);
	});

	it('ping とコメント行を読み飛ばし、細かい断片で届いても結果が変わらない', async () => {
		const wire = [': keep-alive\n\n', ...anthropicMessage(anthropicText(0, 'あ', 'い'))].join('');
		for (const size of [1, 4, 9, 1000]) {
			const pieces = wire.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];
			const t = setup([
				new Response(streamOf(pieces), { headers: { 'content-type': 'text/event-stream' } })
			]);
			expect((await run(t)).code, `size ${size}`).toBe(0);
			expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: 'あい' }]);
		}
	});
});

describe('Anthropic: ツール呼び出し', () => {
	it('1 回のツール呼び出し: 断片を結合して実行し、tool_result を user メッセージで返す', async () => {
		const t = setup([
			sseResponse(
				anthropicMessage(
					[
						...anthropicText(0, '調べます。'),
						...anthropicToolUse(1, 'toolu_a', 'search', '', '{"que', 'ry":"主人', '公"}')
					],
					'tool_use'
				)
			),
			sseResponse(anthropicMessage(anthropicText(0, '見つかりました。')))
		]);
		const exit = await run(t);
		expect(exit.code).toBe(0);
		expect(t.callTool).toHaveBeenCalledTimes(1);
		expect(t.callTool).toHaveBeenCalledWith('search', { query: '主人公' }, 'run1');

		const second = messagesOf(t.requests[1]);
		expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
		// assistant の content ブロック(text と tool_use)がそのまま残る
		expect(second[1].content).toEqual([
			{ type: 'text', text: '調べます。' },
			{ type: 'tool_use', id: 'toolu_a', name: 'search', input: { query: '主人公' } }
		]);
		// ツールの結果は user メッセージの tool_result ブロック
		expect(second[2].content).toEqual([
			{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'search の結果' }
		]);
		expect(turnParts(t.turn)).toEqual([
			{ kind: 'text', text: '調べます。' },
			{ kind: 'tool', name: 'search', summary: '"主人公"' },
			{ kind: 'text', text: '見つかりました。' }
		]);
		expect(t.lines.some((l) => l.includes('mcp__storift__search'))).toBe(true);
	});

	it('複数のツール: 出てきた順に実行し、結果を 1 つの user メッセージにまとめる', async () => {
		const order: string[] = [];
		const t = setup(
			[
				sseResponse(
					anthropicMessage(
						[
							...anthropicToolUse(0, 'toolu_0', 'search', '{"query":"a"}'),
							// 2 つ目の引数の断片が、1 つ目と交互に届く
							...anthropicToolUse(1, 'toolu_1', 'get_scene', '{"sceneId":', '"s1"}')
						],
						'tool_use'
					)
				),
				sseResponse(anthropicMessage(anthropicText(0, '完了')))
			],
			{
				callTool: async (name, args) => {
					order.push(`${name}:${JSON.stringify(args)}`);
					return { text: `${name} 完了`, isError: false };
				}
			}
		);
		expect((await run(t)).code).toBe(0);
		expect(order).toEqual(['search:{"query":"a"}', 'get_scene:{"sceneId":"s1"}']);
		const second = messagesOf(t.requests[1]);
		expect(second).toHaveLength(3);
		expect(second[2]).toEqual({
			role: 'user',
			content: [
				{ type: 'tool_result', tool_use_id: 'toolu_0', content: 'search 完了' },
				{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'get_scene 完了' }
			]
		});
	});

	it('index が交互に届く断片を、ブロックごとに結合する', async () => {
		const delta = (index: number, partial_json: string) =>
			anthropicEvent('content_block_delta', {
				index,
				delta: { type: 'input_json_delta', partial_json }
			});
		const start = (index: number, id: string, name: string) =>
			anthropicEvent('content_block_start', {
				index,
				content_block: { type: 'tool_use', id, name, input: {} }
			});
		const t = setup([
			sseResponse(
				anthropicMessage(
					[
						start(0, 'a', 'search'),
						start(1, 'b', 'get_scene'),
						delta(1, '{"sceneId":'),
						delta(0, '{"query":"q"}'),
						delta(1, '"s"}')
					],
					'tool_use'
				)
			),
			sseResponse(anthropicMessage(anthropicText(0, 'ok')))
		]);
		await run(t);
		expect(t.callTool).toHaveBeenNthCalledWith(1, 'search', { query: 'q' }, 'run1');
		expect(t.callTool).toHaveBeenNthCalledWith(2, 'get_scene', { sceneId: 's' }, 'run1');
	});

	it('引数が空のツール(partial_json が空文字)は {} で実行する', async () => {
		const t = setup([
			sseResponse(anthropicMessage(anthropicToolUse(0, 'toolu_a', 'get_scene', ''), 'tool_use')),
			sseResponse(anthropicMessage(anthropicText(0, 'ok')))
		]);
		await run(t);
		expect(t.callTool).toHaveBeenCalledWith('get_scene', {}, 'run1');
		expect(messagesOf(t.requests[1])[1].content).toEqual([
			{ type: 'tool_use', id: 'toolu_a', name: 'get_scene', input: {} }
		]);
	});

	it('ツールが失敗したら is_error: true の tool_result で返し、続行する', async () => {
		const t = setup(
			[
				sseResponse(
					anthropicMessage(anthropicToolUse(0, 'toolu_a', 'get_scene', '{}'), 'tool_use')
				),
				sseResponse(anthropicMessage(anthropicText(0, 'わかりました')))
			],
			{ callTool: async () => ({ text: 'sceneId を指定してください', isError: true }) }
		);
		expect((await run(t)).code).toBe(0);
		expect(messagesOf(t.requests[1])[2].content).toEqual([
			{
				type: 'tool_result',
				tool_use_id: 'toolu_a',
				content: 'エラー: sceneId を指定してください',
				is_error: true
			}
		]);
	});

	it('引数が JSON として読めなければ実行せず、理由を is_error で返す', async () => {
		const t = setup([
			sseResponse(
				anthropicMessage(anthropicToolUse(0, 'toolu_a', 'search', '{"query": '), 'tool_use')
			),
			sseResponse(anthropicMessage(anthropicText(0, 'ok')))
		]);
		await run(t);
		expect(t.callTool).not.toHaveBeenCalled();
		const result = (messagesOf(t.requests[1])[2].content as Record<string, unknown>[])[0];
		expect(result).toMatchObject({ type: 'tool_result', is_error: true });
		expect(String(result.content)).toContain('JSON');
		// 履歴の tool_use の input は有効なオブジェクト
		expect(messagesOf(t.requests[1])[1].content).toEqual([
			{ type: 'tool_use', id: 'toolu_a', name: 'search', input: {} }
		]);
	});

	it('最大ステップ(12)に達したら打ち切ってエラーにする', async () => {
		const responses = Array.from({ length: 20 }, (_, i) =>
			sseResponse(anthropicMessage(anthropicToolUse(0, `toolu_${i}`, 'search', '{}'), 'tool_use'))
		);
		const t = setup(responses);
		const exit = await run(t);
		expect(MAX_STEPS).toBe(12);
		expect(t.requests).toHaveLength(12);
		expect(t.callTool).toHaveBeenCalledTimes(12);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('12 回');
	});
});

describe('Anthropic: 会話の継続', () => {
	it('同じセッション ID なら履歴(content ブロック)を引き継ぎ、別の ID なら新しく始める', async () => {
		const t = setup([
			sseResponse(anthropicMessage(anthropicText(0, '一回目'))),
			sseResponse(anthropicMessage(anthropicText(0, '二回目'))),
			sseResponse(anthropicMessage(anthropicText(0, '三回目')))
		]);
		await run(t);
		await run(t, request({ runId: 'run2', prompt: '続き', sessionId: 'anthropic-run1' }));
		const second = messagesOf(t.requests[1]);
		expect(second).toEqual([
			{ role: 'user', content: '質問です' },
			{ role: 'assistant', content: [{ type: 'text', text: '一回目' }] },
			{ role: 'user', content: '続き' }
		]);
		// 続きでも system は毎回送る
		expect(String(t.requests[1].body?.system)).toContain('小説の執筆を支える');
		await run(t, request({ runId: 'run3', sessionId: 'anthropic-unknown' }));
		expect(messagesOf(t.requests[2]).map((m) => m.role)).toEqual(['user']);
	});

	it('失敗した実行は履歴に残さない', async () => {
		const t = setup([
			sseResponse(anthropicMessage(anthropicText(0, '一回目'))),
			new Response('{"type":"error","error":{"type":"api_error","message":"boom"}}', {
				status: 500
			}),
			sseResponse(anthropicMessage(anthropicText(0, '三回目')))
		]);
		await run(t);
		expect((await run(t, request({ runId: 'run2', sessionId: 'anthropic-run1' }))).code).toBe(1);
		await run(t, request({ runId: 'run3', sessionId: 'anthropic-run1' }));
		expect(messagesOf(t.requests[2]).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
	});
});

describe('Anthropic: エラーの分類', () => {
	const errorBody = (type: string, message: string) =>
		JSON.stringify({ type: 'error', error: { type, message } });

	it.each([
		[401, 'authentication_error', '認証に失敗', true],
		[403, 'permission_error', '認証に失敗', true],
		[404, 'not_found_error', 'モデルが見つかりません', false],
		[400, 'invalid_request_error', 'リクエストを受け付けませんでした', false],
		[429, 'rate_limit_error', 'レート制限', false],
		[529, 'overloaded_error', '混雑', false],
		[500, 'api_error', 'エラーが起きました', false],
		[503, 'api_error', 'エラーが起きました', false]
	])(
		'HTTP %i (%s) を日本語のメッセージにする(キーを含めない)',
		async (status, type, word, auth) => {
			const t = setup([new Response(errorBody(type, `bad key ${KEY}`), { status })]);
			const exit = await run(t);
			expect(exit.code).toBe(1);
			expect(exit.cancelled).toBe(false);
			expect(exit.stderr).toContain(word);
			expect(exit.stderr).not.toContain(KEY);
			expect(Boolean(exit.authError)).toBe(auth);
		}
	);

	it('400 は定型文に、サーバーの理由を短縮して添える', async () => {
		const long = 'x'.repeat(500);
		const t = setup([
			new Response(errorBody('invalid_request_error', `max_tokens: ${long}`), { status: 400 })
		]);
		const exit = await run(t);
		expect(exit.stderr).toContain('invalid_request_error');
		expect(exit.stderr).toContain('max_tokens: xxx');
		expect(exit.stderr.length).toBeLessThan(500);
		expect(exit.stderr).toContain('…');
	});

	it('429 は retry-after があれば待ち時間を表示する', async () => {
		const t = setup([
			new Response(errorBody('rate_limit_error', 'slow down'), {
				status: 429,
				headers: { 'retry-after': '30' }
			}),
			new Response(errorBody('rate_limit_error', 'slow down'), { status: 429 })
		]);
		expect((await run(t)).stderr).toContain('30 秒');
		expect((await run(t)).stderr).not.toContain('秒ほど');
	});

	it('retry-after が数値でなければ(不正な値は)表示しない', async () => {
		const t = setup([new Response('{}', { status: 429, headers: { 'retry-after': 'soon <b>' } })]);
		const exit = await run(t);
		expect(exit.stderr).not.toContain('soon');
	});

	it('ストリームの途中の overloaded_error はエラーにし、それまでの本文は残す', async () => {
		const t = setup([
			sseResponse([
				anthropicEvent('message_start', { message: {} }),
				...anthropicText(0, '途中'),
				anthropicEvent('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })
			])
		]);
		const exit = await run(t);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('混雑');
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: '途中' }]);
		expect(t.turn.done).toBe(false);
	});

	it('stop_reason が max_tokens なら、最大トークン数を増やすよう案内する', async () => {
		const t = setup([sseResponse(anthropicMessage(anthropicText(0, '長い'), 'max_tokens'))]);
		const exit = await run(t);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('最大トークン数');
	});

	it('通信できないときのエラーにも API キーを含めない', async () => {
		const t = setup([
			() => {
				throw new Error(`fetch failed for key ${KEY}`);
			}
		]);
		const exit = await run(t);
		expect(exit.stderr).toContain('接続できませんでした');
		expect(exit.stderr).not.toContain(KEY);
	});

	it('空の応答は履歴に入れずにエラーにする', async () => {
		const t = setup([sseResponse(anthropicMessage([]))]);
		const exit = await run(t);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('空の応答');
	});

	it('キー未設定・モデル未選択・不正な URL は、通信せずに説明する', async () => {
		const noKey = setup([], { getKey: async () => null });
		const a = await run(noKey);
		expect(a).toMatchObject({ code: 1, authError: true });
		expect(a.stderr).toContain('キー');

		const noModel = setup([]);
		expect((await run(noModel, request({ settings: settings({ model: ' ' }) }))).stderr).toContain(
			'モデルが選ばれていません'
		);

		const badUrl = setup([]);
		const c = await run(badUrl, request({ settings: settings({ baseUrl: 'http://example.com' }) }));
		expect(c.stderr).toContain('localhost');
		expect(noKey.requests.length + noModel.requests.length + badUrl.requests.length).toBe(0);
	});

	it('キーは画面へ流す行にも含まれない', async () => {
		const t = setup([sseResponse(anthropicMessage(anthropicText(0, 'ok')))]);
		await run(t);
		expect(t.lines.join('\n')).not.toContain(KEY);
	});
});

describe('Anthropic: 中断とタイムアウト', () => {
	const hangUntilAbort =
		() =>
		(req: RecordedRequest): Promise<Response> =>
			new Promise<Response>((_, reject) => {
				(req.init.signal as AbortSignal).addEventListener('abort', () =>
					reject(new DOMException('aborted', 'AbortError'))
				);
			});

	it('実行前に中断済みなら、通信せずに中断として返す', async () => {
		const t = setup([hangUntilAbort()]);
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
				c.enqueue(encoder.encode(anthropicText(0, '途中まで').join('')));
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
				sseResponse(anthropicMessage(anthropicToolUse(0, 'toolu_a', 'search', '{}'), 'tool_use')),
				sseResponse(anthropicMessage(anthropicText(0, '来ない')))
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
		const exit = await run(t);
		expect(exit.code).toBe(1);
		expect(exit.cancelled).toBe(false);
		expect(exit.stderr).toContain('タイムアウト');
	});
});

describe('Anthropic: ツール定義の変換', () => {
	it('inputSchema を input_schema に移す(10 ツールすべて)', () => {
		const converted = toAnthropicTools(STORIFT_TOOLS);
		expect(converted).toHaveLength(10);
		converted.forEach((c, i) => {
			expect(c).toEqual({
				name: STORIFT_TOOLS[i].name,
				description: STORIFT_TOOLS[i].description,
				input_schema: STORIFT_TOOLS[i].inputSchema
			});
			expect((c.input_schema as { type: string }).type).toBe('object');
		});
	});

	it('type が無い inputSchema には object を補い、元の定義は書き換えない', () => {
		const spec = { name: 'x', description: 'd', inputSchema: { properties: {} } };
		expect(toAnthropicTools([spec])[0].input_schema).toEqual({ type: 'object', properties: {} });
		expect(spec.inputSchema).toEqual({ properties: {} });
	});
});

describe('Anthropic: 状態・モデル一覧・接続テスト', () => {
	const modelsResponse = (over: Record<string, unknown> = {}) =>
		new Response(
			JSON.stringify({
				data: [
					{ id: 'claude-b', type: 'model' },
					{ id: 'claude-a', type: 'model' },
					{ id: 'claude-b', type: 'model' }
				],
				has_more: false,
				...over
			}),
			{ headers: { 'content-type': 'application/json' } }
		);

	it('候補表示用のモデル ID の例を持つ(既定値にはしない)', async () => {
		expect(ANTHROPIC_MODEL_EXAMPLES).toEqual([
			'claude-sonnet-5-5',
			'claude-opus-5-5',
			'claude-haiku-5-5',
			'claude-fable-5-1'
		]);
		expect(DEFAULT_AI_SETTINGS.anthropic.model).toBe('');
		const t = setup([]);
		const status = await t.provider.status(settings({ model: '' }));
		expect(status.found).toBe(false);
		expect(status.error).toContain('モデル');
	});

	it('status: キー・モデル・URL がそろっていれば使える。足りなければ理由を返す', async () => {
		const t = setup([]);
		const ok = await t.provider.status(settings());
		expect(ok.found).toBe(true);
		expect(ok.version).toContain('api.example.com');
		const noKey = setup([], { getKey: async () => null });
		expect((await noKey.provider.status(settings())).error).toContain('キー');
		expect((await t.provider.status(settings({ baseUrl: 'ftp://x' }))).found).toBe(false);
	});

	it('listModels: GET /v1/models?limit=100 をキー付きで呼び、API の順で重複なく返す', async () => {
		const t = setup([modelsResponse()]);
		expect(await t.provider.listModels!(settings())).toEqual(['claude-b', 'claude-a']);
		const [req] = t.requests;
		expect(req.url).toBe('https://api.example.com/v1/models?limit=100');
		expect(req.init.method).toBe('GET');
		const headers = req.init.headers as Record<string, string>;
		expect(headers['x-api-key']).toBe(KEY);
		expect(headers['anthropic-version']).toBe('2023-06-01');
		expect(req.url).not.toContain(KEY);
	});

	it('listModels: has_more なら after_id で続きを取る', async () => {
		const t = setup([
			modelsResponse({ data: [{ id: 'm1' }], has_more: true, last_id: 'm1' }),
			modelsResponse({ data: [{ id: 'm2' }], has_more: false })
		]);
		expect(await t.provider.listModels!(settings())).toEqual(['m1', 'm2']);
		expect(t.requests[1].url).toBe('https://api.example.com/v1/models?limit=100&after_id=m1');
	});

	it('testConnection: 成功すると件数を、選択中のモデルが無ければ注意を返す', async () => {
		const t = setup([modelsResponse(), modelsResponse()]);
		const ok = await t.provider.testConnection!(settings({ model: 'claude-a' }));
		expect(ok.ok).toBe(true);
		expect(ok.message).toContain('2 件');
		expect(ok.message).not.toContain('一覧にありません');
		const missing = await t.provider.testConnection!(settings({ model: 'zzz' }));
		expect(missing.message).toContain('一覧にありません');
	});

	it('testConnection: 失敗の理由を日本語で返し、キーを含めない', async () => {
		const t = setup([
			new Response(errorJson(`${KEY} is invalid`), { status: 401 }),
			() => {
				throw new Error('connection refused');
			},
			new Response('<html>', { headers: { 'content-type': 'text/html' } })
		]);
		const a = await t.provider.testConnection!(settings());
		expect(a.ok).toBe(false);
		expect(a.message).toContain('認証に失敗');
		expect(a.message).not.toContain(KEY);
		expect((await t.provider.testConnection!(settings())).message).toContain(
			'接続できませんでした'
		);
		expect((await t.provider.testConnection!(settings())).ok).toBe(false);
	});

	it('testConnection: 不正な URL や未設定のキーでは通信しない', async () => {
		const bad = setup([]);
		expect(
			(await bad.provider.testConnection!(settings({ baseUrl: 'http://example.com' }))).ok
		).toBe(false);
		const noKey = setup([], { getKey: async () => null });
		expect((await noKey.provider.testConnection!(settings())).message).toContain('キー');
		expect(bad.requests.length + noKey.requests.length).toBe(0);
	});
});

function errorJson(message: string): string {
	return JSON.stringify({ type: 'error', error: { type: 'authentication_error', message } });
}
