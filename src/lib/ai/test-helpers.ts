/** AI プロバイダのテスト用の道具(アプリ本体からは読み込まない) */
import type { FetchLike } from './http/fetch';

const encoder = new TextEncoder();

/** 文字列の断片を、そのままの区切りで流すストリーム */
export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const c of chunks) controller.enqueue(encoder.encode(c));
			controller.close();
		}
	});
}

/** OpenAI のストリーム応答の 1 イベント */
export function sse(data: unknown): string {
	return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

export function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
	return sse({ choices: [{ index: 0, delta, finish_reason: finish }] });
}

export function sseResponse(events: string[], init: ResponseInit = {}): Response {
	return new Response(streamOf(events), {
		status: 200,
		headers: { 'content-type': 'text/event-stream' },
		...init
	});
}

export interface RecordedRequest {
	url: string;
	init: RequestInit;
	body: Record<string, unknown> | null;
}

/** 呼ばれた順に応答を返し、リクエストを記録する fetch */
export function mockFetch(
	responses: (Response | ((req: RecordedRequest) => Response | Promise<Response>))[]
) {
	const requests: RecordedRequest[] = [];
	const fetch: FetchLike = async (url, init = {}) => {
		const req: RecordedRequest = {
			url,
			init,
			body: typeof init.body === 'string' ? JSON.parse(init.body) : null
		};
		requests.push(req);
		const next = responses[requests.length - 1];
		if (!next) throw new Error('想定外のリクエスト');
		return typeof next === 'function' ? next(req) : next;
	};
	return { fetch, requests };
}
