/**
 * Discord Rich Presence の設定。この端末だけ(localStorage)に保存し、同期・バックアップ・エクスポートには含めない。
 * 読み書きは失敗しても動作を止めない。
 */
import type { PresenceStatus } from './controller';
import {
	DEFAULT_DETAILS_TEMPLATE,
	DEFAULT_STATE_TEMPLATE,
	type DiscordSettings,
	type HiddenBehavior
} from './presence';
import { MAX_TEMPLATE_LENGTH } from './template';

export const SETTINGS_STORAGE_KEY = 'storift:discord:settings';
const MAX_ID_LENGTH = 25;
export const HIDDEN_BEHAVIORS: readonly HiddenBehavior[] = ['keep', 'clear', 'away'];

export const DEFAULT_SETTINGS: DiscordSettings = {
	showProjectTitle: false,
	showTotalChars: false,
	detailsTemplate: DEFAULT_DETAILS_TEMPLATE,
	stateTemplate: DEFAULT_STATE_TEMPLATE,
	whenHidden: 'keep',
	applicationId: ''
};

function template(value: unknown, fallback: string): string {
	// 空にすると、その行を出さない設定として扱う(未設定の既定値とは区別する)
	return typeof value === 'string' ? value.slice(0, MAX_TEMPLATE_LENGTH) : fallback;
}

/** 保存された値を検証する。壊れた値は既定値に戻す(Application ID は数字だけを残す) */
export function sanitizeSettings(input: unknown): DiscordSettings {
	const j = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
	const id = typeof j.applicationId === 'string' ? j.applicationId.replace(/\D/g, '') : '';
	return {
		showProjectTitle: j.showProjectTitle === true,
		showTotalChars: j.showTotalChars === true,
		detailsTemplate: template(j.detailsTemplate, DEFAULT_DETAILS_TEMPLATE),
		stateTemplate: template(j.stateTemplate, DEFAULT_STATE_TEMPLATE),
		whenHidden: HIDDEN_BEHAVIORS.includes(j.whenHidden as HiddenBehavior)
			? (j.whenHidden as HiddenBehavior)
			: 'keep',
		applicationId: id.slice(0, MAX_ID_LENGTH)
	};
}

function load(): DiscordSettings {
	try {
		const raw =
			typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_STORAGE_KEY);
		return sanitizeSettings(raw ? JSON.parse(raw) : null);
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

let current = $state<DiscordSettings>(load());
let changed: (() => void) | null = null;

export const discordSettings = {
	get value(): DiscordSettings {
		return current;
	},
	update(patch: Partial<DiscordSettings>): void {
		current = sanitizeSettings({ ...current, ...patch });
		try {
			localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
		} catch (error) {
			console.warn('Discord Rich Presence の設定を保存できませんでした:', error);
		}
		changed?.();
	},
	/** 設定が変わったときに呼ぶ関数(拡張本体が、表示中の内容へ反映するために登録する) */
	set onChange(callback: (() => void) | null) {
		changed = callback;
	}
};

/** 設定画面に出す状態(表示中か) */
export const discordState = $state<{ status: PresenceStatus }>({ status: 'idle' });
