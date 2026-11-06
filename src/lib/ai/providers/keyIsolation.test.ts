/**
 * プロバイダを切り替えても、他のプロバイダの API キーが送られないことの確認。
 * キーは常に「そのプロバイダの識別子」で保管先(secrets.ts)から取り、そのプロバイダの Base URL にだけ送る。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
const keychain = new Map<string, string>();
const state = { unsupported: false };

vi.mock('@tauri-apps/api/core', () => ({
	invoke: async (cmd: string, args: Record<string, unknown>) => {
		calls.push({ cmd, args });
		if (state.unsupported) throw 'unsupported';
		const id = `${args.provider}:${args.name}`;
		if (cmd === 'secret_get') return keychain.get(id) ?? null;
		if (cmd === 'secret_set') return void keychain.set(id, String(args.value));
		if (cmd === 'secret_delete') return void keychain.delete(id);
		throw new Error(`unexpected ${cmd}`);
	}
}));

const { resetSecretBackend, setSecret } = await import('../secrets');
const { DEFAULT_AI_SETTINGS } = await import('../settings');
const { anthropicMessage, anthropicText, geminiChunk, mockFetch, sse, chunk, sseResponse } =
	await import('../test-helpers');
const {
	createAnthropicProvider,
	PROVIDER_ID: ANTHROPIC,
	SECRET_NAME: ANTHROPIC_NAME
} = await import('./anthropic');
const {
	createGeminiProvider,
	PROVIDER_ID: GEMINI,
	SECRET_NAME: GEMINI_NAME
} = await import('./gemini');
const { createOpenAiCompatibleProvider } = await import('./openaiCompatible');

const KEYS = {
	anthropic: 'sk-ant-AAAAAAAAAAAAAAAAAAAAAAAA',
	gemini: 'AIzaBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
	openai: 'sk-openai-CCCCCCCCCCCCCCCCCCCCCCCC'
};

const URLS = {
	anthropic: 'https://anthropic.example.com',
	gemini: 'https://gemini.example.com',
	openai: 'https://openai.example.com/v1'
};

const settings = () => ({
	...structuredClone(DEFAULT_AI_SETTINGS),
	anthropic: { baseUrl: URLS.anthropic, model: 'claude-x', maxTokens: 100 },
	gemini: { baseUrl: URLS.gemini, model: 'gemini-x' },
	openaiCompatible: { baseUrl: URLS.openai, model: 'gpt-x', presetId: 'openai' }
});

const serialize = (r: { url: string; init: RequestInit }) =>
	JSON.stringify({ url: r.url, headers: r.init.headers, body: r.init.body });

beforeEach(async () => {
	calls.length = 0;
	keychain.clear();
	state.unsupported = false;
	localStorage.clear();
	resetSecretBackend();
	await setSecret(ANTHROPIC, ANTHROPIC_NAME, KEYS.anthropic);
	await setSecret(GEMINI, GEMINI_NAME, KEYS.gemini);
	await setSecret('openai-compatible', 'openai', KEYS.openai);
	calls.length = 0;
});

function providers() {
	const anthropic = mockFetch([
		sseResponse(anthropicMessage(anthropicText(0, 'a'))),
		new Response(JSON.stringify({ data: [{ id: 'm' }] }))
	]);
	const gemini = mockFetch([
		sseResponse([geminiChunk([{ text: 'g' }], 'STOP')]),
		new Response(JSON.stringify({ models: [] }))
	]);
	const openai = mockFetch([
		sseResponse([chunk({ content: 'o' }, 'stop'), sse('[DONE]')]),
		new Response(JSON.stringify({ data: [{ id: 'm' }] }))
	]);
	const common = {
		loadTools: async () => [],
		callTool: async () => ({ text: '', isError: false })
	};
	return {
		anthropic: createAnthropicProvider({ ...common, getFetch: async () => anthropic.fetch }),
		gemini: createGeminiProvider({ ...common, getFetch: async () => gemini.fetch }),
		openai: createOpenAiCompatibleProvider({ ...common, getFetch: async () => openai.fetch }),
		sent: { anthropic: anthropic.requests, gemini: gemini.requests, openai: openai.requests }
	};
}

const req = (provider: string, runId: string) => ({
	runId,
	prompt: 'q',
	editMode: 'suggest' as const,
	settings: { ...settings(), provider }
});

describe('プロバイダの切り替えとキー', () => {
	it('どのプロバイダを使っても、そのプロバイダのキーだけを、そのプロバイダの URL にだけ送る', async () => {
		const p = providers();
		const emit = () => {};
		const signal = new AbortController().signal;
		expect((await p.anthropic.run(req('anthropic', 'r1'), emit, signal)).code).toBe(0);
		expect((await p.gemini.run(req('gemini', 'r2'), emit, signal)).code).toBe(0);
		expect((await p.openai.run(req('openai-compatible', 'r3'), emit, signal)).code).toBe(0);
		// 切り替えて戻っても同じ
		await p.anthropic.listModels!(settings());
		await p.gemini.listModels!(settings());
		await p.openai.listModels!(settings());

		for (const name of ['anthropic', 'gemini', 'openai'] as const) {
			expect(p.sent[name].length).toBeGreaterThan(0);
			for (const r of p.sent[name]) {
				expect(r.url.startsWith(URLS[name]), `${name}: ${r.url}`).toBe(true);
				const text = serialize(r);
				expect(text).toContain(KEYS[name]);
				for (const other of Object.keys(KEYS) as (keyof typeof KEYS)[]) {
					if (other !== name)
						expect(text, `${name} の通信に ${other} のキー`).not.toContain(KEYS[other]);
				}
			}
		}
	});

	it('キーは「そのプロバイダの識別子」で取得する(他の識別子を読まない)', async () => {
		const p = providers();
		await p.anthropic.run(req('anthropic', 'r1'), () => {}, new AbortController().signal);
		let reads = calls.filter((c) => c.cmd === 'secret_get' && c.args.provider !== 'probe');
		expect(reads.map((c) => `${c.args.provider}:${c.args.name}`)).toEqual([
			`${ANTHROPIC}:${ANTHROPIC_NAME}`
		]);
		calls.length = 0;
		await p.gemini.run(req('gemini', 'r2'), () => {}, new AbortController().signal);
		reads = calls.filter((c) => c.cmd === 'secret_get' && c.args.provider !== 'probe');
		expect(reads.map((c) => `${c.args.provider}:${c.args.name}`)).toEqual([
			`${GEMINI}:${GEMINI_NAME}`
		]);
	});

	it('自分のキーが無いとき、他のプロバイダのキーで代用せず、通信しない', async () => {
		keychain.delete(`${ANTHROPIC}:${ANTHROPIC_NAME}`);
		const p = providers();
		const exit = await p.anthropic.run(
			req('anthropic', 'r1'),
			() => {},
			new AbortController().signal
		);
		expect(exit).toMatchObject({ code: 1, authError: true });
		expect(p.sent.anthropic).toHaveLength(0);
		// Gemini のキーは残っているので Gemini は動く
		expect(
			(await p.gemini.run(req('gemini', 'r2'), () => {}, new AbortController().signal)).code
		).toBe(0);
	});

	it('キーチェーンを使えない環境(localStorage)でも、識別子ごとに分かれて送られる', async () => {
		state.unsupported = true;
		resetSecretBackend();
		await setSecret(ANTHROPIC, ANTHROPIC_NAME, KEYS.anthropic);
		await setSecret(GEMINI, GEMINI_NAME, KEYS.gemini);
		const p = providers();
		const signal = new AbortController().signal;
		expect((await p.anthropic.run(req('anthropic', 'r1'), () => {}, signal)).code).toBe(0);
		expect((await p.gemini.run(req('gemini', 'r2'), () => {}, signal)).code).toBe(0);
		expect(serialize(p.sent.anthropic[0])).toContain(KEYS.anthropic);
		expect(serialize(p.sent.anthropic[0])).not.toContain(KEYS.gemini);
		expect(serialize(p.sent.gemini[0])).toContain(KEYS.gemini);
		expect(serialize(p.sent.gemini[0])).not.toContain(KEYS.anthropic);
	});

	it('Base URL を変えると、新しい URL にだけ送る(古い URL には送らない)', async () => {
		const p = providers();
		const s = settings();
		s.anthropic.baseUrl = 'https://proxy.example.net';
		await p.anthropic.run(
			{ ...req('anthropic', 'r1'), settings: { ...s, provider: 'anthropic' } },
			() => {},
			new AbortController().signal
		);
		expect(p.sent.anthropic[0].url.startsWith('https://proxy.example.net/')).toBe(true);
		expect(p.sent.anthropic.some((r) => r.url.startsWith(URLS.anthropic))).toBe(false);
	});
});
