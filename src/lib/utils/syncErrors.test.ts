import { describe, it, expect } from 'vitest';
import {
	classifyError,
	backoffDelay,
	RetryGate,
	BACKOFF_BASE_MS,
	BACKOFF_MAX_MS
} from './syncErrors';

const withCode = (code: string, message = 'x') => Object.assign(new Error(message), { code });

describe('classifyError', () => {
	it('通信系のエラーは再試行可', () => {
		for (const code of ['unavailable', 'deadline-exceeded', 'auth/network-request-failed']) {
			expect(classifyError(withCode(code)).kind).toBe('retryable');
		}
	});

	it('権限・認証のエラーは再試行不可で、メッセージを保持する', () => {
		const r = classifyError(withCode('permission-denied', 'Missing permissions'));
		expect(r).toEqual({ kind: 'fatal', code: 'permission-denied', message: 'Missing permissions' });
		expect(classifyError(withCode('firestore/unauthenticated')).kind).toBe('fatal');
	});

	it('コードの無い通信エラーは network として再試行可', () => {
		const r = classifyError(new TypeError('Failed to fetch'));
		expect(r.kind).toBe('retryable');
		expect(r.code).toBe('network-request-failed');
	});

	it('分類できないエラーは再試行可として扱う', () => {
		expect(classifyError(new Error('boom'))).toMatchObject({ kind: 'retryable', code: 'unknown' });
		expect(classifyError('str').message).toBe('str');
	});
});

describe('backoffDelay', () => {
	it('5秒から倍々に増え、5分で頭打ちになる(ジッタなし)', () => {
		const mid = () => 0.5; // ジッタ係数 1.0
		expect(backoffDelay(1, mid)).toBe(BACKOFF_BASE_MS);
		expect(backoffDelay(2, mid)).toBe(BACKOFF_BASE_MS * 2);
		expect(backoffDelay(3, mid)).toBe(BACKOFF_BASE_MS * 4);
		expect(backoffDelay(10, mid)).toBe(BACKOFF_MAX_MS);
		expect(backoffDelay(100, mid)).toBe(BACKOFF_MAX_MS);
	});

	it('ジッタは ±20% で、上限を超えない', () => {
		expect(backoffDelay(1, () => 0)).toBe(4000);
		expect(backoffDelay(1, () => 1)).toBe(6000);
		expect(backoffDelay(20, () => 1)).toBe(BACKOFF_MAX_MS);
	});
});

describe('RetryGate', () => {
	const retryable = classifyError(withCode('unavailable'));
	const fatal = classifyError(withCode('permission-denied'));

	it('再試行可の失敗後はバックオフ時間が過ぎるまで実行できない', () => {
		const gate = new RetryGate();
		expect(gate.canRun(1000)).toBe(true);
		const delay = gate.onFailure(retryable, 1000, () => 0.5);
		expect(delay).toBe(5000);
		expect(gate.canRun(1000 + 4999)).toBe(false);
		expect(gate.canRun(1000 + 5000)).toBe(true);
		// 連続で失敗すると待ち時間が延びる
		expect(gate.onFailure(retryable, 6000, () => 0.5)).toBe(10000);
		expect(gate.failureCount).toBe(2);
	});

	it('成功するとバックオフがリセットされる', () => {
		const gate = new RetryGate();
		gate.onFailure(retryable, 0, () => 0.5);
		gate.onSuccess();
		expect(gate.canRun(0)).toBe(true);
		expect(gate.onFailure(retryable, 0, () => 0.5)).toBe(5000);
	});

	it('再試行不可の失敗は reset されるまで実行できない', () => {
		const gate = new RetryGate();
		expect(gate.onFailure(fatal, 0)).toBeNull();
		expect(gate.isBlocked).toBe(true);
		expect(gate.canRun(10 ** 12)).toBe(false);
		gate.reset();
		expect(gate.canRun(0)).toBe(true);
	});
});
