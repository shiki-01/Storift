/**
 * Monolog. 連携の設定。この端末だけ(localStorage)に保存し、同期・バックアップ・エクスポートには含めない。
 * 読み書きは失敗しても動作を止めない。
 *
 * 無操作で終了するまでの時間(以前の idleMinutes)は、本体の執筆セッションの設定へ移した
 * (`$lib/extensions/sessionSettings.svelte`。保存済みの値はそちらが引き継ぐ)。
 */
import { DEFAULT_SETTINGS, type MonologSettings } from './session';

export const SETTINGS_STORAGE_KEY = 'storift:monolog:settings';
const MAX_TAG_LENGTH = 50;

/** 保存された値を検証する。壊れた値・範囲外の値は既定値に戻す */
export function sanitizeSettings(input: unknown): MonologSettings {
	const j = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
	const tag = typeof j.tagName === 'string' ? j.tagName.trim().slice(0, MAX_TAG_LENGTH) : '';
	return {
		mode: j.mode === 'record' ? 'record' : 'timer',
		tagName: tag || DEFAULT_SETTINGS.tagName,
		sendProjectTitle: j.sendProjectTitle === true
	};
}

function load(): MonologSettings {
	try {
		const raw =
			typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_STORAGE_KEY);
		return sanitizeSettings(raw ? JSON.parse(raw) : null);
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

let current = $state<MonologSettings>(load());

export const monologSettings = {
	get value(): MonologSettings {
		return current;
	},
	update(patch: Partial<MonologSettings>): void {
		current = sanitizeSettings({ ...current, ...patch });
		try {
			localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
		} catch (error) {
			console.warn('Monolog. 連携の設定を保存できませんでした:', error);
		}
	}
};
