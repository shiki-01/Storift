import { describe, expect, it } from 'vitest';
import type { Character } from '$lib/types';
import {
	applyOrderUpdates,
	avatarTone,
	canReorderCharacters,
	characterSummary,
	filterCharacters,
	initialOf,
	planCharacterMove,
	sortCharacters,
	visibleCharacters
} from './characterList';

const ch = (id: string, over: Partial<Character> = {}): Character => ({
	id,
	projectId: 'p',
	name: id,
	role: '',
	appearance: '',
	personality: '',
	background: '',
	relationships: [],
	createdAt: 1,
	updatedAt: 1,
	_version: 1,
	...over
});

const sample = [
	ch('a', {
		name: 'アキラ',
		role: '主人公',
		personality: '無口で優しい',
		order: 3000,
		updatedAt: 10
	}),
	ch('b', {
		name: 'ユキ',
		role: 'ヒロイン',
		background: '雪国の生まれ',
		order: 1000,
		updatedAt: 30
	}),
	ch('c', { name: 'ケイ', role: '悪役', appearance: '長身で眼鏡', order: 2000, updatedAt: 20 })
];

describe('filterCharacters', () => {
	it('空の検索語は全件', () => {
		expect(filterCharacters(sample, '  ')).toHaveLength(3);
	});
	it('名前・役割・外見・性格・背景のどれでも見つかる(大文字小文字は区別しない)', () => {
		expect(filterCharacters(sample, 'ユキ').map((c) => c.id)).toEqual(['b']);
		expect(filterCharacters(sample, '悪役').map((c) => c.id)).toEqual(['c']);
		expect(filterCharacters(sample, '眼鏡').map((c) => c.id)).toEqual(['c']);
		expect(filterCharacters(sample, '優しい').map((c) => c.id)).toEqual(['a']);
		expect(filterCharacters(sample, '雪国').map((c) => c.id)).toEqual(['b']);
		expect(filterCharacters([ch('x', { name: 'Ann' })], 'aNN')).toHaveLength(1);
	});
	it('一致しなければ空', () => {
		expect(filterCharacters(sample, 'zzz')).toEqual([]);
	});
});

describe('sortCharacters / visibleCharacters', () => {
	it('手動順は order の昇順', () => {
		expect(sortCharacters(sample, 'manual').map((c) => c.id)).toEqual(['b', 'c', 'a']);
	});
	it('名前順は五十音順', () => {
		expect(sortCharacters(sample, 'name').map((c) => c.name)).toEqual(['アキラ', 'ケイ', 'ユキ']);
	});
	it('更新日順は新しい順', () => {
		expect(sortCharacters(sample, 'updated').map((c) => c.id)).toEqual(['b', 'c', 'a']);
	});
	it('元の配列は変えない', () => {
		const copy = [...sample];
		sortCharacters(sample, 'name');
		expect(sample).toEqual(copy);
	});
	it('検索してから並べる', () => {
		expect(visibleCharacters(sample, { query: 'ー', sort: 'manual' }).map((c) => c.id)).toEqual([]);
		expect(visibleCharacters(sample, { query: '長身', sort: 'name' }).map((c) => c.id)).toEqual([
			'c'
		]);
	});
});

describe('canReorderCharacters', () => {
	it('手動順・検索なし・閲覧専用でないときだけ', () => {
		expect(canReorderCharacters({ readOnly: false, sort: 'manual', query: '' })).toBe(true);
		expect(canReorderCharacters({ readOnly: false, sort: 'manual', query: ' ' })).toBe(true);
		expect(canReorderCharacters({ readOnly: false, sort: 'manual', query: 'a' })).toBe(false);
		expect(canReorderCharacters({ readOnly: false, sort: 'name', query: '' })).toBe(false);
		expect(canReorderCharacters({ readOnly: true, sort: 'manual', query: '' })).toBe(false);
	});
});

describe('characterSummary / initialOf / avatarTone', () => {
	it('あるものだけを「 ・ 」でつなぐ', () => {
		expect(characterSummary({ role: '主人公', age: 17, gender: '女性' })).toBe(
			'主人公 ・ 17歳 ・ 女性'
		);
		expect(characterSummary({ role: '', age: 17, gender: undefined })).toBe('17歳');
		expect(characterSummary({ role: '', age: undefined, gender: '' })).toBe('');
	});
	it('イニシャルは先頭の 1 文字(サロゲートペアも 1 文字)', () => {
		expect(initialOf('  アキラ')).toBe('ア');
		expect(initialOf('𠮷野')).toBe('𠮷');
		expect(initialOf('')).toBe('?');
	});
	it('色は id から決まり、同じ id は同じ色', () => {
		expect(avatarTone('abc')).toBe(avatarTone('abc'));
		const tones = new Set(Array.from({ length: 40 }, (_, i) => avatarTone(`id-${i}`)));
		expect(tones.size).toBeGreaterThan(2);
	});
});

describe('planCharacterMove / applyOrderUpdates', () => {
	it('1 件だけ order を書く更新になり、反映すると並びが変わる', () => {
		const manual = sortCharacters(sample, 'manual'); // b, c, a
		const updates = planCharacterMove(manual, 'a', 0);
		expect(updates).toHaveLength(1);
		expect(updates[0].id).toBe('a');
		const next = sortCharacters(applyOrderUpdates(manual, updates), 'manual');
		expect(next.map((c) => c.id)).toEqual(['a', 'b', 'c']);
		expect(manual.map((c) => c.id)).toEqual(['b', 'c', 'a']);
	});
	it('位置が変わらなければ空', () => {
		expect(planCharacterMove(sortCharacters(sample, 'manual'), 'b', 0)).toEqual([]);
	});
});
