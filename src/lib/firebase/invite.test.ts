import { describe, expect, it } from 'vitest';
import {
	INVITE_ERROR_MESSAGES,
	PUBLIC_APP_URL,
	buildInviteLink,
	decodeInvite,
	encodeInvitePayload,
	extractInvitePayload,
	inviteBase,
	type InviteData
} from './invite';
import { toBase64Url } from './settingsCode';

const config = {
	apiKey: 'key-1',
	authDomain: 'demo.firebaseapp.com',
	projectId: 'demo',
	storageBucket: 'demo.appspot.com',
	messagingSenderId: '123',
	appId: '1:123:web:abc'
};
const PID = '3b1d6a1e-6f0a-4c2e-9a53-0d3f2b7e8c41';

const invite = (extra: Partial<InviteData> = {}): InviteData => ({
	config,
	pid: PID,
	role: 'editor',
	...extra
});

const payloadOf = (obj: unknown) => toBase64Url(JSON.stringify(obj));

describe('encode / decode', () => {
	it('往復できる(トークン方式)', () => {
		const result = decodeInvite(
			buildInviteLink('https://app.example', invite({ secret: 'tok_-1' }))
		);
		expect(result).toEqual({ ok: true, invite: invite({ secret: 'tok_-1' }) });
	});

	it('パスワード方式は秘密を含まない', () => {
		const payload = encodeInvitePayload(invite({ role: 'viewer' }));
		const result = decodeInvite(payload);
		expect(result.ok && result.invite.secret).toBeUndefined();
		expect(result.ok && 'secret' in result.invite).toBe(false);
	});

	it('日本語のプロジェクト名ヒントを往復できる', () => {
		const result = decodeInvite(encodeInvitePayload(invite({ nameHint: '吾輩は猫である 🐈' })));
		expect(result.ok && result.invite.nameHint).toBe('吾輩は猫である 🐈');
	});

	it('余計なキーは落とし、Firebase 設定は6項目だけ', () => {
		const withExtra = { ...config, measurementId: 'G-XXX' };
		const result = decodeInvite(encodeInvitePayload(invite({ config: withExtra })));
		expect(result.ok && result.invite.config).toEqual(config);
	});

	it('リンクは <base>/join#payload で、base 末尾のスラッシュを重ねない', () => {
		const link = buildInviteLink('https://app.example/', invite());
		expect(link.startsWith('https://app.example/join#')).toBe(true);
		expect(link.split('#')).toHaveLength(2);
	});
});

describe('貼り付け入力の許容', () => {
	const payload = encodeInvitePayload(invite({ secret: 's3cret' }));

	it('完全な URL / #付き / payload のみ のどれでも読める', () => {
		for (const text of [`https://x.example/join#${payload}`, `#${payload}`, payload]) {
			expect(decodeInvite(text).ok).toBe(true);
		}
	});

	it('空白・改行が混ざっていても読める', () => {
		const broken = `  https://x.example/join#${payload.slice(0, 20)}\n${payload.slice(20, 40)} \t${payload.slice(40)}\r\n`;
		expect(decodeInvite(broken)).toEqual({ ok: true, invite: invite({ secret: 's3cret' }) });
		expect(extractInvitePayload(broken)).toBe(payload);
	});
});

describe('不正入力は例外を投げず結果で返す', () => {
	it('空', () => {
		expect(decodeInvite('')).toEqual({ ok: false, error: 'empty' });
		expect(decodeInvite('  \n ')).toEqual({ ok: false, error: 'empty' });
		expect(decodeInvite('https://x.example/join#')).toEqual({ ok: false, error: 'empty' });
	});

	it('base64url / JSON として読めない', () => {
		expect(decodeInvite('これは招待ではない')).toEqual({ ok: false, error: 'malformed' });
		expect(decodeInvite('!!!!')).toEqual({ ok: false, error: 'malformed' });
		expect(decodeInvite('abc')).toEqual({ ok: false, error: 'malformed' });
		expect(decodeInvite(toBase64Url('not json'))).toEqual({ ok: false, error: 'malformed' });
		expect(decodeInvite(toBase64Url('[1,2]'))).toEqual({ ok: false, error: 'malformed' });
		expect(decodeInvite(toBase64Url('null'))).toEqual({ ok: false, error: 'malformed' });
	});

	it('壊れた UTF-8 は malformed', () => {
		// 0xFF は UTF-8 として不正
		expect(decodeInvite('_w')).toEqual({ ok: false, error: 'malformed' });
	});

	it('バージョン違い', () => {
		const ok = { f: config, p: PID, r: 'viewer' };
		expect(decodeInvite(payloadOf({ ...ok, v: 2 }))).toEqual({
			ok: false,
			error: 'unsupported-version'
		});
		expect(decodeInvite(payloadOf(ok))).toEqual({ ok: false, error: 'unsupported-version' });
	});

	it('項目の欠落・不正', () => {
		const ok = { v: 1, f: config, p: PID, r: 'viewer' };
		const bad = [
			{ ...ok, f: undefined },
			{ ...ok, f: { ...config, apiKey: '' } },
			{ ...ok, f: { ...config, appId: 1 } },
			{ ...ok, p: undefined },
			{ ...ok, p: '' },
			{ ...ok, p: 'a/b' },
			{ ...ok, p: '../x' },
			{ ...ok, r: 'owner' },
			{ ...ok, r: undefined },
			{ ...ok, s: '' },
			{ ...ok, s: 5 },
			{ ...ok, n: 5 },
			{ ...ok, n: 'x'.repeat(201) }
		];
		for (const payload of bad) {
			expect(decodeInvite(payloadOf(payload)), JSON.stringify(payload)).toEqual({
				ok: false,
				error: 'missing-fields'
			});
		}
	});

	it('どのエラーにも日本語メッセージがある', () => {
		for (const message of Object.values(INVITE_ERROR_MESSAGES))
			expect(message.length).toBeGreaterThan(0);
	});
});

describe('inviteBase', () => {
	it('Web 版は現在のオリジン、デスクトップ版は公開アプリの URL', () => {
		expect(inviteBase(false, 'https://my.example')).toBe('https://my.example');
		expect(inviteBase(true, 'tauri://localhost')).toBe(PUBLIC_APP_URL);
		expect(inviteBase(false, undefined)).toBe(PUBLIC_APP_URL);
	});

	it('Windows(http://tauri.localhost)・tauri://localhost は、判定が外れても公開アプリの URL', () => {
		for (const desktop of [true, false]) {
			expect(inviteBase(desktop, 'http://tauri.localhost')).toBe(PUBLIC_APP_URL);
			expect(inviteBase(desktop, 'https://tauri.localhost')).toBe(PUBLIC_APP_URL);
			expect(inviteBase(desktop, 'tauri://localhost')).toBe(PUBLIC_APP_URL);
		}
	});

	it('通常の Web オリジンはそのまま(tauri.localhost に似たホストは除く)', () => {
		expect(inviteBase(false, 'https://app.storift.shiki-01.com')).toBe(
			'https://app.storift.shiki-01.com'
		);
		expect(inviteBase(false, 'http://localhost:5173')).toBe('http://localhost:5173');
		expect(inviteBase(false, 'https://tauri.localhost.evil.example')).toBe(
			'https://tauri.localhost.evil.example'
		);
	});
});
