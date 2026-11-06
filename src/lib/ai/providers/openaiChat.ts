/**
 * OpenAI 互換の Chat Completions(`POST {baseUrl}/chat/completions`、stream: true)のアダプタ。
 * ストリームの `delta.content`(テキスト)と `delta.tool_calls`(index ごとに引数の断片を結合)を集め、
 * 共通のエージェントのループ(http/agent.ts)に応答 1 回ぶんを返す。
 */
import { linkTimeout, translateFetchError } from '../http/abort';
import type { AgentAdapter, StepResult, ToolCall, ToolOutcome, ToolSpec } from '../http/agent';
import { AiHttpError, classifyHttpError, redact } from '../http/errors';
import type { FetchLike } from '../http/fetch';
import { parseSse } from '../http/sse';
import { joinUrl } from '../http/url';

/** 1 リクエストの上限 */
export const REQUEST_TIMEOUT_MS = 600_000;
const ERROR_BODY_LIMIT = 4096;

export type OpenAiMessage = Record<string, unknown>;

export interface OpenAiAdapterConfig {
	/** 検証済みの Base URL */
	baseUrl: string;
	model: string;
	apiKey?: string;
	fetch: FetchLike;
	/** 画面に出すサービス名(エラー文に使う) */
	label: string;
	timeoutMs?: number;
}

export function authHeaders(apiKey?: string): Record<string, string> {
	return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

interface PartialCall {
	id: string;
	name: string;
	args: string;
}

type Json = Record<string, unknown>;

const asRecord = (v: unknown): Json | undefined =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;

/** 引数の文字列を JSON オブジェクトにする(読めなければ理由つきで返す) */
export function parseToolArgs(raw: string): { args: Json; invalid?: string } {
	if (!raw.trim()) return { args: {} };
	try {
		const value = JSON.parse(raw) as unknown;
		const rec = asRecord(value);
		if (rec) return { args: rec };
	} catch {
		// 下で理由を返す
	}
	return {
		args: {},
		invalid:
			'ツールの引数が JSON オブジェクトとして読めませんでした。引数を JSON オブジェクトで指定して、もう一度呼び出してください。'
	};
}

export function toOpenAiTools(tools: ToolSpec[]): unknown[] {
	return tools.map((t) => ({
		type: 'function',
		function: { name: t.name, description: t.description, parameters: t.inputSchema }
	}));
}

export function createOpenAiAdapter(cfg: OpenAiAdapterConfig): AgentAdapter<OpenAiMessage> {
	const timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;
	const secrets = [cfg.apiKey];
	let callCounter = 0;

	function finish(text: string, partials: Map<number, PartialCall>): StepResult {
		const toolCalls: ToolCall[] = [...partials.entries()]
			.sort((a, b) => a[0] - b[0])
			.filter(([, c]) => c.name)
			.map(([, c]) => {
				const parsed = parseToolArgs(c.args);
				return {
					id: c.id || `call_${++callCounter}`,
					name: c.name,
					args: parsed.args,
					invalidArgs: parsed.invalid
				};
			});
		return { text, toolCalls };
	}

	/** ストリームではなく 1 つの JSON で返された応答(stream を無視するサーバー) */
	function fromJson(body: Json, onText: (d: string) => void): StepResult {
		const message = asRecord(asRecord((body.choices as unknown[] | undefined)?.[0])?.message);
		const text = typeof message?.content === 'string' ? message.content : '';
		if (text) onText(text);
		const partials = new Map<number, PartialCall>();
		const calls = Array.isArray(message?.tool_calls) ? (message.tool_calls as unknown[]) : [];
		calls.forEach((raw, i) => {
			const fn = asRecord(asRecord(raw)?.function);
			const args = fn?.arguments;
			partials.set(i, {
				id: String(asRecord(raw)?.id ?? ''),
				name: String(fn?.name ?? ''),
				args: typeof args === 'string' ? args : JSON.stringify(args ?? {})
			});
		});
		return finish(text, partials);
	}

	return {
		start(system) {
			return [{ role: 'system', content: system }];
		},

		userMessage(text) {
			return { role: 'user', content: text };
		},

		assistantMessage(step) {
			const message: OpenAiMessage = { role: 'assistant', content: step.text };
			if (step.toolCalls.length) {
				if (!step.text) message.content = null;
				message.tool_calls = step.toolCalls.map((c) => ({
					id: c.id,
					type: 'function',
					function: { name: c.name, arguments: JSON.stringify(c.args) }
				}));
			}
			return message;
		},

		toolMessages(outcomes: ToolOutcome[]) {
			return outcomes.map((o) => ({ role: 'tool', tool_call_id: o.call.id, content: o.text }));
		},

		async step(history, tools, signal, onText) {
			const timeout = linkTimeout(signal, timeoutMs);
			try {
				const body: Json = {
					model: cfg.model,
					messages: history,
					stream: true
				};
				if (tools.length) {
					body.tools = toOpenAiTools(tools);
					body.tool_choice = 'auto';
				}
				const res = await cfg.fetch(joinUrl(cfg.baseUrl, 'chat/completions'), {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Accept: 'text/event-stream',
						...authHeaders(cfg.apiKey)
					},
					body: JSON.stringify(body),
					signal: timeout.signal
				});
				if (!res.ok) {
					const text = (await res.text().catch(() => '')).slice(0, ERROR_BODY_LIMIT);
					throw classifyHttpError(res.status, text, cfg.label, secrets);
				}
				if ((res.headers.get('content-type') ?? '').includes('application/json')) {
					const json = asRecord(await res.json());
					if (json?.error) throw streamError(json.error, secrets, cfg.label);
					return fromJson(json ?? {}, onText);
				}
				if (!res.body)
					throw new AiHttpError('invalid-response', `${cfg.label}の応答を読み取れませんでした。`);

				let text = '';
				const partials = new Map<number, PartialCall>();
				for await (const event of parseSse(res.body)) {
					const data = event.data.trim();
					if (data === '[DONE]') break;
					if (!data) continue;
					let json: Json | undefined;
					try {
						json = asRecord(JSON.parse(data));
					} catch {
						continue;
					}
					if (!json) continue;
					if (json.error) throw streamError(json.error, secrets, cfg.label);
					const delta = asRecord(asRecord((json.choices as unknown[] | undefined)?.[0])?.delta);
					if (!delta) continue;
					if (typeof delta.content === 'string' && delta.content) {
						text += delta.content;
						onText(delta.content);
					}
					if (Array.isArray(delta.tool_calls)) {
						for (const raw of delta.tool_calls) {
							const tc = asRecord(raw);
							if (!tc) continue;
							const index = typeof tc.index === 'number' ? tc.index : 0;
							const cur = partials.get(index) ?? { id: '', name: '', args: '' };
							const fn = asRecord(tc.function);
							if (typeof tc.id === 'string' && tc.id && !cur.id) cur.id = tc.id;
							// 名前は最初の断片だけを採る(毎回名前を繰り返すサーバーがあるため)
							if (typeof fn?.name === 'string' && fn.name && !cur.name) cur.name = fn.name;
							if (typeof fn?.arguments === 'string') cur.args += fn.arguments;
							partials.set(index, cur);
						}
					}
				}
				return finish(text, partials);
			} catch (error) {
				throw translateFetchError(error, signal, timeout, cfg.label, timeoutMs, (s) =>
					redact(s, secrets)
				);
			} finally {
				timeout.dispose();
			}
		}
	};
}

/** ストリームの途中や JSON の応答に含まれる `error` をエラーにする */
function streamError(
	error: unknown,
	secrets: readonly (string | undefined)[],
	label: string
): AiHttpError {
	const rec = asRecord(error);
	const message = typeof error === 'string' ? error : String(rec?.message ?? '');
	const detail = redact(message, secrets).slice(0, 200);
	return new AiHttpError('server', `${label}がエラーを返しました${detail ? `: ${detail}` : '。'}`);
}
