/**
 * Anthropic API の Messages(`POST {baseUrl}/v1/messages`、stream: true)のアダプタ。
 *
 * ストリームの `content_block_*` を index ごとに集める(text は差分を流し、tool_use は
 * `input_json_delta` の断片を結合する)。完成した content ブロック(text と tool_use)は
 * そのまま assistant メッセージとして履歴に残し、ツールの結果は次の user メッセージの
 * `tool_result` ブロックにまとめて返す。
 */
import { linkTimeout, translateFetchError } from '../http/abort';
import type { AgentAdapter, StepResult, ToolCall, ToolOutcome, ToolSpec } from '../http/agent';
import {
	AiHttpError,
	classifyHttpError,
	redact,
	summarizeServerMessage,
	type AiErrorKind
} from '../http/errors';
import type { FetchLike } from '../http/fetch';
import { parseSse } from '../http/sse';
import { joinUrl } from '../http/url';
import { parseToolArgs } from './openaiChat';

/** 1 リクエストの上限 */
export const REQUEST_TIMEOUT_MS = 600_000;
const ERROR_BODY_LIMIT = 4096;
export const ANTHROPIC_VERSION = '2023-06-01';

type Json = Record<string, unknown>;

/** Anthropic の会話履歴の 1 件。content は文字列か、ブロックの配列 */
export interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string | Json[];
}

export interface AnthropicAdapterConfig {
	/** 検証済みの Base URL */
	baseUrl: string;
	model: string;
	maxTokens: number;
	/** システムプロンプト(Messages API ではメッセージではなく、トップレベルの項目) */
	system: string;
	apiKey: string;
	fetch: FetchLike;
	/** 画面に出すサービス名(エラー文に使う) */
	label: string;
	timeoutMs?: number;
}

const asRecord = (v: unknown): Json | undefined =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;

/** リクエストに付けるヘッダー(API キーはここだけに載せる) */
export function anthropicHeaders(apiKey: string): Record<string, string> {
	return {
		'x-api-key': apiKey,
		'anthropic-version': ANTHROPIC_VERSION,
		'content-type': 'application/json'
	};
}

/** ツール定義を Anthropic の形式(`input_schema`)にする */
export function toAnthropicTools(tools: ToolSpec[]): Json[] {
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: { type: 'object', ...t.inputSchema }
	}));
}

/** エラーの種類(`error.type`)に近い HTTP ステータス。ストリームの途中のエラーの分類に使う */
const STATUS_OF_ERROR_TYPE: Record<string, number> = {
	invalid_request_error: 400,
	authentication_error: 401,
	permission_error: 403,
	not_found_error: 404,
	request_too_large: 413,
	rate_limit_error: 429,
	api_error: 500,
	overloaded_error: 529
};

/** `retry-after`(秒、または日時)を、画面に出す短い文にする。読めなければ空 */
function describeRetryAfter(value: string | null | undefined): string {
	const text = value?.trim();
	if (!text) return '';
	if (/^\d{1,6}$/.test(text)) return `${text} 秒ほど待ってから送り直してください。`;
	return '';
}

/**
 * Anthropic API のエラー応答を分類する。
 * 401/403 は認証、404 はモデル、400 は定型文＋サーバーの理由、429 は待ち時間つき、529/5xx は過負荷・障害。
 */
export function classifyAnthropicError(
	status: number,
	body: string,
	label: string,
	secrets: readonly (string | undefined)[] = [],
	retryAfter?: string | null
): AiHttpError {
	const detail = summarizeServerMessage(body, secrets);
	const tail = detail ? `(${detail})` : '';
	const make = (kind: AiErrorKind, message: string) => new AiHttpError(kind, message, status);

	if (status === 404)
		return make(
			'not-found',
			`${label}のモデルが見つかりません(404)。モデル名を確認してください。使えるモデルは「一覧を取得」で確かめられます。${tail}`
		);
	if (status === 400)
		return make(
			'bad-request',
			`${label}がリクエストを受け付けませんでした(400 invalid_request_error)。モデル名・最大トークン数・入力の内容を確認してください。${tail}`
		);
	if (status === 413)
		return make(
			'bad-request',
			`${label}に送る内容が大きすぎます(413)。会話を新しく始めてください。${tail}`
		);
	if (status === 429) {
		const wait = describeRetryAfter(retryAfter);
		return make(
			'rate-limit',
			`${label}のレート制限に達しました(429)。${wait || 'しばらく待ってから送り直してください。'}利用枠も確認してください。${tail}`
		);
	}
	if (status === 529)
		return make(
			'server',
			`${label}が混雑しています(529 overloaded)。時間をおいて送り直してください。${tail}`
		);
	// 401/403(認証)・その他の 5xx は共通の分類
	return classifyHttpError(status, body, label, secrets);
}

/** ストリームの途中で届いた `error` イベントをエラーにする */
function streamError(
	error: unknown,
	secrets: readonly (string | undefined)[],
	label: string
): AiHttpError {
	const rec = asRecord(error);
	const type = typeof rec?.type === 'string' ? rec.type : '';
	const message = typeof rec?.message === 'string' ? rec.message : '';
	const status = STATUS_OF_ERROR_TYPE[type] ?? 500;
	return classifyAnthropicError(status, JSON.stringify({ error: { message } }), label, secrets);
}

/** 応答が途中で止まった理由(`stop_reason`)のうち、エラーとして扱うもの */
function stopReasonError(reason: string | undefined, label: string): AiHttpError | null {
	if (reason === 'max_tokens')
		return new AiHttpError(
			'invalid-response',
			`${label}の応答が最大トークン数に達して途中で終わりました。設定の「最大トークン数」を増やしてください。`
		);
	if (reason === 'refusal')
		return new AiHttpError('invalid-response', `${label}が安全上の理由で応答を拒否しました。`);
	return null;
}

interface Block {
	type: 'text' | 'tool_use';
	text: string;
	id: string;
	name: string;
	/** tool_use の入力。input_json_delta の断片をつないだ文字列 */
	json: string;
	/** content_block_start で完成した入力が来た場合 */
	startInput?: Json;
}

export function createAnthropicAdapter(
	cfg: AnthropicAdapterConfig
): AgentAdapter<AnthropicMessage> {
	const timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;
	const secrets = [cfg.apiKey];
	let callCounter = 0;

	return {
		// システムプロンプトは履歴に入れず、リクエストごとに top-level の system で送る
		start() {
			return [];
		},

		userMessage(text) {
			return { role: 'user', content: text };
		},

		assistantMessage(step) {
			if (Array.isArray(step.raw)) return { role: 'assistant', content: step.raw as Json[] };
			const content: Json[] = [];
			if (step.text) content.push({ type: 'text', text: step.text });
			for (const c of step.toolCalls)
				content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
			return { role: 'assistant', content };
		},

		toolMessages(outcomes: ToolOutcome[]) {
			if (!outcomes.length) return [];
			return [
				{
					role: 'user',
					content: outcomes.map((o) => ({
						type: 'tool_result',
						tool_use_id: o.call.id,
						content: o.text,
						...(o.isError ? { is_error: true } : {})
					}))
				}
			];
		},

		async step(history, tools, signal, onText) {
			const timeout = linkTimeout(signal, timeoutMs);
			try {
				const body: Json = {
					model: cfg.model,
					max_tokens: cfg.maxTokens,
					stream: true,
					system: cfg.system,
					messages: history
				};
				if (tools.length) body.tools = toAnthropicTools(tools);
				const res = await cfg.fetch(joinUrl(cfg.baseUrl, 'v1/messages'), {
					method: 'POST',
					headers: { ...anthropicHeaders(cfg.apiKey), Accept: 'text/event-stream' },
					body: JSON.stringify(body),
					signal: timeout.signal
				});
				if (!res.ok) {
					const text = (await res.text().catch(() => '')).slice(0, ERROR_BODY_LIMIT);
					throw classifyAnthropicError(
						res.status,
						text,
						cfg.label,
						secrets,
						res.headers.get('retry-after')
					);
				}
				if (!res.body)
					throw new AiHttpError('invalid-response', `${cfg.label}の応答を読み取れませんでした。`);

				const blocks = new Map<number, Block>();
				let stopReason: string | undefined;
				for await (const event of parseSse(res.body)) {
					const data = event.data.trim();
					if (!data) continue;
					let json: Json | undefined;
					try {
						json = asRecord(JSON.parse(data));
					} catch {
						continue;
					}
					if (!json) continue;
					const type = typeof json.type === 'string' ? json.type : event.event;
					if (type === 'error') throw streamError(json.error, secrets, cfg.label);
					if (type === 'message_stop') break;
					const index = typeof json.index === 'number' ? json.index : 0;
					if (type === 'content_block_start') {
						const cb = asRecord(json.content_block);
						if (cb?.type === 'text') {
							const initial = typeof cb.text === 'string' ? cb.text : '';
							blocks.set(index, { type: 'text', text: initial, id: '', name: '', json: '' });
							if (initial) onText(initial);
						} else if (cb?.type === 'tool_use') {
							blocks.set(index, {
								type: 'tool_use',
								text: '',
								id: typeof cb.id === 'string' ? cb.id : '',
								name: typeof cb.name === 'string' ? cb.name : '',
								json: '',
								startInput: asRecord(cb.input)
							});
						}
						// thinking など、他の種類のブロックは使わない
					} else if (type === 'content_block_delta') {
						const block = blocks.get(index);
						const delta = asRecord(json.delta);
						if (!block || !delta) continue;
						if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
							block.text += delta.text;
							onText(delta.text);
						} else if (
							delta.type === 'input_json_delta' &&
							typeof delta.partial_json === 'string'
						) {
							block.json += delta.partial_json;
						}
					} else if (type === 'message_delta') {
						const reason = asRecord(json.delta)?.stop_reason;
						if (typeof reason === 'string') stopReason = reason;
					}
					// message_start・content_block_stop・ping は読み飛ばす
				}

				const raw: Json[] = [];
				const toolCalls: ToolCall[] = [];
				let text = '';
				for (const [, b] of [...blocks.entries()].sort((a, c) => a[0] - c[0])) {
					if (b.type === 'text') {
						if (!b.text) continue;
						text += b.text;
						raw.push({ type: 'text', text: b.text });
						continue;
					}
					if (!b.name) continue;
					const parsed = b.json.trim()
						? parseToolArgs(b.json)
						: { args: b.startInput ?? {}, invalid: undefined };
					const id = b.id || `toolu_local_${++callCounter}`;
					toolCalls.push({ id, name: b.name, args: parsed.args, invalidArgs: parsed.invalid });
					raw.push({ type: 'tool_use', id, name: b.name, input: parsed.args });
				}

				const stopError = stopReasonError(stopReason, cfg.label);
				if (stopError) throw stopError;
				// 空の assistant メッセージは次のリクエストで拒否されるため、履歴に入れずに失敗にする
				if (!raw.length)
					throw new AiHttpError('invalid-response', `${cfg.label}から空の応答が返りました。`);
				const result: StepResult = { text, toolCalls, raw };
				return result;
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
