import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';

const at = (updatedAt: number) => ({ updatedAt });

describe('reconcile', () => {
	it('updatedAt が同じなら何もしない', () => {
		expect(reconcile(at(10), at(10), 5)).toBe('skip');
		expect(reconcile(at(10), at(10), undefined)).toBe('skip');
	});

	it('base が無い場合は新しい方を採用し、競合にしない', () => {
		expect(reconcile(at(10), at(20), undefined)).toBe('apply-remote');
		expect(reconcile(at(20), at(10), undefined)).toBe('push-local');
	});

	it('リモートだけが base 以降に変更されたなら取り込む', () => {
		expect(reconcile(at(10), at(20), 10)).toBe('apply-remote');
	});

	it('ローカルだけが base 以降に変更されたならアップロードする', () => {
		expect(reconcile(at(20), at(10), 10)).toBe('push-local');
	});

	it('双方が base 以降に変更されたら競合', () => {
		expect(reconcile(at(20), at(30), 10)).toBe('conflict');
		expect(reconcile(at(30), at(20), 10)).toBe('conflict');
	});

	it('どちらも base 以降に変更されていなければ新しい方を採用する', () => {
		expect(reconcile(at(5), at(8), 10)).toBe('apply-remote');
		expect(reconcile(at(8), at(5), 10)).toBe('push-local');
	});
});
