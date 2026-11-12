/**
 * 執筆セッションの設定(本体)。この端末だけ(localStorage)に保存し、同期・バックアップ・エクスポートには含めない
 * (拡張の有効/無効と同じ扱い)。読み書きは失敗しても動作を止めない。
 *
 * 無操作時間は、以前は Monolog. 連携の設定(storift:monolog:settings の idleMinutes)にあった。
 * 本体の設定がまだ無ければ、その値を引き継ぐ。
 */
import { DEFAULT_IDLE_MINUTES, IDLE_MINUTES_OPTIONS } from './session';

export const SESSION_SETTINGS_KEY = 'storift:extensions:session';
/** 引き継ぎ元(Monolog. 連携の設定) */
const LEGACY_MONOLOG_SETTINGS_KEY = 'storift:monolog:settings';

export interface SessionSettings {
	/** 無操作で終了するまでの時間(分) */
	idleMinutes: number;
}

function validIdle(value: unknown): number | null {
	return typeof value === 'number' && (IDLE_MINUTES_OPTIONS as readonly number[]).includes(value)
		? value
		: null;
}

function readIdle(storage: Pick<Storage, 'getItem'>, key: string): number | null {
	try {
		const raw = storage.getItem(key);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object'
			? validIdle((parsed as Record<string, unknown>).idleMinutes)
			: null;
	} catch {
		return null;
	}
}

/**
 * 保存された設定を読む。本体の設定が無ければ Monolog. 連携の以前の値を引き継ぎ、本体の設定として保存する。
 * 壊れた値・範囲外の値は既定値(5 分)にする
 */
export function loadSessionSettings(
	storage: Pick<Storage, 'getItem' | 'setItem'> | null
): SessionSettings {
	if (!storage) return { idleMinutes: DEFAULT_IDLE_MINUTES };
	const own = readIdle(storage, SESSION_SETTINGS_KEY);
	if (own !== null) return { idleMinutes: own };
	const legacy = readIdle(storage, LEGACY_MONOLOG_SETTINGS_KEY);
	if (legacy !== null) {
		try {
			storage.setItem(SESSION_SETTINGS_KEY, JSON.stringify({ idleMinutes: legacy }));
		} catch {
			// 保存できなくても、読めた値は使う
		}
		return { idleMinutes: legacy };
	}
	return { idleMinutes: DEFAULT_IDLE_MINUTES };
}

function defaultStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

let current = $state<SessionSettings>(loadSessionSettings(defaultStorage()));

export const sessionSettings = {
	get value(): SessionSettings {
		return current;
	},
	update(patch: Partial<SessionSettings>): void {
		current = { idleMinutes: validIdle(patch.idleMinutes) ?? current.idleMinutes };
		try {
			localStorage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(current));
		} catch (error) {
			console.warn('執筆セッションの設定を保存できませんでした:', error);
		}
	}
};
