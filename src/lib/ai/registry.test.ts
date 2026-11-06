import { describe, expect, it } from 'vitest';
import { describeActiveModel, FALLBACK_PROVIDER_ID, ProviderRegistry } from './registry';
import { registerBuiltinProviders } from './providers';
import { registry } from './registry';
import { DEFAULT_AI_SETTINGS } from './settings';
import { claudeCodeProvider } from './providers/claudeCode';
import { anthropicProvider } from './providers/anthropic';
import { geminiProvider } from './providers/gemini';
import { ollamaProvider } from './providers/ollama';
import { openaiCompatibleProvider } from './providers/openaiCompatible';
import type { AiProvider } from './types';

function fake(id: string, sessionPrefix?: string): AiProvider {
	return {
		...claudeCodeProvider,
		id,
		label: id,
		sessionPrefix
	};
}

describe('ProviderRegistry', () => {
	it('登録した順に一覧でき、ID で引ける', () => {
		const r = new ProviderRegistry();
		r.register(fake('a'));
		r.register(fake('b'));
		expect(r.list().map((p) => p.id)).toEqual(['a', 'b']);
		expect(r.get('b')?.id).toBe('b');
		expect(r.has('c')).toBe(false);
	});

	it('同じ ID の二重登録はエラー', () => {
		const r = new ProviderRegistry();
		r.register(fake('a'));
		expect(() => r.register(fake('a'))).toThrow();
	});

	it('登録のない ID は既定のプロバイダに読み替える', () => {
		const r = new ProviderRegistry();
		r.register(fake(FALLBACK_PROVIDER_ID));
		expect(r.resolve('unknown').id).toBe(FALLBACK_PROVIDER_ID);
	});

	it('何も登録がなければ resolve はエラー', () => {
		expect(() => new ProviderRegistry().resolve('x')).toThrow();
	});

	it('セッション ID の接頭辞で発行元を見分け、当たらなければ既定', () => {
		const r = new ProviderRegistry();
		r.register(fake(FALLBACK_PROVIDER_ID));
		r.register(fake('ollama', 'ollama-'));
		r.register(fake('openai-compatible', 'openai-'));
		expect(r.ownerOfSession('ollama-abc')).toBe('ollama');
		expect(r.ownerOfSession('openai-abc')).toBe('openai-compatible');
		expect(r.ownerOfSession('3f2b9c7e-1111-2222-3333-444455556666')).toBe(FALLBACK_PROVIDER_ID);
	});
});

describe('組み込みのプロバイダ', () => {
	const all = [
		claudeCodeProvider,
		openaiCompatibleProvider,
		anthropicProvider,
		geminiProvider,
		ollamaProvider
	];

	it('ID が重複せず、説明・必要なもの・送信先を持つ', () => {
		expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
		for (const p of all) {
			expect(p.label).toBeTruthy();
			expect(p.description).toBeTruthy();
			expect(p.requires).toBeTruthy();
			expect(p.destination).toBeTruthy();
			expect(typeof p.run).toBe('function');
			expect(typeof p.status).toBe('function');
		}
	});

	it('能力フラグ: Web 検索は Claude Code だけ。ツールは全て使える', () => {
		expect(claudeCodeProvider.capabilities).toEqual({ webSearch: true, resume: true, tools: true });
		expect(ollamaProvider.capabilities.webSearch).toBe(false);
		expect(openaiCompatibleProvider.capabilities).toEqual({
			webSearch: false,
			resume: true,
			tools: true
		});
	});

	it('セッション接頭辞は互いに衝突しない', () => {
		const prefixes = all.map((p) => p.sessionPrefix).filter(Boolean);
		expect(prefixes).toEqual(['openai-', 'anthropic-', 'gemini-', 'ollama-']);
	});

	it('設定の置き場がそれぞれ別', () => {
		expect(all.map((p) => p.settingsKey)).toEqual([
			'claudeCode',
			'openaiCompatible',
			'anthropic',
			'gemini',
			'ollama'
		]);
	});

	it('API キーで使う 3 つ(OpenAI 互換・Anthropic・Gemini)がモデル一覧と接続テストを持つ', () => {
		for (const p of [openaiCompatibleProvider, anthropicProvider, geminiProvider]) {
			expect(typeof p.listModels, p.id).toBe('function');
			expect(typeof p.testConnection, p.id).toBe('function');
		}
		expect(claudeCodeProvider.listModels).toBeUndefined();
	});

	it('Anthropic / Gemini の能力フラグ: ツールとセッション継続は使え、Web 検索は使えない', () => {
		for (const p of [anthropicProvider, geminiProvider])
			expect(p.capabilities, p.id).toEqual({ webSearch: false, resume: true, tools: true });
	});

	it('送信先: 既定は api.anthropic.com / generativelanguage.googleapis.com。Base URL を変えたら設定中の URL', () => {
		expect(anthropicProvider.destination).toBe('api.anthropic.com');
		expect(geminiProvider.destination).toBe('generativelanguage.googleapis.com');
		const s = structuredClone(DEFAULT_AI_SETTINGS);
		expect(anthropicProvider.currentDestination!(s)).toBe('api.anthropic.com');
		expect(geminiProvider.currentDestination!(s)).toBe('generativelanguage.googleapis.com');
		s.anthropic.baseUrl = 'https://api.anthropic.com/';
		expect(anthropicProvider.currentDestination!(s)).toBe('api.anthropic.com');
		s.anthropic.baseUrl = 'https://proxy.example.com';
		s.gemini.baseUrl = 'http://localhost:8080';
		expect(anthropicProvider.currentDestination!(s)).toBe('https://proxy.example.com');
		expect(geminiProvider.currentDestination!(s)).toBe('http://localhost:8080');
	});
});

describe('組み込みのプロバイダの登録', () => {
	it('設定カードの並び順は Claude Code・OpenAI 互換・Anthropic API・Gemini・Ollama', () => {
		registerBuiltinProviders();
		expect(registry.list().map((p) => p.id)).toEqual([
			'claude-code',
			'openai-compatible',
			'anthropic',
			'gemini',
			'ollama'
		]);
		expect(registry.list().map((p) => p.label)).toEqual([
			'Claude Code',
			'OpenAI 互換 API',
			'Anthropic API',
			'Gemini',
			'Ollama'
		]);
	});

	it('パネルに出す「プロバイダ・モデル」の表示', () => {
		registerBuiltinProviders();
		const s = structuredClone(DEFAULT_AI_SETTINGS);
		expect(describeActiveModel(registry.resolve('claude-code'), s)).toBe('Claude Code');
		s.anthropic.model = 'claude-sonnet-5-5';
		s.gemini.model = ' gemini-2.5-pro ';
		expect(describeActiveModel(registry.resolve('anthropic'), s)).toBe(
			'Anthropic API・claude-sonnet-5-5'
		);
		expect(describeActiveModel(registry.resolve('gemini'), s)).toBe('Gemini・gemini-2.5-pro');
		s.ollama.model = 'qwen';
		expect(describeActiveModel(registry.resolve('ollama'), s)).toBe('Ollama・qwen');
	});
});
