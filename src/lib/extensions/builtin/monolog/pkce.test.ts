import { describe, expect, it } from 'vitest';
import { codeChallengeFor, generateCodeVerifier, generateState } from './pkce';

describe('PKCE', () => {
	it('code_verifier は 43〜128 文字で、使える文字だけでできている', () => {
		for (let i = 0; i < 20; i++) {
			const v = generateCodeVerifier();
			expect(v.length).toBeGreaterThanOrEqual(43);
			expect(v.length).toBeLessThanOrEqual(128);
			expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
		}
	});

	it('毎回異なる値になる', () => {
		expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
		expect(generateState()).not.toBe(generateState());
	});

	it('state は 1024 文字以下の URL セーフな文字列', () => {
		const s = generateState();
		expect(s.length).toBeGreaterThan(0);
		expect(s.length).toBeLessThanOrEqual(1024);
		expect(s).toMatch(/^[A-Za-z0-9\-._~]+$/);
	});

	it('code_challenge は SHA-256 の base64url(43 文字、パディングなし)', async () => {
		// RFC 7636 付録 B のテストベクタ
		const challenge = await codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
		expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
		expect(challenge).toHaveLength(43);
		const random = await codeChallengeFor(generateCodeVerifier());
		expect(random).toMatch(/^[A-Za-z0-9\-_]{43}$/);
	});
});
