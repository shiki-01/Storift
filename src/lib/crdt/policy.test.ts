import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
	CLOCK_SKEW_MARGIN_MS,
	groupUpdates,
	listenSince,
	mergePending,
	retryDelay,
	selectDeletableUpdates,
	shouldCompact
} from './policy';

function makeUpdates(texts: string[]): { doc: Y.Doc; updates: Uint8Array[] } {
	const doc = new Y.Doc();
	const updates: Uint8Array[] = [];
	doc.on('update', (u: Uint8Array) => updates.push(u));
	const ytext = doc.getText('content');
	for (const t of texts) ytext.insert(ytext.length, t);
	return { doc, updates };
}

const textOf = (update: Uint8Array) => {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, update);
	return doc.getText('content').toString();
};

describe('shouldCompact', () => {
	it('動作中は 50 件以上、閉じる時は 10 件以上', () => {
		expect(shouldCompact(49, 'active')).toBe(false);
		expect(shouldCompact(50, 'active')).toBe(true);
		expect(shouldCompact(9, 'close')).toBe(false);
		expect(shouldCompact(10, 'close')).toBe(true);
		expect(shouldCompact(0, 'close')).toBe(false);
	});
});

describe('selectDeletableUpdates', () => {
	it('適用済みの updates だけを選び、未適用は絶対に含めない', () => {
		const applied = new Set(['a', 'b', 'c']);
		expect(selectDeletableUpdates(applied, ['a', 'x', 'b', 'y'])).toEqual(['a', 'b']);
		expect(selectDeletableUpdates(new Set(), ['a', 'b'])).toEqual([]);
	});
});

describe('mergePending / groupUpdates', () => {
	it('未送信が無ければ null、1 件ならそのまま、複数なら 1 つにまとめる', () => {
		const { updates } = makeUpdates(['あ', 'い', 'う']);
		expect(mergePending([])).toBeNull();
		expect(mergePending([updates[0]])).toBe(updates[0]);
		expect(textOf(mergePending(updates)!)).toBe('あいう');
	});

	it('上限以下ならまとめて 1 件、超えるなら分ける', () => {
		const { updates } = makeUpdates(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)]);
		const one = groupUpdates(updates, 1_000_000);
		expect(one).toHaveLength(1);
		expect(one[0].n).toBe(3);
		expect(textOf(one[0].update)).toBe('a'.repeat(100) + 'b'.repeat(100) + 'c'.repeat(100));

		const split = groupUpdates(updates, updates[0].length + 1);
		expect(split.length).toBe(3);
		expect(split.reduce((n, g) => n + g.n, 0)).toBe(3);
	});

	it('単独で上限を超える更新も、そのまま 1 件として残す', () => {
		const { updates } = makeUpdates(['x'.repeat(500)]);
		const groups = groupUpdates(updates, 10);
		expect(groups).toHaveLength(1);
		expect(groups[0].update).toBe(updates[0]);
	});
});

describe('retryDelay / listenSince', () => {
	it('再試行は指数的に延び、60 秒で頭打ち', () => {
		expect(retryDelay(1)).toBe(3000);
		expect(retryDelay(2)).toBe(6000);
		expect(retryDelay(3)).toBe(12000);
		expect(retryDelay(20)).toBe(60000);
	});

	it('購読の開始位置は時計のずれの分だけ巻き戻す(0 未満にならない)', () => {
		expect(listenSince(0)).toBe(0);
		expect(listenSince(CLOCK_SKEW_MARGIN_MS + 10)).toBe(10);
	});
});

describe('Yjs の更新の性質(経路が依存する前提)', () => {
	it('順不同・重複して適用しても同じ本文に収束する', () => {
		const a = new Y.Doc();
		const ta = a.getText('content');
		const updates: Uint8Array[] = [];
		a.on('update', (u: Uint8Array) => updates.push(u));
		ta.insert(0, '吾輩は猫である');
		ta.insert(3, '黒い');
		ta.delete(0, 1);

		const b = new Y.Doc();
		for (const u of [updates[2], updates[0], updates[1], updates[1], updates[2], updates[0]]) {
			Y.applyUpdate(b, u);
		}
		expect(b.getText('content').toString()).toBe(ta.toString());
	});

	it('2 つの文書が模擬チャネルで更新を交換すると収束する(同時編集・絵文字を含む)', () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		const queueAtoB: Uint8Array[] = [];
		const queueBtoA: Uint8Array[] = [];
		a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && queueAtoB.push(u));
		b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && queueBtoA.push(u));
		const ta = a.getText('content');
		const tb = b.getText('content');

		ta.insert(0, 'こんにちは');
		Y.applyUpdate(b, queueAtoB.shift()!, 'remote');
		// 同時編集
		ta.insert(5, '、世界😀');
		tb.insert(0, '【B】');
		tb.delete(3, 1);
		// 逆順・重複で配送
		const fromB = [...queueBtoA];
		for (const u of [...fromB].reverse()) Y.applyUpdate(a, u, 'remote');
		for (const u of queueAtoB) Y.applyUpdate(b, u, 'remote');
		for (const u of fromB) Y.applyUpdate(a, u, 'remote');

		expect(ta.toString()).toBe(tb.toString());
		expect(ta.toString()).toContain('😀');
	});

	it('全状態(圧縮後の snapshot)に未適用の更新を重ねても冪等', () => {
		const a = new Y.Doc();
		const ta = a.getText('content');
		const updates: Uint8Array[] = [];
		a.on('update', (u: Uint8Array) => updates.push(u));
		ta.insert(0, 'abc');
		ta.insert(3, 'def');
		const snapshot = Y.encodeStateAsUpdate(a);

		const c = new Y.Doc();
		Y.applyUpdate(c, snapshot);
		for (const u of updates) Y.applyUpdate(c, u);
		expect(c.getText('content').toString()).toBe('abcdef');
	});
});
