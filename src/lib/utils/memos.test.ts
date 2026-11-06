import { describe, it, expect } from 'vitest';
import {
	buildTodoPrompt,
	extractTags,
	filterMemos,
	legacyProjectId,
	makeAnchor,
	mergeTags,
	normalizeTag,
	parseLegacyMemos,
	reanchorMemos,
	rangeTextOffsets,
	resolveAnchor,
	textOffsetAt
} from './memos';
import type { Memo } from '$lib/types';

function memo(overrides: Partial<Memo> & { id: string }): Memo {
	return {
		projectId: 'p1',
		text: 'x',
		tags: [],
		done: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides
	};
}

describe('旧メモの移行', () => {
	it('旧形式を新しいメモにし、本文の #タグ をタグにする', () => {
		const raw = JSON.stringify([{ id: 'a', text: '伏線を張る #伏線', createdAt: 10 }]);
		expect(parseLegacyMemos(raw, 'p1')).toEqual([
			{
				id: 'a',
				projectId: 'p1',
				text: '伏線を張る #伏線',
				tags: ['伏線'],
				done: false,
				createdAt: 10,
				updatedAt: 10
			}
		]);
	});

	it('壊れた要素と空の本文は捨て、壊れた JSON は空にする', () => {
		const raw = JSON.stringify([
			{ id: 'a', text: '  ', createdAt: 1 },
			{ nope: true },
			{ id: 'b', text: 'ok' }
		]);
		const memos = parseLegacyMemos(raw, 'p1', 99);
		expect(memos.map((m) => m.id)).toEqual(['b']);
		expect(memos[0].createdAt).toBe(99);
		expect(parseLegacyMemos('{broken', 'p1')).toEqual([]);
		expect(parseLegacyMemos('{"a":1}', 'p1')).toEqual([]);
	});

	it('localStorage のキーから作品 ID を取り出す', () => {
		expect(legacyProjectId('storift:memos:abc')).toBe('abc');
		expect(legacyProjectId('storift:memos:')).toBeNull();
		expect(legacyProjectId('storift:claude-panel')).toBeNull();
	});
});

describe('タグ', () => {
	it('タグを整える(#・空白を除き小文字にする)', () => {
		expect(normalizeTag('  #ToDo ')).toBe('todo');
		expect(normalizeTag('  ')).toBe('');
	});

	it('本文の #タグ を抜き出す。直前が文字なら対象外', () => {
		expect(extractTags('今日は#伏線 と #要確認\n#TODO 次')).toEqual(['伏線', '要確認', 'todo']);
		expect(extractTags('a#b C#言語 http://x/#y')).toEqual([]);
	});

	it('手入力と本文のタグを重複なくまとめる', () => {
		expect(mergeTags(['todo', ' '], '#todo #アイデア')).toEqual(['todo', 'アイデア']);
	});
});

describe('範囲', () => {
	it('引用は 200 文字までにし、範囲は選択のまま残す', () => {
		const content = 'あ'.repeat(300);
		const anchor = makeAnchor(content, 10, 260);
		expect(anchor.start).toBe(10);
		expect(anchor.end).toBe(260);
		expect(anchor.quote).toHaveLength(200);
	});

	it('元の位置に引用があればそのまま使う', () => {
		const anchor = { start: 2, end: 4, quote: 'cd' };
		expect(resolveAnchor('abcdef', anchor)).toEqual({ start: 2, end: 4 });
	});

	it('前に文字が増えてずれたら、元の位置の近くで再アンカーする', () => {
		const anchor = { start: 2, end: 4, quote: 'cd' };
		expect(resolveAnchor('XXXabcdef', anchor)).toEqual({ start: 5, end: 7 });
	});

	it('近くに無ければ全文の最初の一致を使う', () => {
		const anchor = { start: 900, end: 902, quote: 'cd' };
		expect(resolveAnchor('cd' + 'x'.repeat(1000), anchor)).toEqual({ start: 0, end: 2 });
		// 近く(500 文字以内)の一致があれば、遠い先頭の一致より優先する
		expect(resolveAnchor('cd' + 'x'.repeat(1000) + 'cd', anchor)).toEqual({
			start: 1002,
			end: 1004
		});
	});

	it('どこにも無ければ null(位置不明)', () => {
		expect(resolveAnchor('abc', { start: 0, end: 2, quote: 'zz' })).toBeNull();
		expect(resolveAnchor('abc', { start: 0, end: 0, quote: '' })).toBeNull();
	});

	it('DOM の点を本文のオフセットにする(<br> と 2 つ目以降の <div> は改行 1 文字)', () => {
		const root = document.createElement('div');
		root.innerHTML = 'ab<br>cd<div>ef</div>';
		const text = root.childNodes[0];
		const cd = root.childNodes[2];
		// 本文は "ab\ncd\nef"
		expect(textOffsetAt(root, cd, 1)).toBe(4);
		expect(textOffsetAt(root, root.childNodes[3].childNodes[0], 1)).toBe(7);
		expect(textOffsetAt(root, text, 2)).toBe(2);
		expect(textOffsetAt(document.createElement('p'), cd, 0)).toBeNull();
	});

	it('選択範囲を本文のオフセットにする', () => {
		const root = document.createElement('div');
		root.innerHTML = 'ab<br>cd';
		const range = document.createRange();
		range.setStart(root.childNodes[2], 0);
		range.setEnd(root.childNodes[2], 2);
		expect(rangeTextOffsets(root, range)).toEqual({ start: 3, end: 5 });
	});
});

describe('AI への依頼文', () => {
	it('番号付きで、シーン名と引用を添える', () => {
		const prompt = buildTodoPrompt([
			{ text: '年齢を決める', sceneTitle: '第一章', quote: '彼は十七歳だった' },
			{ text: '二行目あり\n続き' }
		]);
		expect(prompt).toContain('以下の TODO を順に対応してください。');
		expect(prompt).toContain(
			'1. 年齢を決める\n   - シーン: 第一章\n   - 本文の引用: 「彼は十七歳だった」'
		);
		expect(prompt).toContain('2. 二行目あり\n   続き');
	});
});

describe('filterMemos', () => {
	const memos = [
		memo({ id: 'old', sceneId: 's1', tags: ['アイデア'], createdAt: 1 }),
		memo({ id: 'todo', sceneId: 's2', tags: ['todo'], text: '直す', createdAt: 3 }),
		memo({ id: 'done', sceneId: 's1', tags: ['todo'], done: true, createdAt: 2 }),
		memo({
			id: 'quoted',
			sceneId: 's1',
			tags: [],
			text: 'x',
			anchor: { start: 0, end: 2, quote: '雨の夜' },
			createdAt: 4
		})
	];

	it('作成の新しい順になり、シーンで絞り込める', () => {
		expect(filterMemos(memos, { scope: 'scene', sceneId: 's1' }).map((m) => m.id)).toEqual([
			'quoted',
			'done',
			'old'
		]);
		expect(filterMemos(memos, { scope: 'all' })).toHaveLength(4);
	});

	it('タグ・未完了・全文検索(引用も対象)で絞り込める', () => {
		expect(filterMemos(memos, { scope: 'all', tag: 'todo' }).map((m) => m.id)).toEqual([
			'todo',
			'done'
		]);
		expect(
			filterMemos(memos, { scope: 'all', tag: 'todo', openOnly: true }).map((m) => m.id)
		).toEqual(['todo']);
		expect(filterMemos(memos, { scope: 'all', query: '雨' }).map((m) => m.id)).toEqual(['quoted']);
	});
});

describe('reanchorMemos', () => {
	const m = (id: string, start: number, end: number, quote: string) => ({
		id,
		anchor: { start, end, quote }
	});

	it('位置がずれたメモだけ、新しい範囲を返す', () => {
		const text = '前置き。吾輩は猫である。名前はまだ無い。';
		const updates = reanchorMemos(text, [
			m('moved', 0, 7, '吾輩は猫である'),
			m('same', 4, 11, '吾輩は猫である')
		]);
		expect(updates).toEqual([
			{ id: 'moved', anchor: { start: 4, end: 11, quote: '吾輩は猫である' } }
		]);
	});

	it('見つからないメモ(孤立)は何も返さず、範囲を書き換えない', () => {
		expect(reanchorMemos('全く別の本文', [m('lost', 0, 3, '吾輩は')])).toEqual([]);
	});

	it('範囲の無いメモは対象外', () => {
		expect(reanchorMemos('本文', [{ id: 'plain', anchor: undefined }])).toEqual([]);
	});
});
