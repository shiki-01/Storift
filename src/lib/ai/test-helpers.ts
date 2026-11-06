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

/** Anthropic のストリーム応答の 1 イベント(`event:` と `data:` の組) */
export function anthropicEvent(type: string, data: Record<string, unknown> = {}): string {
	return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

/** Anthropic のテキストブロック 1 つぶん(開始・差分・終了) */
export function anthropicText(index: number, ...deltas: string[]): string[] {
	return [
		anthropicEvent('content_block_start', {
			index,
			content_block: { type: 'text', text: '' }
		}),
		...deltas.map((text) =>
			anthropicEvent('content_block_delta', { index, delta: { type: 'text_delta', text } })
		),
		anthropicEvent('content_block_stop', { index })
	];
}

/** Anthropic の tool_use ブロック 1 つぶん(引数は断片のまま渡す) */
export function anthropicToolUse(
	index: number,
	id: string,
	name: string,
	...jsonFragments: string[]
): string[] {
	return [
		anthropicEvent('content_block_start', {
			index,
			content_block: { type: 'tool_use', id, name, input: {} }
		}),
		...jsonFragments.map((partial_json) =>
			anthropicEvent('content_block_delta', {
				index,
				delta: { type: 'input_json_delta', partial_json }
			})
		),
		anthropicEvent('content_block_stop', { index })
	];
}

/** Anthropic の 1 メッセージぶんのストリーム(blocks は上の関数の結果をつなげたもの) */
export function anthropicMessage(blocks: string[], stopReason = 'end_turn'): string[] {
	return [
		anthropicEvent('message_start', { message: { id: 'msg_1', role: 'assistant', content: [] } }),
		anthropicEvent('ping'),
		...blocks,
		anthropicEvent('message_delta', {
			delta: { stop_reason: stopReason },
			usage: { output_tokens: 1 }
		}),
		anthropicEvent('message_stop')
	];
}

/** Gemini のストリーム応答の 1 チャンク(candidates[0] の parts と finishReason) */
export function geminiChunk(parts: Record<string, unknown>[], finishReason?: string): string {
	return sse({
		candidates: [
			{
				content: { role: 'model', parts },
				...(finishReason ? { finishReason } : {}),
				index: 0
			}
		]
	});
}
