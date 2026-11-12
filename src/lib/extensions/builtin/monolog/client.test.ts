import { describe, expect, it, vi } from 'vitest';
import { ApiError, MonologClient, normalizeTimer } from './client';
import { NetworkError } from './oauth';
import type { TokenManager } from './tokens';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers }
	});
}

function errorBody(code: string, status: number, headers: Record<string, string> = {}) {
	return json(
		{ error: { code, message: `${code} message`, request_id: 'req_1' } },
		status,
		headers
	);
}

function setup(responses: Array<Response | Error>) {
	const queue = [...responses];
	const fetchFn = vi.fn(async (..._args: unknown[]) => {
		const next = queue.shift();
		if (!next) throw new Error('unexpected request');
		if (next instanceof Error) throw next;
		return next;
	});
	let access = 'mla_1';
	const tokens = {
		getAccessToken: vi.fn(async () => access),
		forceRefresh: vi.fn(async () => (access = 'mla_2')),
		peek: vi.fn(() => ({ accessToken: access }))
	};
	const sleep = vi.fn(async (_ms: number) => {});
	let n = 0;
	const client = new MonologClient({
		tokens: tokens as unknown as TokenManager,
		fetch: fetchFn as unknown as typeof fetch,
		sleep,
		newKey: () => `key-${++n}`
	});
	return { client, fetchFn, tokens, sleep };
}

const init = (fetchFn: { mock: { calls: unknown[][] } }, i: number) =>
	fetchFn.mock.calls[i][1] as RequestInit & { headers: Record<string, string> };

describe('MonologClient', () => {
	it('Bearer トークンを付けて https://api.monolog.life/v1 を呼ぶ', async () => {
		const { client, fetchFn } = setup([json({ time_zone: 'Asia/Tokyo' })]);
		expect(await client.getMe()).toEqual({ timeZone: 'Asia/Tokyo' });
		expect(fetchFn.mock.calls[0][0]).toBe('https://api.monolog.life/v1/me');
		expect(init(fetchFn, 0).headers.Authorization).toBe('Bearer mla_1');
		expect(init(fetchFn, 0).headers['Idempotency-Key']).toBeUndefined();
	});

	it('POST /records・/timer/start・/timer/stop には Idempotency-Key を付ける', async () => {
		const { client, fetchFn } = setup([
			json({ status: 'running', started_at: 'T' }, 201),
			json({}, 201),
			json({}, 201)
		]);
		await client.startTimer('執筆');
		await client.stopTimer({ title: 't', memo: 'm' });
		await client.createRecord({
			startedAt: 's',
			endedAt: 'e',
			durationMs: 1,
			title: 't',
			memo: 'm',
			tagName: '執筆'
		});
		const keys = [0, 1, 2].map((i) => init(fetchFn, i).headers['Idempotency-Key']);
		expect(keys.every(Boolean)).toBe(true);
		expect(new Set(keys).size).toBe(3);
		expect(JSON.parse(init(fetchFn, 0).body as string)).toEqual({ tag: { name: '執筆' } });
		expect(JSON.parse(init(fetchFn, 2).body as string)).toEqual({
			started_at: 's',
			ended_at: 'e',
			duration_ms: 1,
			title: 't',
			memo: 'm',
			tag: { name: '執筆' }
		});
	});

	it('通信エラーの再送は同じキーで、指数バックオフで最大 3 回', async () => {
		const { client, fetchFn, sleep } = setup([
			new TypeError('x'),
			new TypeError('x'),
			json({}, 201)
		]);
		await client.stopTimer({ title: 't', memo: 'm' });
		const keys = [0, 1, 2].map((i) => init(fetchFn, i).headers['Idempotency-Key']);
		expect(new Set(keys)).toEqual(new Set(['key-1']));
		expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
	});

	it('通信エラーが続いたら 4 回(初回 + 再送 3 回)で諦め、NetworkError にする', async () => {
		const err = () => new TypeError('x');
		const { client, fetchFn } = setup([err(), err(), err(), err(), err()]);
		await expect(client.stopTimer({ title: 't', memo: 'm' })).rejects.toBeInstanceOf(NetworkError);
		expect(fetchFn).toHaveBeenCalledTimes(4);
	});

	it('401 は 1 回だけ更新して、同じキーで再試行する', async () => {
		const { client, fetchFn, tokens } = setup([errorBody('invalid_token', 401), json({}, 201)]);
		await client.stopTimer({ title: 't', memo: 'm' });
		expect(tokens.forceRefresh).toHaveBeenCalledWith('mla_1');
		expect(init(fetchFn, 1).headers.Authorization).toBe('Bearer mla_2');
		expect(init(fetchFn, 1).headers['Idempotency-Key']).toBe(
			init(fetchFn, 0).headers['Idempotency-Key']
		);
	});

	it('更新しても 401 なら ApiError(更新は 1 回だけ)', async () => {
		const { client, tokens } = setup([
			errorBody('invalid_token', 401),
			errorBody('invalid_token', 401)
		]);
		await expect(client.getMe()).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
		expect(tokens.forceRefresh).toHaveBeenCalledTimes(1);
	});

	it('429 は Retry-After 秒だけ待って、同じキーで再試行する', async () => {
		const { client, fetchFn, sleep } = setup([
			errorBody('rate_limited', 429, { 'Retry-After': '7' }),
			json({}, 201)
		]);
		await client.createRecord({
			startedAt: 's',
			endedAt: 'e',
			durationMs: 1,
			title: 't',
			memo: 'm',
			tagName: 'x'
		});
		expect(sleep).toHaveBeenCalledWith(7000);
		expect(init(fetchFn, 1).headers['Idempotency-Key']).toBe(
			init(fetchFn, 0).headers['Idempotency-Key']
		);
	});

	it('409 は ApiError(code, request_id 付き)として投げる', async () => {
		const { client } = setup([errorBody('timer_already_running', 409)]);
		const error = await client.startTimer().catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			status: 409,
			code: 'timer_already_running',
			requestId: 'req_1'
		});
	});

	it('本文が JSON でないエラーでもステータスで扱える', async () => {
		const { client } = setup([new Response('oops', { status: 500 })]);
		await expect(client.getTimer()).rejects.toMatchObject({ status: 500, code: '' });
	});

	it('GET /timer を正規化する(欠落に防御的)', () => {
		expect(
			normalizeTimer({ status: 'running', started_at: 'T', elapsed_ms: 5, tag: { name: '執筆' } })
		).toEqual({ status: 'running', startedAt: 'T', elapsedMs: 5, tagName: '執筆' });
		expect(normalizeTimer(null)).toEqual({
			status: 'idle',
			startedAt: null,
			elapsedMs: 0,
			tagName: null
		});
	});

	it('keepalive: メモリ上のトークンと新しいキーで、keepalive: true の POST を送る', () => {
		const { client, fetchFn } = setup([json({}, 201)]);
		expect(client.sendKeepalive('/timer/stop', { title: 't', memo: 'm' })).toBe(true);
		const i = init(fetchFn, 0);
		expect(i.keepalive).toBe(true);
		expect(i.method).toBe('POST');
		expect(i.headers.Authorization).toBe('Bearer mla_1');
		expect(i.headers['Idempotency-Key']).toBeTruthy();
	});
});
