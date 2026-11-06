import { describe, it, expect } from 'vitest';
import { adoptOwnedFields, reconcile, reconcileOwned, reconcileReadOnly } from './reconcile';

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

describe('reconcileReadOnly(閲覧専用: リモートが常に勝つ)', () => {
	it('版も内容も同じなら何もしない', () => {
		expect(reconcileReadOnly(at(10), at(10), true)).toBe('skip');
	});

	it('ローカルが新しくても(混入した変更)、リモートを採用する', () => {
		expect(reconcileReadOnly(at(30), at(10), false)).toBe('apply-remote');
	});

	it('版が同じでも内容が違えば(版を変えずに書き換えられた)リモートを採用する', () => {
		expect(reconcileReadOnly(at(10), at(10), false)).toBe('apply-remote');
	});

	it('リモートが新しければ採用する', () => {
		expect(reconcileReadOnly(at(5), at(10), false)).toBe('apply-remote');
		expect(reconcileReadOnly(at(5), at(10), true)).toBe('apply-remote');
	});
});

describe('CRDT 化したシーンの突き合わせ', () => {
	it('adoptOwnedFields: content と characterCount はローカルの値を保つ', () => {
		const local = { id: 's', title: 'a', content: 'L', characterCount: 1, updatedAt: 1 };
		const remote = { id: 's', title: 'b', content: 'R', characterCount: 9, updatedAt: 2 };
		expect(adoptOwnedFields(local, remote)).toEqual({
			id: 's',
			title: 'b',
			content: 'L',
			characterCount: 1,
			updatedAt: 2
		});
		expect(remote.content).toBe('R');
	});

	it('本文以外に差が無ければ、双方が base 以降に変更していても競合にしない', () => {
		expect(reconcileOwned({ updatedAt: 150 }, { updatedAt: 200 }, 100, false)).toBe('skip');
		expect(reconcileOwned({ updatedAt: 300 }, { updatedAt: 200 }, 100, false)).toBe('push-local');
		expect(reconcileOwned({ updatedAt: 200 }, { updatedAt: 200 }, 100, false)).toBe('skip');
	});

	it('本文以外に差があれば通常の 3 者比較', () => {
		expect(reconcileOwned({ updatedAt: 150 }, { updatedAt: 200 }, 100, true)).toBe('conflict');
		expect(reconcileOwned({ updatedAt: 100 }, { updatedAt: 200 }, 100, true)).toBe('apply-remote');
		expect(reconcileOwned({ updatedAt: 150 }, { updatedAt: 100 }, 100, true)).toBe('push-local');
	});
});
