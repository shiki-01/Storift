import { describe, expect, it } from 'vitest';
import {
	PRESENCE_TTL_MS,
	activePresence,
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
	it('形が違えば null', () => {
		expect(parsePresence('u', { name: 1, updatedAt: 1 })).toBeNull();
		expect(parsePresence('u', { name: 'A' })).toBeNull();
		expect(parsePresence('u', { name: 'A', updatedAt: 'x' })).toBeNull();
	});
});
