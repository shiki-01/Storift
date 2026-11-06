import { describe, expect, it } from 'vitest';
import {
	ROUTE_BLOCK_MESSAGES,
	checkLocalProject,
	classifyJoinError,
	decideJoinRoute,
	errorCodeOf,
	isPermissionDeniedError
} from './joinPolicy';

const host = { apiKey: 'k', projectId: 'host' };

describe('decideJoinRoute', () => {
	it('主 Firebase が未設定、または別の Firebase なら接続(connection)', () => {
		expect(decideJoinRoute(undefined, host, null)).toEqual({ kind: 'connection' });
		expect(decideJoinRoute({ apiKey: 'k', projectId: 'mine' }, host, 'owner')).toEqual({
			kind: 'connection'
		});
		expect(decideJoinRoute({ apiKey: 'other', projectId: 'host' }, host, 'owner')).toEqual({
			kind: 'connection'
		});
	});

	it('同じ Firebase でオーナー端末なら参加しない', () => {
		expect(decideJoinRoute(host, host, 'owner')).toEqual({ kind: 'owner-device' });
		expect(ROUTE_BLOCK_MESSAGES['owner-device']).toContain('オーナー端末');
	});

	it('同じ Firebase でオーナーでなければ、主 Firebase のインスタンスをゲストとして使う', () => {
		expect(decideJoinRoute(host, host, 'needs-owner')).toEqual({ kind: 'primary-guest' });
	});

	it('同じ Firebase で旧ルールなら新ルール未適用として止める', () => {
		expect(decideJoinRoute(host, host, 'legacy')).toEqual({ kind: 'legacy-rules' });
		expect(ROUTE_BLOCK_MESSAGES['legacy-rules']).toContain('新しいルール');
	});

	it('同じ Firebase で状態が判定できていなければ止める(オーナー端末に誤って参加しない)', () => {
		expect(decideJoinRoute(host, host, 'unknown')).toEqual({ kind: 'unknown-access' });
		expect(decideJoinRoute(host, host, null)).toEqual({ kind: 'unknown-access' });
	});
});

describe('checkLocalProject', () => {
	it('同じ ID が無ければ参加できる', () => {
		expect(checkLocalProject(undefined)).toBeNull();
	});

	it('ゲストとして参加済み(再参加)・退出してローカル専用にしたコピーは再利用できる', () => {
		expect(checkLocalProject({ sharing: { role: 'viewer', pid: 'p' } })).toBeNull();
		expect(checkLocalProject({ sharing: { role: 'editor', pid: 'p' } })).toBeNull();
		expect(checkLocalProject({ localOnly: true })).toBeNull();
	});

	it('この端末でオーナーのプロジェクト、通常のプロジェクトとは混ぜない', () => {
		expect(checkLocalProject({ sharing: { role: 'owner', pid: 'p' } })).toBe('own-project');
		expect(checkLocalProject({})).toBe('plain-project');
	});
});

describe('errorCodeOf / isPermissionDeniedError', () => {
	it('コードを小文字で取り出し、無ければ空文字', () => {
		expect(errorCodeOf({ code: 'permission-denied' })).toBe('permission-denied');
		expect(errorCodeOf({ code: 'auth/Operation-Not-Allowed' })).toBe('auth/operation-not-allowed');
		expect(errorCodeOf({ code: 'firestore/unavailable' })).toBe('unavailable');
		expect(errorCodeOf(new Error('x'))).toBe('');
		expect(errorCodeOf(null)).toBe('');
	});

	it('権限エラーの判定', () => {
		expect(isPermissionDeniedError({ code: 'permission-denied' })).toBe(true);
		expect(isPermissionDeniedError({ code: 'unavailable' })).toBe(false);
		expect(isPermissionDeniedError(undefined)).toBe(false);
	});
});

describe('classifyJoinError', () => {
	const denied = { code: 'permission-denied' };

	it('参加時の permission-denied は招待の無効(パスワード方式はパスワードにも触れる)', () => {
		const password = classifyJoinError(denied, 'member', { passwordInvite: true });
		expect(password.code).toBe('denied');
		expect(password.message).toContain('パスワードが違う');
		const token = classifyJoinError(denied, 'member');
		expect(token.code).toBe('denied');
		expect(token.message).toContain('招待が無効');
		expect(token.message).not.toContain('パスワードが違う');
	});

	it('旧ルールと判別できたときは、ルール未適用の案内', () => {
		const result = classifyJoinError(denied, 'member', { legacyRules: true });
		expect(result.code).toBe('legacy-rules');
		expect(result.message).toContain('新しいルール');
	});

	it('取得時の permission-denied は読み取り権限なし', () => {
		const result = classifyJoinError(denied, 'fetch');
		expect(result.code).toBe('denied');
		expect(result.message).toContain('読み取る権限');
	});

	it('サインインの失敗: 匿名認証が無効・承認済みドメイン・その他', () => {
		expect(classifyJoinError({ code: 'auth/operation-not-allowed' }, 'signin').code).toBe(
			'auth-disabled'
		);
		expect(classifyJoinError({ code: 'auth/unauthorized-domain' }, 'signin').code).toBe(
			'unauthorized-domain'
		);
		expect(classifyJoinError({ code: 'auth/invalid-api-key' }, 'signin').code).toBe(
			'signin-failed'
		);
		expect(classifyJoinError(new Error('x'), 'signin').code).toBe('signin-failed');
	});

	it('通信できない・上限超過は、どの段階でも共通の案内', () => {
		for (const stage of ['signin', 'member', 'fetch'] as const) {
			expect(classifyJoinError({ code: 'unavailable' }, stage).code).toBe('offline');
			expect(classifyJoinError({ code: 'auth/network-request-failed' }, stage).code).toBe(
				'offline'
			);
			expect(classifyJoinError({ code: 'resource-exhausted' }, stage).code).toBe('quota');
		}
	});

	it('分類できないものは詳細つきの汎用メッセージ。すべて日本語で空でない', () => {
		const result = classifyJoinError(new Error('boom'), 'member');
		expect(result.code).toBe('unknown');
		expect(result.message).toContain('boom');
		expect(classifyJoinError('文字列', 'fetch').message.length).toBeGreaterThan(0);
	});
});
