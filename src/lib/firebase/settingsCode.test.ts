import { describe, expect, it } from 'vitest';
import {
	decodeSettingsCode,
	encodeSettingsCode,
	looksLikeSettingsCode,
	SETTINGS_CODE_PREFIX
} from './settingsCode';
import type { FirebaseConfig } from '$lib/types';

const config: FirebaseConfig = {
	apiKey: 'AIzaSyTest',
	authDomain: 'demo.firebaseapp.com',
	projectId: 'demo',
	storageBucket: 'demo.appspot.com',
	messagingSenderId: '123456789',
	appId: '1:123456789:web:abc'
};

const raw = (payload: unknown) =>
	SETTINGS_CODE_PREFIX +
	btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('settingsCode', () => {
	it('encode した値を decode で元に戻せる', () => {
		const code = encodeSettingsCode(config, 'key_-abc');
		expect(code.startsWith('storift1:')).toBe(true);
		expect(code).not.toMatch(/[+/=\s]/);
		expect(decodeSettingsCode(code)).toEqual({ ok: true, config, ownerKey: 'key_-abc' });
	});

	it('日本語など非 ASCII を含んでも往復できる', () => {
		const c = { ...config, projectId: 'プロジェクト' };
		expect(decodeSettingsCode(encodeSettingsCode(c, 'k'))).toEqual({
			ok: true,
			config: c,
			ownerKey: 'k'
		});
	});

	it('前後の空白・途中の改行を許容する', () => {
		const code = encodeSettingsCode(config, 'k');
		const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20)}\n`;
		expect(decodeSettingsCode(wrapped).ok).toBe(true);
	});

	it('余計なキーは落とす', () => {
		const result = decodeSettingsCode(raw({ v: 1, f: { ...config, extra: 'x' }, k: 'k' }));
		expect(result).toEqual({ ok: true, config, ownerKey: 'k' });
	});

	it('プレフィックスが無ければ not-code', () => {
		expect(decodeSettingsCode('apiKey: "x"')).toEqual({ ok: false, error: 'not-code' });
		expect(decodeSettingsCode('')).toEqual({ ok: false, error: 'not-code' });
	});

	it('バージョン違いは unsupported-version', () => {
		expect(decodeSettingsCode('storift2:abc')).toEqual({ ok: false, error: 'unsupported-version' });
		expect(decodeSettingsCode(raw({ v: 2, f: config, k: 'k' }))).toEqual({
			ok: false,
			error: 'unsupported-version'
		});
	});

	it('壊れた本体は malformed(例外を投げない)', () => {
		for (const body of ['', '!!!', 'abc', '@@@@', 'e30', 'bm90LWpzb24']) {
			const r = decodeSettingsCode(SETTINGS_CODE_PREFIX + body);
			expect(r.ok).toBe(false);
		}
		expect(decodeSettingsCode(SETTINGS_CODE_PREFIX + 'bm90LWpzb24')).toEqual({
			ok: false,
			error: 'malformed'
		});
		expect(decodeSettingsCode(raw(null))).toEqual({ ok: false, error: 'malformed' });
	});

	it('項目欠落は missing-fields', () => {
		const { appId: _appId, ...partial } = config;
		void _appId;
		expect(decodeSettingsCode(raw({ v: 1, f: partial, k: 'k' }))).toEqual({
			ok: false,
			error: 'missing-fields'
		});
		expect(decodeSettingsCode(raw({ v: 1, f: config }))).toEqual({
			ok: false,
			error: 'missing-fields'
		});
		expect(decodeSettingsCode(raw({ v: 1, f: config, k: '' }))).toEqual({
			ok: false,
			error: 'missing-fields'
		});
		expect(decodeSettingsCode(raw({ v: 1, f: { ...config, apiKey: '' }, k: 'k' }))).toEqual({
			ok: false,
			error: 'missing-fields'
		});
		expect(decodeSettingsCode(raw({ v: 1, k: 'k' }))).toEqual({
			ok: false,
			error: 'missing-fields'
		});
	});

	it('looksLikeSettingsCode', () => {
		expect(looksLikeSettingsCode(' storift1:abc')).toBe(true);
		expect(looksLikeSettingsCode('storift9:abc')).toBe(true);
		expect(looksLikeSettingsCode('{"apiKey":"x"}')).toBe(false);
	});
});
