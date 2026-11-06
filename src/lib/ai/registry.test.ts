import { describe, expect, it } from 'vitest';
import { FALLBACK_PROVIDER_ID, ProviderRegistry } from './registry';
import { claudeCodeProvider } from './providers/claudeCode';
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
	const all = [claudeCodeProvider, ollamaProvider, openaiCompatibleProvider];

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
		expect(prefixes).toEqual(['ollama-', 'openai-']);
	});

	it('設定の置き場がそれぞれ別', () => {
		expect(all.map((p) => p.settingsKey)).toEqual(['claudeCode', 'ollama', 'openaiCompatible']);
	});

	it('OpenAI 互換だけがモデル一覧と接続テストを持つ', () => {
		expect(typeof openaiCompatibleProvider.listModels).toBe('function');
		expect(typeof openaiCompatibleProvider.testConnection).toBe('function');
		expect(claudeCodeProvider.listModels).toBeUndefined();
	});
});
