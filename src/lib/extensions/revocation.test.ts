import { describe, expect, it } from 'vitest';
import { REVOCATION_INTERVAL_MS, shouldCheckOnStartup } from './revocation.svelte';

describe('shouldCheckOnStartup(起動時の失効リストの確認)', () => {
	const base = {
		auto: true,
		hasEnabledScript: true,
		lastCheckedAt: 0,
		now: REVOCATION_INTERVAL_MS + 1
	};

	it('スクリプトを有効にしていて、自動確認がオンで、前回から 1 日経っているときだけ', () => {
		expect(shouldCheckOnStartup(base)).toBe(true);
	});

	it('スクリプトを有効にしていなければ、起動時に通信しない', () => {
		expect(shouldCheckOnStartup({ ...base, hasEnabledScript: false })).toBe(false);
	});

	it('自動確認をオフにしていれば確認しない', () => {
		expect(shouldCheckOnStartup({ ...base, auto: false })).toBe(false);
	});

	it('1 日 1 回まで', () => {
		expect(shouldCheckOnStartup({ ...base, lastCheckedAt: base.now - 1000 })).toBe(false);
		expect(
			shouldCheckOnStartup({ ...base, lastCheckedAt: base.now - REVOCATION_INTERVAL_MS })
		).toBe(true);
	});
});
