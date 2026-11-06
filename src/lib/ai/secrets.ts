/**
 * API キーの保管。
 *
 * macOS / Windows では OS のキーチェーンへ(Rust の secret_* コマンド)。
 * キーチェーンを使えない環境(Linux など。Rust が "unsupported" を返す)では、localStorage に
 * 平文で保存する。その場合は設定画面で利用者に伝える。
 * キーはログに出さない。エクスポート・バックアップ・同期の対象にもしない(これらは IndexedDB だけを扱う)。
 */
import { invoke } from '@tauri-apps/api/core';

/** Rust が、キーチェーン非対応の環境で返す値 */
export const UNSUPPORTED = 'unsupported';

const LOCAL_PREFIX = 'storift:ai-secret:';
/** キーチェーンを使えるか確かめるための、存在しない名前 */
const PROBE = ['probe', 'probe'] as const;

export type SecretBackend = 'keychain' | 'local';

/** 判定の結果。一度分かれば変わらないので覚えておく */
let backend: SecretBackend | null = null;

/** テストで状態を戻す */
export function resetSecretBackend(): void {
	backend = null;
}

function localKey(provider: string, name: string): string {
	return `${LOCAL_PREFIX}${provider}:${name}`;
}

function errorText(error: unknown): string {
	return typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
}

function isUnsupported(error: unknown): boolean {
	return errorText(error).trim() === UNSUPPORTED;
}

/** キーの保管先。キーチェーンが使えるかを Rust に問い合わせて決める */
export async function secretBackend(): Promise<SecretBackend> {
	if (backend) return backend;
	try {
		await invoke('secret_get', { provider: PROBE[0], name: PROBE[1] });
		backend = 'keychain';
	} catch (error) {
		// 非対応以外の失敗(キーチェーンのロック等)でも、平文の保存へは黙って切り替えない
		if (isUnsupported(error)) backend = 'local';
		else throw new Error(`キーチェーンを利用できません: ${errorText(error)}`);
	}
	return backend;
}

export async function getSecret(provider: string, name: string): Promise<string | null> {
	if ((await secretBackend()) === 'local') {
		try {
			return localStorage.getItem(localKey(provider, name));
		} catch {
			return null;
		}
	}
	const value = await invoke<string | null>('secret_get', { provider, name });
	return value ?? null;
}

export async function setSecret(provider: string, name: string, value: string): Promise<void> {
	if ((await secretBackend()) === 'local') {
		localStorage.setItem(localKey(provider, name), value);
		return;
	}
	await invoke('secret_set', { provider, name, value });
}

export async function deleteSecret(provider: string, name: string): Promise<void> {
	if ((await secretBackend()) === 'local') {
		localStorage.removeItem(localKey(provider, name));
		return;
	}
	await invoke('secret_delete', { provider, name });
}
