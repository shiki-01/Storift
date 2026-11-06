/**
 * AI 連携の設定の既定値・読み込み・旧形式からの移行。
 *
 * 旧形式(Claude 専用だった頃)は `provider: 'claude' | 'ollama'` とフラットな項目だった。
 * 保存先の localStorage キーも `storift:claude-*` から `storift:ai-*` に変わったので、
 * 読み込み時に旧キーの内容を新キーへコピーする(旧キーは残す。データを失わないため)。
 */
import type { AiSettings, EditMode } from './types';

export const SETTINGS_KEY = 'storift:ai-settings';
export const PANEL_KEY = 'storift:ai-panel';
export const CHAT_KEY = 'storift:ai-chats';

/** 旧キーと新キーの対応 */
export const LEGACY_KEYS: Readonly<Record<string, string>> = {
	'storift:claude-settings': SETTINGS_KEY,
	'storift:claude-panel': PANEL_KEY,
	'storift:claude-chats': CHAT_KEY
};

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com';
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 8192;
export const DEFAULT_GEMINI_URL = 'https://generativelanguage.googleapis.com';

export const DEFAULT_AI_SETTINGS: AiSettings = {
	provider: 'claude-code',
	editMode: 'suggest',
	claudeCode: { model: '', claudePath: '', allowWeb: false },
	ollama: { url: '', model: '' },
	openaiCompatible: { baseUrl: 'https://api.openai.com/v1', model: '', presetId: 'openai' },
	anthropic: { baseUrl: DEFAULT_ANTHROPIC_URL, model: '', maxTokens: DEFAULT_ANTHROPIC_MAX_TOKENS },
	gemini: { baseUrl: DEFAULT_GEMINI_URL, model: '' }
};

const EDIT_MODES: readonly EditMode[] = ['suggest', 'confirm', 'auto'];

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

function strOr(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

/** 正の整数ならそれを、そうでなければ undefined */
function positiveInt(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function anthropicFrom(raw: unknown): AiSettings['anthropic'] {
	const d = DEFAULT_AI_SETTINGS.anthropic;
	const a = isRecord(raw) ? raw : {};
	return {
		baseUrl: strOr(a.baseUrl, d.baseUrl),
		model: strOr(a.model, d.model),
		maxTokens: positiveInt(a.maxTokens) ?? d.maxTokens
	};
}

function geminiFrom(raw: unknown): AiSettings['gemini'] {
	const d = DEFAULT_AI_SETTINGS.gemini;
	const g = isRecord(raw) ? raw : {};
	const maxOutputTokens = positiveInt(g.maxOutputTokens);
	return {
		baseUrl: strOr(g.baseUrl, d.baseUrl),
		model: strOr(g.model, d.model),
		...(maxOutputTokens ? { maxOutputTokens } : {})
	};
}

/** 旧形式の provider 名('claude')を今の ID にそろえる */
function normalizeProviderId(value: unknown): string {
	if (typeof value !== 'string' || !value) return DEFAULT_AI_SETTINGS.provider;
	return value === 'claude' ? 'claude-code' : value;
}

/**
 * 保存されていた設定(新旧どちらの形式でも、壊れていても)から、今の形式の設定を作る。
 * 足りない項目は既定値で補う。
 */
export function migrateSettings(raw: unknown): AiSettings {
	const d = DEFAULT_AI_SETTINGS;
	if (!isRecord(raw)) return structuredClone(d);

	const editMode = EDIT_MODES.includes(raw.editMode as EditMode)
		? (raw.editMode as EditMode)
		: d.editMode;
	const provider = normalizeProviderId(raw.provider);

	const isNew =
		isRecord(raw.claudeCode) ||
		isRecord(raw.ollama) ||
		isRecord(raw.openaiCompatible) ||
		isRecord(raw.anthropic) ||
		isRecord(raw.gemini);
	if (!isNew) {
		// 旧形式: フラットな項目を、プロバイダ別の入れ物へ移す
		return {
			provider,
			editMode,
			claudeCode: {
				model: strOr(raw.model, d.claudeCode.model),
				claudePath: strOr(raw.claudePath, d.claudeCode.claudePath),
				allowWeb: typeof raw.allowWeb === 'boolean' ? raw.allowWeb : d.claudeCode.allowWeb
			},
			ollama: {
				url: strOr(raw.ollamaUrl, d.ollama.url),
				model: strOr(raw.ollamaModel, d.ollama.model)
			},
			openaiCompatible: { ...d.openaiCompatible },
			anthropic: { ...d.anthropic },
			gemini: { ...d.gemini }
		};
	}

	const cc = isRecord(raw.claudeCode) ? raw.claudeCode : {};
	const ol = isRecord(raw.ollama) ? raw.ollama : {};
	const oa = isRecord(raw.openaiCompatible) ? raw.openaiCompatible : {};
	return {
		provider,
		editMode,
		claudeCode: {
			model: strOr(cc.model, d.claudeCode.model),
			claudePath: strOr(cc.claudePath, d.claudeCode.claudePath),
			allowWeb: typeof cc.allowWeb === 'boolean' ? cc.allowWeb : d.claudeCode.allowWeb
		},
		ollama: { url: strOr(ol.url, d.ollama.url), model: strOr(ol.model, d.ollama.model) },
		openaiCompatible: {
			baseUrl: strOr(oa.baseUrl, d.openaiCompatible.baseUrl),
			model: strOr(oa.model, d.openaiCompatible.model),
			presetId: strOr(oa.presetId, d.openaiCompatible.presetId)
		},
		anthropic: anthropicFrom(raw.anthropic),
		gemini: geminiFrom(raw.gemini)
	};
}

/** localStorage の最小限の形(テストで差し替えやすいように) */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/**
 * 旧キーの内容を、新キーがまだ無ければ新キーへコピーする。旧キーは消さない。
 * 保存に失敗しても動作には影響しない。
 */
export function migrateStorageKeys(storage: StorageLike): void {
	for (const [legacy, current] of Object.entries(LEGACY_KEYS)) {
		try {
			if (storage.getItem(current) !== null) continue;
			const value = storage.getItem(legacy);
			if (value !== null) storage.setItem(current, value);
		} catch {
			// 読み書きできない環境では何もしない
		}
	}
}

/** 保存された設定を読む(旧キーからの移行と、形式の移行を含む) */
export function loadSettings(storage: StorageLike): AiSettings {
	migrateStorageKeys(storage);
	try {
		const raw = storage.getItem(SETTINGS_KEY);
		return migrateSettings(raw ? JSON.parse(raw) : null);
	} catch {
		return structuredClone(DEFAULT_AI_SETTINGS);
	}
}
