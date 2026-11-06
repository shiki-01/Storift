import type { FirebaseConfig } from '$lib/types';
import { isValidFirebaseConfig } from '$lib/utils/validation';

/**
 * 設定コード = Firebase 設定 + オーナー鍵を 1 つの文字列にしたもの。
 * 形式: `storift1:` + base64url(JSON `{v:1, f:<Firebase設定6項目>, k:<ownerKey>}`)
 * 2 台目以降の端末で、Firebase Console の設定値の代わりに貼り付ける。
 */
export const SETTINGS_CODE_PREFIX = 'storift1:';

export type SettingsCodeError =
	/** `storift` + 数字 + `:` で始まらない(設定コードではない) */
	| 'not-code'
	/** 対応していないバージョン */
	| 'unsupported-version'
	/** base64url / JSON として読めない */
	| 'malformed'
	/** Firebase 設定またはオーナー鍵が欠けている */
	| 'missing-fields';

export type DecodedSettingsCode =
	| { ok: true; config: FirebaseConfig; ownerKey: string }
	| { ok: false; error: SettingsCodeError };

export const SETTINGS_CODE_ERROR_MESSAGES: Record<SettingsCodeError, string> = {
	'not-code': '設定コードではありません',
	'unsupported-version':
		'このバージョンのアプリでは読めない設定コードです。アプリを更新してください',
	malformed: '設定コードが壊れています。最後までコピーできているか確認してください',
	'missing-fields': '設定コードに必要な項目が足りません'
};

function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
	const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** 余計なキーを落として 6 項目だけにそろえる */
function pickConfig(config: FirebaseConfig): FirebaseConfig {
	return {
		apiKey: config.apiKey,
		authDomain: config.authDomain,
		projectId: config.projectId,
		storageBucket: config.storageBucket,
		messagingSenderId: config.messagingSenderId,
		appId: config.appId
	};
}

export function encodeSettingsCode(config: FirebaseConfig, ownerKey: string): string {
	return (
		SETTINGS_CODE_PREFIX + toBase64Url(JSON.stringify({ v: 1, f: pickConfig(config), k: ownerKey }))
	);
}

/** 貼り付けられた文字列が設定コードの形をしているか(中身の検証はしない) */
export function looksLikeSettingsCode(text: string): boolean {
	return /^storift\d+:/.test(text.trim());
}

export function decodeSettingsCode(text: string): DecodedSettingsCode {
	// 改行や空白が混ざっても読めるようにする
	const code = text.replace(/\s+/g, '');
	const match = /^storift(\d+):(.*)$/.exec(code);
	if (!match) return { ok: false, error: 'not-code' };
	if (match[1] !== '1') return { ok: false, error: 'unsupported-version' };

	const body = match[2];
	if (!/^[A-Za-z0-9_-]+$/.test(body)) return { ok: false, error: 'malformed' };

	let payload: unknown;
	try {
		payload = JSON.parse(fromBase64Url(body));
	} catch {
		return { ok: false, error: 'malformed' };
	}
	if (typeof payload !== 'object' || payload === null) return { ok: false, error: 'malformed' };

	const p = payload as { v?: unknown; f?: unknown; k?: unknown };
	if (p.v !== 1) return { ok: false, error: 'unsupported-version' };
	if (!isValidFirebaseConfig(p.f) || typeof p.k !== 'string' || p.k.length === 0) {
		return { ok: false, error: 'missing-fields' };
	}
	const config = pickConfig(p.f as FirebaseConfig);
	if (Object.values(config).some((v) => v.length === 0)) {
		return { ok: false, error: 'missing-fields' };
	}
	return { ok: true, config, ownerKey: p.k };
}
