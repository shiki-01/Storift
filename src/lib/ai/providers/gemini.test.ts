// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { applyStreamLine, createTurnState, turnParts } from '$lib/desktop/stream';
import { MAX_STEPS } from '../http/agent';
import {
	geminiChunk,
	mockFetch,
	sse,
	sseResponse,
	streamOf,
	type RecordedRequest
} from '../test-helpers';
import { DEFAULT_AI_SETTINGS } from '../settings';
import { STORIFT_TOOLS } from '../tool-fixtures';
import type { AiRunRequest, AiSettings } from '../types';
import { createGeminiProvider, GEMINI_MODEL_EXAMPLES, type GeminiProviderDeps } from './gemini';

const KEY = 'AIzaSyTest0123456789abcdefghijklmnop';
const TOOLS = [
	{
		name: 'search',
		description: '検索',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: { query: { type: 'string', default: '' } }
		}
	},
	{ name: 'get_scene', description: '本文', inputSchema: { type: 'object', properties: {} } }
];

function settings(over: Partial<AiSettings['gemini']> = {}): AiSettings {
	return {
		...structuredClone(DEFAULT_AI_SETTINGS),
		provider: 'gemini',
		gemini: { baseUrl: 'https://api.example.com', model: 'gemini-test', ...over }
	};
}

function request(over: Partial<AiRunRequest> = {}): AiRunRequest {
	return { runId: 'run1', prompt: '質問です', editMode: 'suggest', settings: settings(), ...over };
}

function setup(responses: Parameters<typeof mockFetch>[0], deps: Partial<GeminiProviderDeps> = {}) {
	const { fetch, requests } = mockFetch(responses);
	const callTool = vi.fn(async (name: string) => ({ text: `${name} の結果`, isError: false }));
	const provider = createGeminiProvider({
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

type Content = { role: string; parts: Record<string, unknown>[] };
const contentsOf = (req: RecordedRequest) => req.body?.contents as Content[];
const call = (
	name: string,
	args: Record<string, unknown>,
	extra: Record<string, unknown> = {}
) => ({
	functionCall: { name, args },
	...extra
});

describe('Gemini: テキストだけの応答', () => {
	it('テキストの差分を逐次流し、結果を返す', async () => {
		const t = setup([
			sseResponse([geminiChunk([{ text: 'こん' }]), geminiChunk([{ text: 'にちは' }], 'STOP')])
		]);
		const exit = await run(t);
		expect(exit).toMatchObject({ code: 0, cancelled: false, requestId: 'run1' });
		expect(t.turn.done).toBe(true);
		expect(t.turn.sessionId).toBe('gemini-run1');
		expect(t.turn.model).toBe('gemini-test');
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: 'こんにちは' }]);
		expect(t.lines.filter((l) => l.includes('text_delta'))).toHaveLength(2);
	});

	it('リクエストの形(URL・ヘッダー・systemInstruction・contents・tools・toolConfig)', async () => {
		const t = setup([sseResponse([geminiChunk([{ text: 'ok' }], 'STOP')])]);
		await run(t, request({ appendSystemPrompt: '追加の指示' }));
		const [req] = t.requests;
		expect(req.url).toBe(
			'https://api.example.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse'
		);
		expect(req.init.method).toBe('POST');
		const headers = req.init.headers as Record<string, string>;
		expect(headers['x-goog-api-key']).toBe(KEY);
		expect(headers['content-type']).toBe('application/json');
		// キーは URL(クエリ)にも本文にも含まれない
		expect(req.url).not.toContain(KEY);
		expect(req.url).not.toMatch(/[?&]key=/);
		expect(JSON.stringify(req.body)).not.toContain(KEY);

		const system = (req.body?.systemInstruction as { parts: { text: string }[] }).parts;
		expect(system).toHaveLength(1);
		expect(system[0].text).toContain('小説の執筆を支える');
		expect(system[0].text).toContain('追加の指示');
		expect(contentsOf(req)).toEqual([{ role: 'user', parts: [{ text: '質問です' }] }]);
		expect(req.body?.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
		// ツール定義は Gemini 向けに変換される(additionalProperties・default は除かれ、引数なしは parameters 無し)
		expect(req.body?.tools).toEqual([
			{
				functionDeclarations: [
					{
						name: 'search',
						description: '検索',
						parameters: { type: 'object', properties: { query: { type: 'string' } } }
					},
					{ name: 'get_scene', description: '本文' }
				]
			}
		]);
		// maxOutputTokens は設定が無ければ省く
		expect(req.body).not.toHaveProperty('generationConfig');
	});

	it('maxOutputTokens を設定すれば generationConfig で送る', async () => {
		const t = setup([sseResponse([geminiChunk([{ text: 'ok' }], 'STOP')])]);
		await run(t, request({ settings: settings({ maxOutputTokens: 2048 }) }));
		expect(t.requests[0].body?.generationConfig).toEqual({ maxOutputTokens: 2048 });
	});

	it('モデル名に models/ が付いていても、パスは重ならない', async () => {
		const t = setup([sseResponse([geminiChunk([{ text: 'ok' }], 'STOP')])]);
		await run(t, request({ settings: settings({ model: 'models/gemini-x' }) }));
		expect(t.requests[0].url).toContain('/v1beta/models/gemini-x:streamGenerateContent');
	});

	it('思考(thought: true)の部分は表示しない', async () => {
		const t = setup([
			sseResponse([
				geminiChunk([{ text: '考え中…', thought: true }]),
				geminiChunk([{ text: '答えです' }], 'STOP')
			])
		]);
		await run(t);
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: '答えです' }]);
		expect(t.lines.join('\n')).not.toContain('考え中');
	});

	it('細かい断片で届いても結果が変わらない', async () => {
		const wire =
			geminiChunk([{ text: 'あ' }]) + geminiChunk([call('search', { query: 'い' })], 'STOP');
		const second = geminiChunk([{ text: '終わり' }], 'STOP');
		for (const size of [1, 5, 11, 1000]) {
			const pieces = wire.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];
			const t = setup([
				new Response(streamOf(pieces), { headers: { 'content-type': 'text/event-stream' } }),
				sseResponse([second])
			]);
			expect((await run(t)).code, `size ${size}`).toBe(0);
			expect(t.callTool).toHaveBeenCalledWith('search', { query: 'い' }, 'run1');
			expect(turnParts(t.turn).at(-1)).toEqual({ kind: 'text', text: '終わり' });
		}
	});
});

describe('Gemini: ツール呼び出し', () => {
	it('1 回のツール呼び出し: オブジェクト引数で実行し、functionResponse を user で返す', async () => {
		const t = setup([
			sseResponse([
				geminiChunk([{ text: '調べます。' }]),
				geminiChunk([call('search', { query: '主人公' })], 'STOP')
			]),
			sseResponse([geminiChunk([{ text: '見つかりました。' }], 'STOP')])
		]);
		expect((await run(t)).code).toBe(0);
		expect(t.callTool).toHaveBeenCalledWith('search', { query: '主人公' }, 'run1');

		const second = contentsOf(t.requests[1]);
		expect(second.map((c) => c.role)).toEqual(['user', 'model', 'user']);
		// model の parts は受け取ったまま
		expect(second[1].parts).toEqual([
			{ text: '調べます。' },
			{ functionCall: { name: 'search', args: { query: '主人公' } } }
		]);
		// 文字列の結果は {result: …} に包む
		expect(second[2]).toEqual({
			role: 'user',
			parts: [
				{
					functionResponse: {
						name: 'search',
						response: { result: 'search の結果' }
					}
				}
			]
		});
		expect(turnParts(t.turn)).toEqual([
			{ kind: 'text', text: '調べます。' },
			{ kind: 'tool', name: 'search', summary: '"主人公"' },
			{ kind: 'text', text: '見つかりました。' }
		]);
		expect(t.lines.some((l) => l.includes('mcp__storift__search'))).toBe(true);
	});

	it('API が functionCall に id を付けなければ、functionResponse にも id を付けない', async () => {
		const t = setup([
			sseResponse([geminiChunk([call('search', { query: 'a' })], 'STOP')]),
			sseResponse([geminiChunk([{ text: 'ok' }], 'STOP')])
		]);
		await run(t);
		expect(contentsOf(t.requests[1])[2].parts).toEqual([
			{ functionResponse: { name: 'search', response: { result: 'search の結果' } } }
		]);
	});

	it('API が functionCall に id を付けたら、functionResponse に同じ id を返す', async () => {
		const t = setup([
			sseResponse([
				geminiChunk(
					[{ functionCall: { id: 'fc-1', name: 'search', args: { query: 'a' } } }],
					'STOP'
				)
			]),
			sseResponse([geminiChunk([{ text: 'ok' }], 'STOP')])
		]);
		await run(t);
		expect(contentsOf(t.requests[1])[2].parts).toEqual([
			{ functionResponse: { id: 'fc-1', name: 'search', response: { result: 'search の結果' } } }
		]);
	});

	it('複数のツール: 出てきた順に実行し、結果を 1 つの user メッセージの複数 parts にまとめる', async () => {
		const order: string[] = [];
		const t = setup(
			[
				sseResponse([
					geminiChunk([call('search', { query: 'a' })]),
					geminiChunk([call('get_scene', { sceneId: 's1' })], 'STOP')
				]),
				sseResponse([geminiChunk([{ text: '完了' }], 'STOP')])
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
		const second = contentsOf(t.requests[1]);
		expect(second).toHaveLength(3);
		expect(second[2].role).toBe('user');
		expect(second[2].parts).toEqual([
			{ functionResponse: { name: 'search', response: { result: 'search 完了' } } },
			{ functionResponse: { name: 'get_scene', response: { result: 'get_scene 完了' } } }
		]);
	});

	it('1 つの応答に複数の functionCall が入っていても、model の parts は欠かさず残す', async () => {
		const t = setup([
			sseResponse([geminiChunk([call('search', { query: 'a' }), call('get_scene', {})], 'STOP')]),
			sseResponse([geminiChunk([{ text: 'ok' }], 'STOP')])
		]);
		await run(t);
		expect(contentsOf(t.requests[1])[1].parts).toEqual([
			call('search', { query: 'a' }),
			call('get_scene', {})
		]);
		expect(contentsOf(t.requests[1])[2].parts).toHaveLength(2);
	});

	it('thoughtSignature などの未知の項目を含む parts を、受け取ったまま model の content に残す', async () => {
		const parts = [
			{ text: '思考の要約', thought: true, thoughtSignature: 'sig-A' },
			{ text: '調べます。', thoughtSignature: 'sig-B', futureField: { nested: [1, 2] } },
			call('search', { query: 'x' }, { thoughtSignature: 'sig-C' })
		];
		const t = setup([
			// parts が複数のチャンクに分かれて届く
			sseResponse([geminiChunk(parts.slice(0, 2)), geminiChunk(parts.slice(2), 'STOP')]),
			sseResponse([geminiChunk([{ text: '終わり' }], 'STOP')])
		]);
		await run(t);
		expect(contentsOf(t.requests[1])[1]).toEqual({ role: 'model', parts });
		// 表示には思考を出さない
		expect(turnParts(t.turn)[0]).toEqual({ kind: 'text', text: '調べます。' });
	});

	it('ツールが失敗したら「エラー: …」を結果として返し、続行する', async () => {
		const t = setup(
			[
				sseResponse([geminiChunk([call('get_scene', {})], 'STOP')]),
				sseResponse([geminiChunk([{ text: 'わかりました' }], 'STOP')])
			],
			{ callTool: async () => ({ text: 'sceneId を指定してください', isError: true }) }
		);
		expect((await run(t)).code).toBe(0);
		expect(contentsOf(t.requests[1])[2].parts).toEqual([
			{
				functionResponse: {
					name: 'get_scene',
					response: { result: 'エラー: sceneId を指定してください' }
				}
			}
		]);
	});

	it('自由形式の object を文字列にした引数を、実行前にオブジェクトへ戻す', async () => {
		const t = setup(
			[
				sseResponse([
					geminiChunk(
						[call('propose_create', { kind: 'memos', fields: '{"本文":"メモ"}' })],
						'STOP'
					)
				]),
				sseResponse([geminiChunk([{ text: 'ok' }], 'STOP')])
			],
			{ loadTools: async () => STORIFT_TOOLS }
		);
		await run(t, request({ editMode: 'confirm' }));
		expect(t.callTool).toHaveBeenCalledWith(
			'propose_create',
			{ kind: 'memos', fields: { 本文: 'メモ' } },
			'run1'
		);
	});

	it('最大ステップ(12)に達したら打ち切ってエラーにする', async () => {
		const responses = Array.from({ length: 20 }, () =>
			sseResponse([geminiChunk([call('search', {})], 'STOP')])
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

describe('Gemini: 会話の継続', () => {
	it('同じセッション ID なら履歴(parts)を引き継ぎ、別の ID なら新しく始める', async () => {
		const t = setup([
			sseResponse([geminiChunk([{ text: '一回目', thoughtSignature: 's' }], 'STOP')]),
			sseResponse([geminiChunk([{ text: '二回目' }], 'STOP')]),
			sseResponse([geminiChunk([{ text: '三回目' }], 'STOP')])
		]);
		await run(t);
		await run(t, request({ runId: 'run2', prompt: '続き', sessionId: 'gemini-run1' }));
		expect(contentsOf(t.requests[1])).toEqual([
			{ role: 'user', parts: [{ text: '質問です' }] },
			{ role: 'model', parts: [{ text: '一回目', thoughtSignature: 's' }] },
			{ role: 'user', parts: [{ text: '続き' }] }
		]);
		expect(t.requests[1].body?.systemInstruction).toBeTruthy();
		await run(t, request({ runId: 'run3', sessionId: 'gemini-unknown' }));
		expect(contentsOf(t.requests[2]).map((c) => c.role)).toEqual(['user']);
	});

	it('失敗した実行は履歴に残さない', async () => {
		const t = setup([
			sseResponse([geminiChunk([{ text: '一回目' }], 'STOP')]),
			new Response('{"error":{"code":500,"message":"boom","status":"INTERNAL"}}', { status: 500 }),
			sseResponse([geminiChunk([{ text: '三回目' }], 'STOP')])
		]);
		await run(t);
		expect((await run(t, request({ runId: 'run2', sessionId: 'gemini-run1' }))).code).toBe(1);
		await run(t, request({ runId: 'run3', sessionId: 'gemini-run1' }));
		expect(contentsOf(t.requests[2]).map((c) => c.role)).toEqual(['user', 'model', 'user']);
	});
});

describe('Gemini: エラーの分類', () => {
	const errorBody = (code: number, status: string, message: string, reason?: string) =>
		JSON.stringify({
			error: {
				code,
				message,
				status,
				...(reason
					? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] }
					: {})
			}
		});

	it.each([
		[400, 'INVALID_ARGUMENT', 'リクエストを受け付けませんでした', false],
		[403, 'PERMISSION_DENIED', '認証に失敗', true],
		[404, 'NOT_FOUND', 'モデルが見つかりません', false],
		[429, 'RESOURCE_EXHAUSTED', '利用上限', false],
		[500, 'INTERNAL', 'エラーが起きました', false],
		[503, 'UNAVAILABLE', 'エラーが起きました', false]
	])(
		'HTTP %i (%s) を日本語のメッセージにする(キーを含めない)',
		async (status, name, word, auth) => {
			const t = setup([new Response(errorBody(status, name, `bad key ${KEY}`), { status })]);
			const exit = await run(t);
			expect(exit.code).toBe(1);
			expect(exit.stderr).toContain(word);
			expect(exit.stderr).not.toContain(KEY);
			expect(Boolean(exit.authError)).toBe(auth);
		}
	);

	it('400 でも API_KEY_INVALID なら認証のエラーとして扱う', async () => {
		const t = setup([
			new Response(
				errorBody(
					400,
					'INVALID_ARGUMENT',
					'API key not valid. Please pass a valid API key.',
					'API_KEY_INVALID'
				),
				{ status: 400 }
			)
		]);
		const exit = await run(t);
		expect(exit).toMatchObject({ code: 1, authError: true });
		expect(exit.stderr).toContain('認証に失敗');
	});

	it('details が無くても、メッセージの「API key not valid」で認証と判定する', async () => {
		const t = setup([
			new Response(
				errorBody(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'),
				{
					status: 400
				}
			)
		]);
		expect((await run(t)).authError).toBe(true);
	});

	it('ストリームの途中で error が届いたらエラーにし、それまでの本文は残す', async () => {
		const t = setup([
			sseResponse([
				geminiChunk([{ text: '途中' }]),
				sse({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } })
			])
		]);
		const exit = await run(t);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('エラーが起きました');
		expect(turnParts(t.turn)).toEqual([{ kind: 'text', text: '途中' }]);
		expect(t.turn.done).toBe(false);
	});

	it.each([
		['MAX_TOKENS', '最大トークン数'],
		['SAFETY', '安全性フィルター'],
		['RECITATION', '既存の文章'],
		['MALFORMED_FUNCTION_CALL', '正しくないツール呼び出し'],
		['PROHIBITED_CONTENT', '禁止されている内容'],
		['SOMETHING_NEW', 'SOMETHING_NEW']
	])('finishReason %s を日本語のエラーにする', async (reason, word) => {
		const t = setup([sseResponse([geminiChunk([{ text: '一部' }], reason)])]);
		const exit = await run(t);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain(word);
	});

	it('promptFeedback.blockReason は入力が拒否されたエラーにする', async () => {
		const t = setup([sseResponse([sse({ promptFeedback: { blockReason: 'SAFETY' } })])]);
		const exit = await run(t);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('入力が');
		expect(exit.stderr).toContain('拒否');
	});

	it('空の応答は履歴に入れずにエラーにする', async () => {
		const t = setup([sseResponse([geminiChunk([], 'STOP')])]);
		const exit = await run(t);
		expect(exit.code).toBe(1);
		expect(exit.stderr).toContain('空の応答');
	});

	it('通信できないときのエラーにも API キーを含めない', async () => {
		const t = setup([
			() => {
				throw new Error(`fetch failed ${KEY}`);
			}
		]);
		const exit = await run(t);
		expect(exit.stderr).toContain('接続できませんでした');
		expect(exit.stderr).not.toContain(KEY);
	});

	it('キー未設定・モデル未選択・不正な URL は、通信せずに説明する', async () => {
		const noKey = setup([], { getKey: async () => null });
		expect(await run(noKey)).toMatchObject({ code: 1, authError: true });

		const noModel = setup([]);
		expect((await run(noModel, request({ settings: settings({ model: '' }) }))).stderr).toContain(
			'モデルが選ばれていません'
		);
		const badUrl = setup([]);
		expect(
			(await run(badUrl, request({ settings: settings({ baseUrl: 'http://example.com' }) }))).code
		).toBe(1);
		expect(noKey.requests.length + noModel.requests.length + badUrl.requests.length).toBe(0);
	});

	it('キーは画面へ流す行にも含まれない', async () => {
		const t = setup([sseResponse([geminiChunk([{ text: 'ok' }], 'STOP')])]);
		await run(t);
		expect(t.lines.join('\n')).not.toContain(KEY);
	});
});

describe('Gemini: 中断とタイムアウト', () => {
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
		expect(await t.provider.run(request(), t.emit, controller.signal)).toMatchObject({
			code: null,
			cancelled: true
		});
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
		let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				controllerRef = c;
				c.enqueue(new TextEncoder().encode(geminiChunk([{ text: '途中まで' }])));
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
				sseResponse([geminiChunk([call('search', {})], 'STOP')]),
				sseResponse([geminiChunk([{ text: '来ない' }], 'STOP')])
			],
			{
				callTool: async () => {
					controller.abort();
					return { text: 'x', isError: false };
				}
			}
		);
		expect(await t.provider.run(request(), t.emit, controller.signal)).toMatchObject({
			code: null,
			cancelled: true
		});
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

describe('Gemini: 状態・モデル一覧・接続テスト', () => {
	const modelsResponse = (over: Record<string, unknown> = {}) =>
		new Response(
			JSON.stringify({
				models: [
					{
						name: 'models/gemini-2.5-pro',
						supportedGenerationMethods: ['generateContent', 'countTokens']
					},
					{ name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
					{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
					{ name: 'models/no-methods' },
					{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }
				],
				...over
			}),
			{ headers: { 'content-type': 'application/json' } }
		);

	it('候補表示用のモデル ID の例を持つ(既定値にはしない)', async () => {
		expect(GEMINI_MODEL_EXAMPLES).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
		expect(DEFAULT_AI_SETTINGS.gemini.model).toBe('');
		const t = setup([]);
		expect((await t.provider.status(settings({ model: '' }))).error).toContain('モデル');
	});

	it('status: キー・モデル・URL がそろっていれば使える。足りなければ理由を返す', async () => {
		const t = setup([]);
		const ok = await t.provider.status(settings());
		expect(ok.found).toBe(true);
		expect(ok.version).toContain('api.example.com');
		const noKey = setup([], { getKey: async () => null });
		expect((await noKey.provider.status(settings())).found).toBe(false);
		expect((await t.provider.status(settings({ baseUrl: 'ftp://x' }))).found).toBe(false);
	});

	it('listModels: generateContent に対応するものだけを、models/ を除いて返す', async () => {
		const t = setup([modelsResponse()]);
		expect(await t.provider.listModels!(settings())).toEqual([
			'gemini-2.5-pro',
			'gemini-2.5-flash'
		]);
		const [req] = t.requests;
		expect(req.url).toBe('https://api.example.com/v1beta/models?pageSize=100');
		expect(req.init.method).toBe('GET');
		expect((req.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
		expect(req.url).not.toContain(KEY);
	});

	it('listModels: nextPageToken があれば続きを取る', async () => {
		const t = setup([
			modelsResponse({
				models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }],
				nextPageToken: 'tok'
			}),
			modelsResponse({
				models: [{ name: 'models/b', supportedGenerationMethods: ['generateContent'] }]
			})
		]);
		expect(await t.provider.listModels!(settings())).toEqual(['a', 'b']);
		expect(t.requests[1].url).toBe(
			'https://api.example.com/v1beta/models?pageSize=100&pageToken=tok'
		);
	});

	it('testConnection: 成功すると件数を、選択中のモデルが無ければ注意を返す', async () => {
		const t = setup([modelsResponse(), modelsResponse()]);
		const ok = await t.provider.testConnection!(settings({ model: 'gemini-2.5-pro' }));
		expect(ok.ok).toBe(true);
		expect(ok.message).toContain('2 件');
		expect(ok.message).not.toContain('一覧にありません');
		expect((await t.provider.testConnection!(settings({ model: 'zzz' }))).message).toContain(
			'一覧にありません'
		);
	});

	it('testConnection: キー不正(400 API_KEY_INVALID)などの失敗を日本語で返し、キーを含めない', async () => {
		const t = setup([
			new Response(
				JSON.stringify({
					error: {
						code: 400,
						status: 'INVALID_ARGUMENT',
						message: `API key not valid: ${KEY}`,
						details: [{ reason: 'API_KEY_INVALID' }]
					}
				}),
				{ status: 400 }
			),
			() => {
				throw new Error('connection refused');
			},
			new Response('not json', { headers: { 'content-type': 'text/html' } })
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
});
