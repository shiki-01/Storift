import { describe, it, expect } from 'vitest';
import { addMemo, removeMemo, loadMemos, saveMemos } from './memos';

function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k),
		clear: () => map.clear(),
		key: () => null,
		get length() {
			return map.size;
		}
	} as Storage;
}

describe('memos', () => {
	it('空白だけのメモは追加しない', () => {
		expect(addMemo([], '   ')).toEqual([]);
	});

	it('新しいメモが先頭に来る', () => {
		const a = addMemo([], 'first', 1);
		const b = addMemo(a, 'second', 2);
		expect(b.map((m) => m.text)).toEqual(['second', 'first']);
	});

	it('削除できる', () => {
		const list = addMemo(addMemo([], 'a', 1), 'b', 2);
		expect(removeMemo(list, list[0].id)).toHaveLength(1);
	});

	it('プロジェクトごとに保存・復元できる', () => {
		const s = fakeStorage();
		saveMemos('p1', addMemo([], 'x', 1), s);
		expect(loadMemos('p1', s)).toHaveLength(1);
		expect(loadMemos('p2', s)).toEqual([]);
	});

	it('壊れた保存データは空として扱う', () => {
		const s = fakeStorage();
		s.setItem('storift:memos:p1', '{broken');
		expect(loadMemos('p1', s)).toEqual([]);
	});
});
