import { describe, expect, it } from 'vitest';
import {
	PRESENCE_TTL_MS,
	activePresence,
	cursorsOnScene,
	defaultDisplayName,
	parsePresence,
	presenceColor,
	presenceLabel,
	resolveDisplayName,
	type PresenceEntry
} from './presencePolicy';

const entry = (uid: string, name: string, updatedAt: number, sceneId: string | null = 's1') =>
	({ uid, name, color: presenceColor(uid), sceneId, updatedAt }) satisfies PresenceEntry;

describe('presenceColor', () => {
	it('同じ uid は同じ色、違う uid は(ほぼ)違う色', () => {
		expect(presenceColor('abc')).toBe(presenceColor('abc'));
		expect(presenceColor('abc')).not.toBe(presenceColor('abd'));
		expect(presenceColor('abc')).toMatch(/^hsl\(\d+, 65%, 45%\)$/);
	});
});

describe('表示名', () => {
	it('既定: オーナーは「オーナー」、ゲストは「ゲスト-先頭4文字」', () => {
		expect(defaultDisplayName('owner', 'abcdefgh')).toBe('オーナー');
		expect(defaultDisplayName('editor', 'abcdefgh')).toBe('ゲスト-abcd');
		expect(defaultDisplayName('viewer', 'xy')).toBe('ゲスト-xy');
	});

	it('設定があれば優先し、空白だけなら既定に戻す', () => {
		expect(resolveDisplayName(' 太郎 ', 'editor', 'abcdefgh')).toBe('太郎');
		expect(resolveDisplayName('  ', 'owner', 'abcdefgh')).toBe('オーナー');
		expect(resolveDisplayName(undefined, 'editor', 'abcdefgh')).toBe('ゲスト-abcd');
	});
});

describe('activePresence', () => {
	const now = 1_000_000;
	it('自分を除き、90 秒以内のものだけ残す', () => {
		const result = activePresence(
			[
				entry('me', '自分', now),
				entry('a', 'A', now - 10_000),
				entry('b', 'B', now - PRESENCE_TTL_MS),
				entry('c', 'C', now - PRESENCE_TTL_MS - 1)
			],
			'me',
			now
		);
		expect(result.map((e) => e.uid)).toEqual(['a', 'b']);
	});

	it('名前順に並べる', () => {
		const result = activePresence([entry('1', 'ゆき', now), entry('2', 'あき', now)], 'x', now);
		expect(result.map((e) => e.name)).toEqual(['あき', 'ゆき']);
	});
});

describe('presenceLabel', () => {
	it('0 人なら null、複数なら人数と名前', () => {
		expect(presenceLabel([])).toBeNull();
		expect(presenceLabel([entry('a', 'A', 0), entry('b', 'B', 0)])).toBe('他 2 人が閲覧中: A, B');
	});
	it('多いときは省略する', () => {
		const many = ['A', 'B', 'C', 'D', 'E'].map((n) => entry(n, n, 0));
		expect(presenceLabel(many)).toBe('他 5 人が閲覧中: A, B, C ほか2人');
	});
});

describe('parsePresence', () => {
	it('正しい文書を読み、欠けた色は uid から補う', () => {
		const parsed = parsePresence('u1', { name: 'A', sceneId: 's', updatedAt: 5 });
		expect(parsed).toMatchObject({ uid: 'u1', name: 'A', sceneId: 's', updatedAt: 5 });
		expect(parsed?.color).toBe(presenceColor('u1'));
	});
	it('色が想定の形でなければ(style に使われるので)uid から作り直す', () => {
		const evil = parsePresence('u1', {
			name: 'A',
			color: 'red; background: url(x)',
			updatedAt: 1
		});
		expect(evil?.color).toBe(presenceColor('u1'));
		expect(
			parsePresence('u1', { name: 'A', color: 'hsl(10, 65%, 45%)', updatedAt: 1 })?.color
		).toBe('hsl(10, 65%, 45%)');
	});
	it('形が違えば null', () => {
		expect(parsePresence('u', { name: 1, updatedAt: 1 })).toBeNull();
		expect(parsePresence('u', { name: 'A' })).toBeNull();
		expect(parsePresence('u', { name: 'A', updatedAt: 'x' })).toBeNull();
	});
});

describe('カーソルの読み取り', () => {
	const rel = { type: { client: 1, clock: 2 }, assoc: 0 };

	it('cursor が正しい形なら読み、欠けていれば null', () => {
		expect(
			parsePresence('u', { name: 'A', updatedAt: 1, cursor: { anchor: rel, head: rel } })?.cursor
		).toEqual({ anchor: rel, head: rel });
		expect(parsePresence('u', { name: 'A', updatedAt: 1 })?.cursor).toBeNull();
		expect(parsePresence('u', { name: 'A', updatedAt: 1, cursor: null })?.cursor).toBeNull();
	});

	it('cursor の形が壊れていても在席自体は有効(カーソルだけ無視)', () => {
		for (const cursor of ['x', 1, [], { anchor: rel }, { anchor: rel, head: 'y' }]) {
			const parsed = parsePresence('u', { name: 'A', updatedAt: 1, cursor });
			expect(parsed).not.toBeNull();
			expect(parsed?.cursor).toBeNull();
		}
	});

	it('cursorsOnScene: 同じシーンでカーソルを持つ人だけ', () => {
		const c = { anchor: rel, head: rel };
		const list = [
			{ ...entry('a', 'A', 0, 's1'), cursor: c },
			{ ...entry('b', 'B', 0, 's2'), cursor: c },
			{ ...entry('c', 'C', 0, 's1'), cursor: null },
			entry('d', 'D', 0, 's1')
		];
		expect(cursorsOnScene(list, 's1').map((e) => e.uid)).toEqual(['a']);
		expect(cursorsOnScene(list, null)).toEqual([]);
	});

	it('90 秒を過ぎたカーソルは activePresence の段階で消える', () => {
		const c = { anchor: rel, head: rel };
		const now = 500_000;
		const list = [
			{ ...entry('a', 'A', now - 10_000), cursor: c },
			{ ...entry('b', 'B', now - PRESENCE_TTL_MS - 1), cursor: c }
		];
		expect(cursorsOnScene(activePresence(list, 'me', now), 's1').map((e) => e.uid)).toEqual(['a']);
	});
});
