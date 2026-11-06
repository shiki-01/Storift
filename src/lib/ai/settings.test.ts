import { describe, expect, it } from 'vitest';
import {
	CHAT_KEY,
	DEFAULT_AI_SETTINGS,
	loadSettings,
	migrateSettings,
	migrateStorageKeys,
	PANEL_KEY,
	SETTINGS_KEY,
	type StorageLike
} from './settings';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
	data: Map<string, string>;
} {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v)
	};
}

describe('migrateSettings', () => {
	it('旧形式(Claude Code)のフラットな項目をプロバイダ別へ移す', () => {
		const migrated = migrateSettings({
			provider: 'claude',
			ollamaUrl: 'http://x:1',
			ollamaModel: 'qwen',
			model: 'opus',
			claudePath: '/bin/claude',
			allowWeb: true,
			editMode: 'confirm'
		});
		expect(migrated).toEqual({
			provider: 'claude-code',
			editMode: 'confirm',
			claudeCode: { model: 'opus', claudePath: '/bin/claude', allowWeb: true },
			ollama: { url: 'http://x:1', model: 'qwen' },
			openaiCompatible: DEFAULT_AI_SETTINGS.openaiCompatible,
			anthropic: DEFAULT_AI_SETTINGS.anthropic,
			gemini: DEFAULT_AI_SETTINGS.gemini
		});
	});

	it('旧形式の Ollama の選択を保つ', () => {
		const migrated = migrateSettings({
			provider: 'ollama',
			ollamaModel: 'llama3',
			editMode: 'auto'
		});
		expect(migrated.provider).toBe('ollama');
		expect(migrated.ollama.model).toBe('llama3');
		expect(migrated.claudeCode).toEqual(DEFAULT_AI_SETTINGS.claudeCode);
		expect(migrated.editMode).toBe('auto');
	});

	it('新形式はそのまま読み、足りない項目は既定値で補う', () => {
		const migrated = migrateSettings({
			provider: 'openai-compatible',
			editMode: 'suggest',
			openaiCompatible: { baseUrl: 'https://openrouter.ai/api/v1', presetId: 'openrouter' }
		});
		expect(migrated.provider).toBe('openai-compatible');
		expect(migrated.openaiCompatible).toEqual({
			baseUrl: 'https://openrouter.ai/api/v1',
			model: '',
			presetId: 'openrouter'
		});
		expect(migrated.claudeCode).toEqual(DEFAULT_AI_SETTINGS.claudeCode);
	});

	it('Anthropic / Gemini の設定を読み、足りない項目は既定値で補う', () => {
		const migrated = migrateSettings({
			provider: 'gemini',
			anthropic: { model: 'claude-sonnet-5-5', maxTokens: 4096 },
			gemini: {
				baseUrl: 'https://proxy.example.com',
				model: 'gemini-2.5-pro',
				maxOutputTokens: 2048
			}
		});
		expect(migrated.provider).toBe('gemini');
		expect(migrated.anthropic).toEqual({
			baseUrl: 'https://api.anthropic.com',
			model: 'claude-sonnet-5-5',
			maxTokens: 4096
		});
		expect(migrated.gemini).toEqual({
			baseUrl: 'https://proxy.example.com',
			model: 'gemini-2.5-pro',
			maxOutputTokens: 2048
		});
	});

	it('最大トークン数が不正なら、Anthropic は既定値に、Gemini は未設定に戻す', () => {
		for (const bad of [0, -5, 1.5, '100', null, NaN]) {
			const migrated = migrateSettings({
				anthropic: { maxTokens: bad },
				gemini: { maxOutputTokens: bad }
			});
			expect(migrated.anthropic.maxTokens).toBe(8192);
			expect(migrated.gemini).not.toHaveProperty('maxOutputTokens');
		}
	});

	it('Anthropic / Gemini の設定が無い保存データ(以前の版)でも、既定値で補う', () => {
		const migrated = migrateSettings({
			provider: 'openai-compatible',
			claudeCode: {},
			openaiCompatible: { model: 'm' }
		});
		expect(migrated.anthropic).toEqual(DEFAULT_AI_SETTINGS.anthropic);
		expect(migrated.gemini).toEqual(DEFAULT_AI_SETTINGS.gemini);
		expect(migrated.anthropic).not.toBe(DEFAULT_AI_SETTINGS.anthropic);
	});

	it('設定は保存して読み直しても変わらず、API キーを含まない', () => {
		const settings = migrateSettings({
			anthropic: { model: 'a', maxTokens: 100 },
			gemini: { model: 'g', maxOutputTokens: 50 }
		});
		const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify(settings) });
		expect(loadSettings(storage)).toEqual(settings);
		expect(JSON.stringify(settings)).not.toMatch(/apiKey|api-key|secret/i);
	});

	it('不正な値は既定値に戻す', () => {
		expect(migrateSettings(null)).toEqual(DEFAULT_AI_SETTINGS);
		expect(migrateSettings('x')).toEqual(DEFAULT_AI_SETTINGS);
		const migrated = migrateSettings({ editMode: 'nope', provider: 3, model: 5, allowWeb: 'yes' });
		expect(migrated).toEqual(DEFAULT_AI_SETTINGS);
	});

	it('後から追加されるプロバイダの ID は文字列のまま保つ', () => {
		expect(migrateSettings({ provider: 'anthropic-api', claudeCode: {} }).provider).toBe(
			'anthropic-api'
		);
	});

	it('既定値を共有しない(書き換えが既定値に漏れない)', () => {
		const a = migrateSettings(null);
		a.claudeCode.model = 'changed';
		expect(DEFAULT_AI_SETTINGS.claudeCode.model).toBe('');
		expect(migrateSettings(null).claudeCode.model).toBe('');
	});
});

describe('migrateStorageKeys', () => {
	it('旧キーの内容を新キーへコピーし、旧キーは残す', () => {
		const storage = memoryStorage({
			'storift:claude-settings': '{"a":1}',
			'storift:claude-panel': '{"open":true,"width":500}',
			'storift:claude-chats': '{}'
		});
		migrateStorageKeys(storage);
		expect(storage.data.get(SETTINGS_KEY)).toBe('{"a":1}');
		expect(storage.data.get(PANEL_KEY)).toBe('{"open":true,"width":500}');
		expect(storage.data.get(CHAT_KEY)).toBe('{}');
		expect(storage.data.get('storift:claude-settings')).toBe('{"a":1}');
	});

	it('新キーが既にあれば上書きしない', () => {
		const storage = memoryStorage({
			'storift:claude-settings': 'old',
			[SETTINGS_KEY]: 'new'
		});
		migrateStorageKeys(storage);
		expect(storage.data.get(SETTINGS_KEY)).toBe('new');
	});

	it('旧キーも無ければ何も作らない', () => {
		const storage = memoryStorage();
		migrateStorageKeys(storage);
		expect(storage.data.size).toBe(0);
	});

	it('保存に失敗しても例外を出さない', () => {
		const storage: StorageLike = {
			getItem: (k) => (k === 'storift:claude-settings' ? 'x' : null),
			setItem: () => {
				throw new Error('quota');
			}
		};
		expect(() => migrateStorageKeys(storage)).not.toThrow();
	});
});

describe('loadSettings', () => {
	it('旧キーに保存された旧形式の設定を、新形式で読む', () => {
		const storage = memoryStorage({
			'storift:claude-settings': JSON.stringify({ provider: 'ollama', ollamaModel: 'm' })
		});
		const settings = loadSettings(storage);
		expect(settings.provider).toBe('ollama');
		expect(settings.ollama.model).toBe('m');
		expect(storage.data.has(SETTINGS_KEY)).toBe(true);
	});

	it('壊れた JSON でも既定値で起動できる', () => {
		const storage = memoryStorage({ [SETTINGS_KEY]: '{broken' });
		expect(loadSettings(storage)).toEqual(DEFAULT_AI_SETTINGS);
	});
});
