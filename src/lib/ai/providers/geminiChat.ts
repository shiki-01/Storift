/**
 * Gemini API の `streamGenerateContent`(`POST {baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse`)
 * のアダプタ。
 *
 * SSE の各 `data:` は GenerateContentResponse の JSON。`candidates[0].content.parts` を順に処理し、
 * テキストは差分として流し(`thought: true` の部分は表示しない)、`functionCall` はツール呼び出しとして集める。
 * 応答の parts は、`thoughtSignature` などの未知の項目も含めて受け取ったまま `role: 'model'` として履歴に残す
 * (ツール呼び出しを続けるときに署名が必要になることがあるため)。
 * API キーはヘッダー `x-goog-api-key` だけで送り、URL には付けない。
 */
import { linkTimeout, translateFetchError } from '../http/abort';
import type { AgentAdapter, StepResult, ToolCall, ToolOutcome } from '../http/agent';
import { AiHttpError, classifyHttpError, redact, summarizeServerMessage } from '../http/errors';
import type { FetchLike } from '../http/fetch';
import { parseSse } from '../http/sse';
import { joinUrl } from '../http/url';
import { restoreGeminiArgs, toGeminiFunctionDeclarations } from './geminiSchema';

/** 1 リクエストの上限 */
export const REQUEST_TIMEOUT_MS = 600_000;
const ERROR_BODY_LIMIT = 4096;

type Json = Record<string, unknown>;

/** Gemini の会話履歴の 1 件。parts は受け取った形のまま持つ */
export interface GeminiContent {
	role: 'user' | 'model';
	parts: Json[];
}

export interface GeminiAdapterConfig {
	/** 検証済みの Base URL */
	baseUrl: string;
	model: string;
	/** 未設定ならリクエストに含めない */
	maxOutputTokens?: number;
	/** システムプロンプト(`systemInstruction` として毎回送る) */
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
export function geminiHeaders(apiKey: string): Record<string, string> {
	return { 'x-goog-api-key': apiKey, 'content-type': 'application/json' };
}

/** モデル名(`models/` が付いていてもよい)を URL のパスに使う形にする */
export function modelPath(model: string): string {
	return `models/${encodeURIComponent(model.trim().replace(/^models\//, ''))}`;
}

/** エラー応答の本文から、`error.status` と `error.details[].reason` をまとめて文字列にする(判定用) */
function errorMarkers(body: string): string {
	try {
		const err = asRecord(asRecord(JSON.parse(body))?.error);
		const details = Array.isArray(err?.details) ? err.details : [];
		const reasons = details.map((d) => String(asRecord(d)?.reason ?? ''));
		return [String(err?.status ?? ''), ...reasons].join(' ');
	} catch {
		return '';
	}
}

/**
 * Gemini API のエラー応答を分類する。
 * キーが不正なときは 400(INVALID_ARGUMENT)で来ることがあるので、`API_KEY_INVALID` を見て認証扱いにする。
 */
export function classifyGeminiError(
	status: number,
	body: string,
	label: string,
	secrets: readonly (string | undefined)[] = []
): AiHttpError {
	const detail = summarizeServerMessage(body, secrets);
	const tail = detail ? `(${detail})` : '';
	const markers = errorMarkers(body);

	if (status === 400 && (/API_KEY_/.test(markers) || /API key (not valid|expired)/i.test(body)))
		return new AiHttpError(
			'auth',
			`${label}の認証に失敗しました(400 API_KEY_INVALID)。API キーが正しいか、期限切れでないかを確認してください。${tail}`,
			status
		);
	if (status === 400)
		return new AiHttpError(
			'bad-request',
			`${label}がリクエストを受け付けませんでした(400 ${/FAILED_PRECONDITION/.test(markers) ? 'FAILED_PRECONDITION' : 'INVALID_ARGUMENT'})。モデル名・最大トークン数・入力の内容を確認してください。${tail}`,
			status
		);
	if (status === 404)
		return new AiHttpError(
			'not-found',
			`${label}のモデルが見つかりません(404)。モデル名と Base URL を確認してください。使えるモデルは「一覧を取得」で確かめられます。${tail}`,
			status
		);
	if (status === 429)
		return new AiHttpError(
			'rate-limit',
			`${label}の利用上限に達しました(429 RESOURCE_EXHAUSTED)。しばらく待ってから送り直してください。無料枠や課金の設定も確認してください。${tail}`,
			status
		);
	// 401/403(認証)・5xx(障害・過負荷)などは共通の分類
	return classifyHttpError(status, body, label, secrets);
}

/** ストリームの途中で届いた `error` をエラーにする */
function streamError(
	error: unknown,
	secrets: readonly (string | undefined)[],
	label: string
): AiHttpError {
	const rec = asRecord(error);
	const code = typeof rec?.code === 'number' ? rec.code : 500;
	return classifyGeminiError(code, JSON.stringify({ error: rec ?? {} }), label, secrets);
}

/** `finishReason` のうち、エラーとして扱うものの説明(STOP など正常終了は含めない) */
const FINISH_REASON_MESSAGES: Record<string, string> = {
	MAX_TOKENS:
		'応答が最大トークン数に達して途中で終わりました。設定の「最大トークン数」を増やしてください。',
	SAFETY: '安全性フィルターにより応答が止められました。質問の言い回しを変えて試してください。',
	RECITATION: '既存の文章と重なる可能性があるとして、応答が止められました。',
	LANGUAGE: 'モデルが対応していない言語が含まれるため、応答が止められました。',
	BLOCKLIST: '禁止されている語句が含まれるため、応答が止められました。',
	PROHIBITED_CONTENT: '禁止されている内容に当たる可能性があるため、応答が止められました。',
	SPII: '個人を特定できる機微な情報が含まれる可能性があるため、応答が止められました。',
	IMAGE_SAFETY: '安全性フィルターにより応答が止められました。',
	MALFORMED_FUNCTION_CALL:
		'モデルが正しくないツール呼び出しを生成したため、応答が止められました。もう一度送るか、別のモデルを試してください。',
	UNEXPECTED_TOOL_CALL: 'モデルが想定外のツール呼び出しを生成したため、応答が止められました。',
	OTHER: 'モデルが応答を途中で止めました(理由は不明です)。'
};

const NORMAL_FINISH = new Set(['STOP', 'FINISH_REASON_UNSPECIFIED']);

function finishReasonError(reason: string | undefined, label: string): AiHttpError | null {
	if (!reason || NORMAL_FINISH.has(reason)) return null;
	const text = FINISH_REASON_MESSAGES[reason] ?? `応答が途中で止まりました(${reason})。`;
	return new AiHttpError('invalid-response', `${label}: ${text}`);
}

const BLOCK_REASONS: Record<string, string> = {
	SAFETY: '安全性フィルターにより',
	BLOCKLIST: '禁止されている語句が含まれるため',
	PROHIBITED_CONTENT: '禁止されている内容に当たる可能性があるため',
	IMAGE_SAFETY: '画像の安全性フィルターにより',
	OTHER: '理由は不明ですが'
};

function blockReasonError(reason: string, label: string): AiHttpError {
	const why = BLOCK_REASONS[reason] ?? `(${reason})のため`;
	return new AiHttpError(
		'invalid-response',
		`${label}: 入力が${why}拒否されました。質問の言い回しを変えて試してください。`
	);
}

export function createGeminiAdapter(cfg: GeminiAdapterConfig): AgentAdapter<GeminiContent> {
	const timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;
	const secrets = [cfg.apiKey];
	let callCounter = 0;
	/** こちらで補った ID(API が返した ID は functionResponse にも付けて返す) */
	const localIds = new Set<string>();

	return {
		// システムプロンプトは履歴に入れず、リクエストごとに systemInstruction で送る
		start() {
			return [];
		},

		userMessage(text) {
			return { role: 'user', parts: [{ text }] };
		},

		assistantMessage(step) {
			if (Array.isArray(step.raw)) return { role: 'model', parts: step.raw as Json[] };
			const parts: Json[] = [];
			if (step.text) parts.push({ text: step.text });
			for (const c of step.toolCalls) parts.push({ functionCall: { name: c.name, args: c.args } });
			return { role: 'model', parts };
		},

		toolMessages(outcomes: ToolOutcome[]) {
			if (!outcomes.length) return [];
			return [
				{
					role: 'user',
					parts: outcomes.map((o) => ({
						functionResponse: {
							...(localIds.has(o.call.id) ? {} : { id: o.call.id }),
							name: o.call.name,
							response: { result: o.text }
						}
					}))
				}
			];
		},

		async step(history, tools, signal, onText) {
			const timeout = linkTimeout(signal, timeoutMs);
			try {
				const body: Json = {
					systemInstruction: { parts: [{ text: cfg.system }] },
					contents: history
				};
				if (tools.length) {
					body.tools = [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }];
					body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
				}
				if (cfg.maxOutputTokens) body.generationConfig = { maxOutputTokens: cfg.maxOutputTokens };

				const url = `${joinUrl(cfg.baseUrl, `v1beta/${modelPath(cfg.model)}:streamGenerateContent`)}?alt=sse`;
				const res = await cfg.fetch(url, {
					method: 'POST',
					headers: { ...geminiHeaders(cfg.apiKey), Accept: 'text/event-stream' },
					body: JSON.stringify(body),
					signal: timeout.signal
				});
				if (!res.ok) {
					const text = (await res.text().catch(() => '')).slice(0, ERROR_BODY_LIMIT);
					throw classifyGeminiError(res.status, text, cfg.label, secrets);
				}
				if (!res.body)
					throw new AiHttpError('invalid-response', `${cfg.label}の応答を読み取れませんでした。`);

				const schemas = new Map(tools.map((t) => [t.name, t.inputSchema]));
				const parts: Json[] = [];
				const toolCalls: ToolCall[] = [];
				let text = '';
				let finishReason: string | undefined;
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
					if (json.error) throw streamError(json.error, secrets, cfg.label);
					const blocked = asRecord(json.promptFeedback)?.blockReason;
					if (typeof blocked === 'string' && blocked) throw blockReasonError(blocked, cfg.label);

					const candidate = asRecord((json.candidates as unknown[] | undefined)?.[0]);
					if (!candidate) continue;
					const incoming = asRecord(candidate.content)?.parts;
					if (Array.isArray(incoming)) {
						for (const raw of incoming) {
							const part = asRecord(raw);
							if (!part) continue;
							// 未知の項目(thoughtSignature など)も欠かさず、受け取ったまま履歴に残す
							parts.push(part);
							if (part.thought === true) continue;
							if (typeof part.text === 'string' && part.text) {
								text += part.text;
								onText(part.text);
							}
							const fc = asRecord(part.functionCall);
							if (fc && typeof fc.name === 'string' && fc.name) {
								const given = typeof fc.id === 'string' && fc.id ? fc.id : '';
								const id = given || `call_${++callCounter}`;
								if (!given) localIds.add(id);
								const args = asRecord(fc.args) ?? {};
								const schema = schemas.get(fc.name);
								toolCalls.push({
									id,
									name: fc.name,
									args: schema ? restoreGeminiArgs(args, schema) : args
								});
							}
						}
					}
					if (typeof candidate.finishReason === 'string') finishReason = candidate.finishReason;
				}

				const reasonError = finishReasonError(finishReason, cfg.label);
				if (reasonError) throw reasonError;
				// 空の model メッセージは次のリクエストで拒否されるため、履歴に入れずに失敗にする
				if (!parts.length)
					throw new AiHttpError('invalid-response', `${cfg.label}から空の応答が返りました。`);
				const result: StepResult = { text, toolCalls, raw: parts };
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
