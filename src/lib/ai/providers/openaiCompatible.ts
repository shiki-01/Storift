/**
 * OpenAI 互換 API(OpenAI・OpenRouter・LM Studio・vLLM・Groq・DeepSeek・Mistral など、
 * `/chat/completions` に対応するもの)。
 *
 * エージェントのループは TS で回し(http/agent.ts)、ツールは mcp.ts の callTool を直接呼ぶ。
 * API キーは OS のキーチェーン(secrets.ts)から読み、設定した Base URL にだけ送る。
 */
import { fetchToolDefinitions } from '$lib/desktop/ai';
import { linkTimeout, translateFetchError } from '../http/abort';
import { runAgent, SessionStore, type ToolResultLike, type ToolSpec } from '../http/agent';
import { AiHttpError, classifyHttpError, redact } from '../http/errors';
import { tauriFetch, type FetchLike } from '../http/fetch';
import { joinUrl, validateBaseUrl } from '../http/url';
import { buildSystemPrompt } from '../prompts';
import { getSecret } from '../secrets';
import type {
	AiProvider,
	AiRunRequest,
	AiSettings,
	AiStatus,
	ConnectionTestResult
} from '../types';
import { authHeaders, createOpenAiAdapter, type OpenAiMessage } from './openaiChat';
import { findPreset } from './openaiPresets';

export const PROVIDER_ID = 'openai-compatible';
const LABEL = 'OpenAI 互換 API';
const MODELS_TIMEOUT_MS = 15_000;

/** 外部への依存(テストで差し替える) */
export interface OpenAiProviderDeps {
	getFetch: () => Promise<FetchLike>;
	getKey: (presetId: string) => Promise<string | null>;
	loadTools: (mode: AiRunRequest['editMode']) => Promise<ToolSpec[]>;
	callTool: (name: string, args: Record<string, unknown>, runId: string) => Promise<ToolResultLike>;
	requestTimeoutMs?: number;
	modelsTimeoutMs?: number;
}

const defaultDeps: OpenAiProviderDeps = {
	getFetch: tauriFetch,
	getKey: (presetId) => getSecret(PROVIDER_ID, presetId),
	loadTools: (mode) => fetchToolDefinitions(mode, false),
	// mcp.ts はストアを読み込むので、使うときに読み込む(循環を避け、Web 版にも含めない)
	callTool: async (name, args, runId) =>
		(await import('$lib/desktop/mcp')).callTool(name, args, runId)
};

/** API キーの保管先の名前(プリセットごと) */
export const keyName = (settings: AiSettings): string => settings.openaiCompatible.presetId;

/** 接続の設定を確かめる。問題があれば日本語の理由を返す */
function checkConfig(
	settings: AiSettings,
	key: string | null
): { ok: true; baseUrl: string } | { ok: false; error: string; auth?: boolean } {
	const s = settings.openaiCompatible;
	const url = validateBaseUrl(s.baseUrl);
	if (!url.ok) return { ok: false, error: url.error };
	const preset = findPreset(s.presetId);
	if (preset.keyRequired && !key)
		return {
			ok: false,
			error: `${preset.label}の API キーが設定されていません。設定の「AI」で入力してください。`,
			auth: true
		};
	return { ok: true, baseUrl: url.url };
}

export function createOpenAiCompatibleProvider(
	overrides: Partial<OpenAiProviderDeps> = {}
): AiProvider {
	const deps: OpenAiProviderDeps = { ...defaultDeps, ...overrides };
	const sessions = new SessionStore<OpenAiMessage>();

	async function fetchModels(
		baseUrl: string,
		key: string | null,
		signal?: AbortSignal
	): Promise<string[]> {
		const ms = deps.modelsTimeoutMs ?? MODELS_TIMEOUT_MS;
		const parent = signal ?? new AbortController().signal;
		const timeout = linkTimeout(parent, ms);
		const secrets = [key ?? undefined];
		try {
			const fetch = await deps.getFetch();
			const res = await fetch(joinUrl(baseUrl, 'models'), {
				method: 'GET',
				headers: { Accept: 'application/json', ...authHeaders(key ?? undefined) },
				signal: timeout.signal
			});
			if (!res.ok)
				throw classifyHttpError(
					res.status,
					(await res.text().catch(() => '')).slice(0, 4096),
					LABEL,
					secrets
				);
			let json: unknown;
			try {
				json = await res.json();
			} catch {
				throw new AiHttpError(
					'invalid-response',
					`${LABEL}の応答を読み取れませんでした。Base URL が /models に対応しているか確認してください。`
				);
			}
			const list = Array.isArray(json)
				? json
				: Array.isArray((json as { data?: unknown })?.data)
					? (json as { data: unknown[] }).data
					: null;
			if (!list)
				throw new AiHttpError(
					'invalid-response',
					`${LABEL}のモデル一覧の形式が想定と異なります。Base URL を確認してください。`
				);
			const ids = list
				.map((m) => (typeof m === 'string' ? m : (m as { id?: unknown })?.id))
				.filter((id): id is string => typeof id === 'string' && !!id);
			return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
		} catch (error) {
			throw translateFetchError(error, parent, timeout, LABEL, ms, (s) => redact(s, secrets));
		} finally {
			timeout.dispose();
		}
	}

	return {
		id: PROVIDER_ID,
		label: 'OpenAI 互換 API',
		description:
			'OpenAI・OpenRouter・LM Studio・Groq・DeepSeek・Mistral など、/chat/completions に対応する API を使います。',
		requires: 'API キー(ローカルのサーバーでは不要)と、ツール呼び出しに対応したモデル',
		destination: '設定した Base URL のサービス',
		settingsKey: 'openaiCompatible',
		settingsSchema: [{ key: 'baseUrl', label: 'Base URL', type: 'url' }],
		capabilities: { webSearch: false, resume: true, tools: true },
		sessionPrefix: 'openai-',

		async run(request, emit, signal) {
			const fail = (stderr: string, authError = false) => ({
				requestId: request.runId,
				code: 1,
				cancelled: false,
				stderr,
				...(authError ? { authError } : {})
			});
			const s = request.settings.openaiCompatible;
			const model = s.model.trim();
			if (!model) return fail('モデルが選ばれていません。設定でモデルを選んでください。');
			let key: string | null;
			try {
				key = await deps.getKey(keyName(request.settings));
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
				const adapter = createOpenAiAdapter({
					baseUrl: config.baseUrl,
					model,
					apiKey: key ?? undefined,
					fetch,
					label: LABEL,
					timeoutMs: deps.requestTimeoutMs
				});
				return await runAgent({
					runId: request.runId,
					prompt: request.prompt,
					model,
					sessionId: request.sessionId,
					sessionPrefix: 'openai-',
					system: buildSystemPrompt(request.appendSystemPrompt),
					adapter,
					sessions,
					tools,
					callTool: deps.callTool,
					emit,
					signal,
					secrets: [key ?? undefined]
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
				key = await deps.getKey(keyName(settings));
			} catch (error) {
				return { found: false, error: error instanceof Error ? error.message : String(error) };
			}
			const config = checkConfig(settings, key);
			if (!config.ok) return { found: false, error: config.error };
			if (!settings.openaiCompatible.model.trim())
				return { found: false, error: 'モデルが選ばれていません。設定でモデルを選んでください。' };
			const preset = findPreset(settings.openaiCompatible.presetId);
			return { found: true, version: `${preset.label}・${new URL(config.baseUrl).host}` };
		},

		async listModels(settings) {
			const key = await deps.getKey(keyName(settings));
			const config = checkConfig(settings, key);
			if (!config.ok) throw new AiHttpError('config', config.error);
			return fetchModels(config.baseUrl, key);
		},

		async testConnection(settings): Promise<ConnectionTestResult> {
			try {
				const key = await deps.getKey(keyName(settings));
				const config = checkConfig(settings, key);
				if (!config.ok) return { ok: false, message: config.error };
				const models = await fetchModels(config.baseUrl, key);
				const model = settings.openaiCompatible.model.trim();
				let message = `接続できました(モデル ${models.length} 件)。`;
				if (model && models.length && !models.includes(model))
					message += `ただし、選択中のモデル「${model}」は一覧にありません。`;
				return { ok: true, message, models };
			} catch (error) {
				return { ok: false, message: error instanceof Error ? error.message : String(error) };
			}
		}
	};
}

export const openaiCompatibleProvider = createOpenAiCompatibleProvider();
