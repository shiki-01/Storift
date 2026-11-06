import { describe, expect, it } from 'vitest';
import { joinUrl, validateBaseUrl } from './url';

describe('validateBaseUrl', () => {
	it('https は許可し、末尾のスラッシュを除く', () => {
		expect(validateBaseUrl('https://api.openai.com/v1/')).toEqual({
			ok: true,
			url: 'https://api.openai.com/v1'
		});
		expect(validateBaseUrl('  https://example.com  ')).toEqual({
			ok: true,
			url: 'https://example.com'
		});
	});

	it('localhost 系の http は許可する', () => {
		for (const u of [
			'http://localhost:1234/v1',
			'http://127.0.0.1:8000/v1',
			'http://[::1]:11434/v1',
			'http://localhost/v1'
		]) {
			expect(validateBaseUrl(u).ok, u).toBe(true);
		}
	});

	it('それ以外の http は拒否する', () => {
		for (const u of [
			'http://example.com/v1',
			'http://192.168.0.5:8000/v1',
			'http://localhost.evil.com/v1',
			'http://127.0.0.1.evil.com/v1',
			'http://0.0.0.0:8000'
		]) {
			expect(validateBaseUrl(u).ok, u).toBe(false);
		}
	});

	it('空・不正な形式・http/https 以外は拒否する', () => {
		for (const u of [
			'',
			'   ',
			'api.openai.com',
			'ftp://example.com',
			'file:///etc/passwd',
			'javascript:alert(1)'
		]) {
			expect(validateBaseUrl(u).ok, u).toBe(false);
		}
	});

	it('認証情報・クエリ・フラグメントを含む URL は拒否する', () => {
		expect(validateBaseUrl('https://user:pass@example.com/v1').ok).toBe(false);
		expect(validateBaseUrl('https://example.com/v1?key=abc').ok).toBe(false);
		expect(validateBaseUrl('https://example.com/v1#x').ok).toBe(false);
	});

	it('拒否の理由は日本語で、URL を含めない', () => {
		const r = validateBaseUrl('http://example.com/secret-path');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toMatch(/localhost/);
			expect(r.error).not.toContain('secret-path');
		}
	});
});

describe('joinUrl', () => {
	it('スラッシュの重複を作らずにつなぐ', () => {
		expect(joinUrl('https://a.com/v1', 'chat/completions')).toBe(
			'https://a.com/v1/chat/completions'
		);
		expect(joinUrl('https://a.com/v1/', '/models')).toBe('https://a.com/v1/models');
	});
});
