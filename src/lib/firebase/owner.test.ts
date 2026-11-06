import { describe, expect, it } from 'vitest';
import {
	buildDiagnostics,
	decideAfterLegacyProbe,
	decideAfterOwnProbe,
	decideAfterRegister,
	generateOwnerKey
} from './owner';

describe('generateOwnerKey', () => {
	it('32 バイトの base64url(43 文字、パディング無し)で、毎回異なる', () => {
		const a = generateOwnerKey();
		const b = generateOwnerKey();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(a).not.toBe(b);
	});
});

describe('decideAfterOwnProbe', () => {
	it('存在する -> owner', () => {
		expect(decideAfterOwnProbe('exists')).toEqual({ done: true, mode: 'owner' });
	});
	it('存在しない -> 登録を試す', () => {
		expect(decideAfterOwnProbe('missing')).toEqual({ done: false, next: 'register' });
	});
	it('permission-denied -> 旧ルールかを確認する', () => {
		expect(decideAfterOwnProbe('denied')).toEqual({ done: false, next: 'probe-legacy' });
	});
	it('ネットワークエラー等 -> unknown', () => {
		expect(decideAfterOwnProbe('error')).toEqual({ done: true, mode: 'unknown' });
	});
});

describe('decideAfterRegister', () => {
	it.each([
		['ok', 'owner'],
		['denied', 'needs-owner'],
		['error', 'unknown']
	] as const)('%s -> %s', (probe, mode) => {
		expect(decideAfterRegister(probe)).toBe(mode);
	});
});

describe('decideAfterLegacyProbe', () => {
	it.each([
		['allowed', 'legacy'],
		['denied', 'needs-owner'],
		['error', 'unknown']
	] as const)('%s -> %s', (probe, mode) => {
		expect(decideAfterLegacyProbe(probe)).toBe(mode);
	});
});

describe('buildDiagnostics', () => {
	const statuses = (items: ReturnType<typeof buildDiagnostics>) =>
		Object.fromEntries(items.map((i) => [i.id, i.status]));

	it('新ルール・登録済み', () => {
		expect(statuses(buildDiagnostics({ hasUser: true, own: 'exists' }))).toEqual({
			reachability: 'ok',
			auth: 'ok',
			rules: 'ok',
			owner: 'ok'
		});
	});
	it('新ルール・未登録', () => {
		expect(statuses(buildDiagnostics({ hasUser: true, own: 'missing' })).owner).toBe('ng');
	});
	it('旧ルール', () => {
		const items = buildDiagnostics({ hasUser: true, own: 'denied', legacy: 'allowed' });
		expect(statuses(items)).toEqual({
			reachability: 'ok',
			auth: 'ok',
			rules: 'ok',
			owner: 'unknown'
		});
		expect(items.find((i) => i.id === 'rules')?.detail).toContain('旧ルール');
	});
	it('通信エラー', () => {
		expect(statuses(buildDiagnostics({ hasUser: true, own: 'error' }))).toEqual({
			reachability: 'ng',
			auth: 'ok',
			rules: 'unknown',
			owner: 'unknown'
		});
	});
	it('未サインイン', () => {
		expect(statuses(buildDiagnostics({ hasUser: false, own: 'error' })).auth).toBe('ng');
	});
});
