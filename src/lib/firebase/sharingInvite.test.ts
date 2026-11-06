import { describe, expect, it } from 'vitest';
import { inviteSecretFor, secretKindOf } from './sharingInvite';
import { generateSecretToken } from './sharing';
import type { ProjectSharing } from '$lib/types/project';

const base: ProjectSharing = {
	pid: 'p',
	role: 'owner',
	visibility: 'private',
	status: 'active',
	startedAt: 1
};

describe('secretKindOf', () => {
	it('記録があればそれに従う(トークンの形のパスワードもパスワード)', () => {
		const token = generateSecretToken();
		const sharing = {
			...base,
			secrets: { viewer: token },
			secretKinds: { viewer: 'password' as const }
		};
		expect(secretKindOf(sharing, 'viewer')).toBe('password');
	});

	it('記録が無いときは、生成トークンの形ならトークン、それ以外はパスワード', () => {
		const sharing = {
			...base,
			secrets: { viewer: generateSecretToken(), editor: 'correct horse' }
		};
		expect(secretKindOf(sharing, 'viewer')).toBe('token');
		expect(secretKindOf(sharing, 'editor')).toBe('password');
	});

	it('秘密を持っていなければ null', () => {
		expect(secretKindOf(base, 'viewer')).toBeNull();
		expect(secretKindOf({ ...base, secrets: { editor: 'x' } }, 'viewer')).toBeNull();
	});
});

describe('inviteSecretFor', () => {
	it('トークン方式だけ値を返し、パスワード方式は値を含めない', () => {
		const sharing: ProjectSharing = {
			...base,
			secrets: { viewer: 'tok', editor: 'hunter2' },
			secretKinds: { viewer: 'token', editor: 'password' }
		};
		expect(inviteSecretFor(sharing, 'viewer')).toEqual({ kind: 'token', value: 'tok' });
		const password = inviteSecretFor(sharing, 'editor');
		expect(password).toEqual({ kind: 'password' });
		expect(JSON.stringify(password)).not.toContain('hunter2');
	});

	it('秘密が無ければ null', () => {
		expect(inviteSecretFor(base, 'editor')).toBeNull();
	});
});
