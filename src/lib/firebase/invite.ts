import type { FirebaseConfig } from '$lib/types';
import { isValidFirebaseConfig } from '$lib/utils/validation';
import { fromBase64Url, pickConfig, toBase64Url } from './settingsCode';

/**
 * 招待リンク。形式: `<base>/join#<payload>`
 * payload = base64url(JSON `{v:1, f:<Firebase設定6項目>, p:<pid>, r:'viewer'|'editor', s?:<秘密>, n?:<名前ヒント>}`)
 * 秘密(s)はトークン方式のときだけ入れる。パスワード方式ではリンクに秘密を入れず、参加者が入力する。
 * フラグメント(#以降)はサーバーへ送られない。読み取ったあとは history.replaceState で消すこと。
 */

export const INVITE_PATH = '/join';

/** デスクトップ版(Tauri)で、招待リンクの <base> に使う公開アプリの URL */
export const PUBLIC_APP_URL = 'https://app.storift.shiki-01.com';

export type InviteRole = 'viewer' | 'editor';

export interface InviteData {
	config: FirebaseConfig;
	pid: string;
	role: InviteRole;
	/** トークン方式のときだけ。パスワード方式は undefined */
	secret?: string;
	/** プロジェクト名のヒント(任意) */
	nameHint?: string;
}

export type InviteError =
	/** 空 */
	| 'empty'
	/** base64url / JSON として読めない */
	| 'malformed'
	/** 対応していないバージョン */
	| 'unsupported-version'
	/** 必要な項目が足りない・不正 */
	| 'missing-fields';

export type DecodedInvite = { ok: true; invite: InviteData } | { ok: false; error: InviteError };

export const INVITE_ERROR_MESSAGES: Record<InviteError, string> = {
	empty: '招待リンクが空です',
	malformed: '招待リンクが壊れています。最後までコピーできているか確認してください',
	'unsupported-version':
		'このバージョンのアプリでは読めない招待リンクです。アプリを更新してください',
	'missing-fields': '招待リンクに必要な項目が足りません'
};

const MAX_SECRET = 1024;
const MAX_NAME = 200;
/** 共有のパス(shared/{pid})に使える ID。スラッシュなどパスを壊す文字は受け付けない */
const PID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function encodeInvitePayload(data: InviteData): string {
	const payload: Record<string, unknown> = {
		v: 1,
		f: pickConfig(data.config),
		p: data.pid,
		r: data.role
	};
	if (data.secret) payload.s = data.secret;
	if (data.nameHint) payload.n = data.nameHint;
	return toBase64Url(JSON.stringify(payload));
}

/** 招待リンクを組み立てる。base の末尾のスラッシュは取り除く */
export function buildInviteLink(base: string, data: InviteData): string {
	return `${base.replace(/\/+$/, '')}${INVITE_PATH}#${encodeInvitePayload(data)}`;
}

/**
 * Tauri の WebView の内部オリジンか。外部の人は開けない。
 * Windows は http(s)://tauri.localhost、macOS/Linux は tauri://localhost。
 */
export function isTauriOrigin(origin: string): boolean {
	return /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)(:\d+)?\/?$/i.test(origin.trim());
}

/**
 * 招待リンクの <base>。Web 版は現在のオリジン、デスクトップ版は公開アプリの URL。
 * デスクトップの判定(desktop)が外れても、オリジンが Tauri の内部オリジンなら公開アプリの URL にする。
 */
export function inviteBase(desktop: boolean, origin?: string): string {
	if (desktop || !origin || isTauriOrigin(origin)) return PUBLIC_APP_URL;
	return origin;
}

/**
 * 貼り付けられた文字列から payload を取り出す。
 * 完全な URL(`https://…/join#payload`)、`#payload`、payload だけのいずれも受け付ける。空白・改行は無視する。
 */
export function extractInvitePayload(text: string): string {
	const compact = text.replace(/\s+/g, '');
	const hash = compact.indexOf('#');
	return hash >= 0 ? compact.slice(hash + 1) : compact;
}

export function decodeInvite(text: string): DecodedInvite {
	const body = extractInvitePayload(text);
	if (body.length === 0) return { ok: false, error: 'empty' };
	if (!/^[A-Za-z0-9_-]+$/.test(body)) return { ok: false, error: 'malformed' };

	let payload: unknown;
	try {
		payload = JSON.parse(fromBase64Url(body));
	} catch {
		return { ok: false, error: 'malformed' };
	}
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		return { ok: false, error: 'malformed' };
	}

	const p = payload as {
		v?: unknown;
		f?: unknown;
		p?: unknown;
		r?: unknown;
		s?: unknown;
		n?: unknown;
	};
	if (p.v !== 1) return { ok: false, error: 'unsupported-version' };
	if (!isValidFirebaseConfig(p.f)) return { ok: false, error: 'missing-fields' };
	const config = pickConfig(p.f as FirebaseConfig);
	if (Object.values(config).some((v) => v.length === 0)) {
		return { ok: false, error: 'missing-fields' };
	}
	if (typeof p.p !== 'string' || !PID_PATTERN.test(p.p)) {
		return { ok: false, error: 'missing-fields' };
	}
	if (p.r !== 'viewer' && p.r !== 'editor') return { ok: false, error: 'missing-fields' };
	if (
		p.s !== undefined &&
		(typeof p.s !== 'string' || p.s.length === 0 || p.s.length > MAX_SECRET)
	) {
		return { ok: false, error: 'missing-fields' };
	}
	if (p.n !== undefined && (typeof p.n !== 'string' || p.n.length > MAX_NAME)) {
		return { ok: false, error: 'missing-fields' };
	}

	return {
		ok: true,
		invite: {
			config,
			pid: p.p,
			role: p.r,
			...(p.s !== undefined ? { secret: p.s } : {}),
			...(p.n ? { nameHint: p.n } : {})
		}
	};
}
