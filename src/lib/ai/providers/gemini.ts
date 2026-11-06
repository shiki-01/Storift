/**
 * Gemini API(Google AI の Generative Language API)。API キーで Gemini のモデルを直接呼ぶ。
 *
 * エージェントのループは TS で回し(http/agent.ts)、ツールは mcp.ts の callTool を直接呼ぶ。
 * API キーは OS のキーチェーン(secrets.ts)から読み、設定した Base URL にだけ送る。
 */
import { fetchToolDefinitions } from '$lib/desktop/ai';
import { linkTimeout, translateFetchError } from '../http/abort';
import { runAgent, SessionStore, type ToolResultLike, type ToolSpec } from '../http/agent';
import { AiHttpError, redact } from '../http/errors';
import { tauriFetch, type FetchLike } from '../http/fetch';
import { joinUrl, validateBaseUrl } from '../http/url';
import { buildSystemPrompt } from '../prompts';
import { DEFAULT_GEMINI_URL } from '../settings';
import { getSecret } from '../secrets';
import type {
	AiProvider,
	AiRunRequest,
	AiSettings,
	AiStatus,
	ConnectionTestResult
} from '../types';
import {
	classifyGeminiError,
	createGeminiAdapter,
	geminiHeaders,
	type GeminiContent
} from './geminiChat';

export const PROVIDER_ID = 'gemini';
/** キーチェーンでの API キーの名前(識別子は PROVIDER_ID) */
export const SECRET_NAME = 'api-key';
const LABEL = 'Gemini API';
const MODELS_TIMEOUT_MS = 15_000;
const MODELS_PAGE_SIZE = 100;
/** モデル一覧で辿るページ数の上限 */
const MODELS_MAX_PAGES = 3;
const URL_EXAMPLE = 'https://generativelanguage.googleapis.com';

/** モデル ID の例(入力欄の候補。既定値ではない。実際に使えるモデルは一覧で確かめる) */
export const GEMINI_MODEL_EXAMPLES: readonly string[] = ['gemini-2.5-pro', 'gemini-2.5-flash'];

/** 外部への依存(テストで差し替える) */
export interface GeminiProviderDeps {
	getFetch: () => Promise<FetchLike>;
	getKey: () => Promise<string | null>;
	loadTools: (mode: AiRunRequest['editMode']) => Promise<ToolSpec[]>;
	callTool: (name: string, args: Record<string, unknown>, runId: string) => Promise<ToolResultLike>;
	requestTimeoutMs?: number;
	modelsTimeoutMs?: number;
}

const defaultDeps: GeminiProviderDeps = {
	getFetch: tauriFetch,
	getKey: () => getSecret(PROVIDER_ID, SECRET_NAME),
	loadTools: (mode) => fetchToolDefinitions(mode, false),
	// mcp.ts はストアを読み込むので、使うときに読み込む(循環を避け、Web 版にも含めない)
	callTool: async (name, args, runId) =>
		(await import('$lib/desktop/mcp')).callTool(name, args, runId)
};

/** 接続の設定を確かめる。問題があれば日本語の理由を返す */
function checkConfig(
	settings: AiSettings,
	key: string | null
): { ok: true; baseUrl: string; key: string } | { ok: false; error: string; auth?: boolean } {
	const url = validateBaseUrl(settings.gemini.baseUrl, URL_EXAMPLE);
	if (!url.ok) return { ok: false, error: url.error };
	if (!key)
		return {
			ok: false,
			error: `${LABEL}のキーが設定されていません。設定の「AI」で入力してください。`,
			auth: true
		};
	return { ok: true, baseUrl: url.url, key };
}

export function createGeminiProvider(overrides: Partial<GeminiProviderDeps> = {}): AiProvider {
	const deps: GeminiProviderDeps = { ...defaultDeps, ...overrides };
	const sessions = new SessionStore<GeminiContent>();

	async function fetchModels(
		baseUrl: string,
		key: string,
		signal?: AbortSignal
	): Promise<string[]> {
		const ms = deps.modelsTimeoutMs ?? MODELS_TIMEOUT_MS;
		const parent = signal ?? new AbortController().signal;
		const timeout = linkTimeout(parent, ms);
		const secrets = [key];
		try {
			const fetch = await deps.getFetch();
			const names: string[] = [];
			let pageToken = '';
			for (let page = 0; page < MODELS_MAX_PAGES; page++) {
				const query = `pageSize=${MODELS_PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
				const res = await fetch(`${joinUrl(baseUrl, 'v1beta/models')}?${query}`, {
					method: 'GET',
					headers: geminiHeaders(key),
					signal: timeout.signal
				});
				if (!res.ok)
					throw classifyGeminiError(
						res.status,
						(await res.text().catch(() => '')).slice(0, 4096),
						LABEL,
						secrets
					);
				let json: { models?: unknown; nextPageToken?: unknown } | null;
				try {
					json = (await res.json()) as typeof json;
				} catch {
					throw new AiHttpError(
						'invalid-response',
						`${LABEL}の応答を読み取れませんでした。Base URL が /v1beta/models に対応しているか確認してください。`
					);
				}
				if (!json || !Array.isArray(json.models))
					throw new AiHttpError(
						'invalid-response',
						`${LABEL}のモデル一覧の形式が想定と異なります。Base URL を確認してください。`
					);
				for (const m of json.models) {
					const rec = m as { name?: unknown; supportedGenerationMethods?: unknown };
					const methods = Array.isArray(rec?.supportedGenerationMethods)
						? rec.supportedGenerationMethods
						: [];
					// 本文の生成に使えるモデルだけ(埋め込み専用などを除く)
					if (typeof rec?.name === 'string' && methods.includes('generateContent'))
						names.push(rec.name.replace(/^models\//, ''));
				}
				if (typeof json.nextPageToken !== 'string' || !json.nextPageToken) break;
				pageToken = json.nextPageToken;
			}
			return [...new Set(names)];
		} catch (error) {
			throw translateFetchError(error, parent, timeout, LABEL, ms, (s) => redact(s, secrets));
		} finally {
			timeout.dispose();
		}
	}

	return {
		id: PROVIDER_ID,
		label: 'Gemini',
		description: 'Google の API キーで Gemini のモデルを直接使います。',
		requires: 'Google AI Studio の API キーと、ツール呼び出しに対応したモデル',
		destination: 'generativelanguage.googleapis.com',
		currentDestination: (settings) => {
			const url = settings.gemini.baseUrl.trim().replace(/\/+$/, '');
			return url && url !== DEFAULT_GEMINI_URL ? url : 'generativelanguage.googleapis.com';
		},
		settingsKey: 'gemini',
		settingsSchema: [{ key: 'baseUrl', label: 'Base URL', type: 'url' }],
		capabilities: { webSearch: false, resume: true, tools: true },
		sessionPrefix: 'gemini-',

		async run(request, emit, signal) {
			const fail = (stderr: string, authError = false) => ({
				requestId: request.runId,
				code: 1,
				cancelled: false,
				stderr,
				...(authError ? { authError } : {})
			});
			const s = request.settings.gemini;
			const model = s.model.trim();
			if (!model) return fail('モデルが選ばれていません。設定でモデルを選んでください。');
			let key: string | null;
			try {
				key = await deps.getKey();
			} catch (error) {
				return fail(String(error instanceof Error ? error.message : error));
			}
			const config = checkConfig(request.settings, key);
			if (!config.ok) return fail(config.error, config.auth);

			try {
				const [fetch, tools] = await Promise.all([
					deps.getFetch(),
					deps.loadTools(request.editMode)
				]);
				const system = buildSystemPrompt(request.appendSystemPrompt);
				const adapter = createGeminiAdapter({
					baseUrl: config.baseUrl,
					model,
					maxOutputTokens: s.maxOutputTokens,
					system,
					apiKey: config.key,
					fetch,
					label: LABEL,
					timeoutMs: deps.requestTimeoutMs
				});
				return await runAgent({
					runId: request.runId,
					prompt: request.prompt,
					model,
					sessionId: request.sessionId,
					sessionPrefix: 'gemini-',
					system,
					adapter,
					sessions,
					tools,
					callTool: deps.callTool,
					emit,
					signal,
					secrets: [config.key]
				});
			} catch (error) {
				if (signal.aborted)
					return { requestId: request.runId, code: null, cancelled: true, stderr: '' };
				return fail(
					redact(error instanceof Error ? error.message : String(error), [key ?? undefined])
				);
			}
		},

		async status(settings): Promise<AiStatus> {
			let key: string | null = null;
			try {
				key = await deps.getKey();
			} catch (error) {
				return { found: false, error: error instanceof Error ? error.message : String(error) };
			}
			const config = checkConfig(settings, key);
			if (!config.ok) return { found: false, error: config.error };
			if (!settings.gemini.model.trim())
				return { found: false, error: 'モデルが選ばれていません。設定でモデルを選んでください。' };
			return { found: true, version: `${LABEL}・${new URL(config.baseUrl).host}` };
		},

		async listModels(settings) {
			const key = await deps.getKey();
			const config = checkConfig(settings, key);
			if (!config.ok) throw new AiHttpError('config', config.error);
			return fetchModels(config.baseUrl, config.key);
		},

		async testConnection(settings): Promise<ConnectionTestResult> {
			try {
				const key = await deps.getKey();
				const config = checkConfig(settings, key);
				if (!config.ok) return { ok: false, message: config.error };
				const models = await fetchModels(config.baseUrl, config.key);
				const model = settings.gemini.model.trim();
				let message = `接続できました(モデル ${models.length} 件)。`;
				if (!model) message += 'モデルが選ばれていません。';
				else if (models.length && !models.includes(model))
					message += `ただし、選択中のモデル「${model}」は一覧にありません。`;
				return { ok: true, message, models };
			} catch (error) {
				return { ok: false, message: error instanceof Error ? error.message : String(error) };
			}
		}
	};
}

export const geminiProvider = createGeminiProvider();
