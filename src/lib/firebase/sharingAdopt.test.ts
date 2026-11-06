import { describe, it, expect } from 'vitest';
import type { ProjectSharing } from '$lib/types/project';
import { adoptSharing } from './sharingAdopt';
import { generateSecretToken, resolveSecret } from './sharing';

const sharing = (over: Partial<ProjectSharing> = {}): ProjectSharing => ({
	pid: 'p',
	role: 'owner',
	visibility: 'private',
	status: 'active',
	startedAt: 1,
	...over
});

describe('adoptSharing(ポインタ文書の sharing の取り込み)', () => {
	it('他端末が共有を始めた: リモートを採用する', () => {
		const remote = sharing();
		expect(adoptSharing(undefined, remote, false)).toEqual({ adopt: true, sharing: remote });
	});

	it('同じなら何もしない(キーの順序や undefined の違いは無視)', () => {
		const a = sharing({ secrets: { viewer: 'v', editor: 'e' } });
		const b = { secrets: { editor: 'e', viewer: 'v' }, ...sharing(), connectionId: undefined };
		expect(adoptSharing(a, b as ProjectSharing, false).adopt).toBe(false);
	});

	it('他端末が共有を止めた: ローカルが active のときだけ取り除く', () => {
		expect(adoptSharing(sharing({ status: 'active' }), undefined, false)).toEqual({
			adopt: true,
			sharing: undefined
		});
		// 開始の途中(まだリモートに書けていない)と区別できないので残す
		expect(
			adoptSharing(sharing({ status: 'migrating', migration: 'start' }), undefined, false)
		).toEqual({
			adopt: false
		});
	});

	it('この端末が移行を実行中なら触らない', () => {
		expect(adoptSharing(undefined, sharing(), true).adopt).toBe(false);
		expect(adoptSharing(sharing(), undefined, true).adopt).toBe(false);
	});

	it('ゲスト接続のプロジェクトは対象外', () => {
		expect(adoptSharing(sharing({ connectionId: 'c' }), undefined, false).adopt).toBe(false);
	});
});

describe('秘密の決定', () => {
	it('省略・token は 32 バイトの base64url のランダムトークン', () => {
		const a = resolveSecret();
		const b = resolveSecret({ type: 'token' });
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(a).not.toBe(b);
		expect(generateSecretToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('パスワードは入力文字列をそのまま使い、空は拒否する', () => {
		expect(resolveSecret({ type: 'password', value: 'ひみつ 1' })).toBe('ひみつ 1');
		expect(() => resolveSecret({ type: 'password', value: '  ' })).toThrow();
		expect(() => resolveSecret({ type: 'password' })).toThrow();
	});
});
