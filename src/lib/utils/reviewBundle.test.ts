import { describe, expect, it } from 'vitest';
import type { Chapter, Character, Plot, Scene, Worldbuilding } from '$lib/types';
import { buildReviewBundle, REVIEW_PROMPT, type ReviewBundleInput } from './reviewBundle';

const base = { createdAt: 0, updatedAt: 0, _version: 1 };

const chapters: Chapter[] = [
	{ id: 'c2', projectId: 'p', title: '旅立ち', order: 1, synopsis: '二章のあらすじ', ...base },
	{ id: 'c1', projectId: 'p', title: '出会い', order: 0, synopsis: '', ...base }
];
const scene = (id: string, chapterId: string, order: number, content: string): Scene => ({
	id,
	chapterId,
	projectId: 'p',
	title: `S${id}`,
	content,
	order,
	characterCount: content.length,
	tags: [],
	...base
});
const scenes: Scene[] = [
	scene('s3', 'c2', 0, '三つ目。'),
	scene('s2', 'c1', 1, '二つ目。'),
	scene('s1', 'c1', 0, '紅蓮《ぐれん》の空。《《強調》》')
];
const characters: Character[] = [
	{
		id: 'h1',
		projectId: 'p',
		name: '架',
		role: '主人公',
		age: 17,
		appearance: '黒髪',
		personality: '無口',
		background: '',
		relationships: [{ characterId: 'h2', relation: '幼なじみ' }],
		...base
	},
	{
		id: 'h2',
		projectId: 'p',
		name: '澪',
		role: '',
		appearance: '',
		personality: '',
		background: '',
		relationships: [],
		...base
	}
];
const worldbuilding: Worldbuilding[] = [
	{
		id: 'w1',
		projectId: 'p',
		category: 'term',
		title: '空の民',
		content: '雲の上に住む。',
		tags: [],
		attachments: [],
		...base
	}
];
const plots: Plot[] = [
	{
		id: 'pl1',
		projectId: 'p',
		title: '再会',
		type: 'scene',
		status: 'planned',
		content: '',
		position: { x: 0, y: 0 },
		color: '',
		...base
	}
];

const input: ReviewBundleInput = {
	project: { title: '空の物語', description: '雲の上の話' },
	chapters,
	scenes,
	characters,
	worldbuilding,
	plots
};
const opts = {
	scope: 'work' as const,
	plainText: true,
	includeSettings: false,
	includePrompt: false
};

describe('buildReviewBundle', () => {
	it('章とシーンを order 順に並べ、ルビ・傍点を取り除く', () => {
		const r = buildReviewBundle(input, opts);
		expect(r.text.indexOf('出会い')).toBeLessThan(r.text.indexOf('旅立ち'));
		expect(r.text.indexOf('紅蓮の空。強調')).toBeLessThan(r.text.indexOf('二つ目。'));
		expect(r.text).not.toContain('《');
		expect(r.chapterCount).toBe(2);
		expect(r.sceneCount).toBe(3);
	});

	it('plainText が false ならルビ記法を残す', () => {
		const r = buildReviewBundle(input, { ...opts, plainText: false });
		expect(r.text).toContain('紅蓮《ぐれん》の空。《《強調》》');
	});

	it('章だけ出すとき、章番号は作品全体の位置のまま', () => {
		const r = buildReviewBundle(input, { ...opts, scope: 'chapter', chapterId: 'c2' });
		expect(r.text).toContain('第2章 旅立ち');
		expect(r.text).not.toContain('出会い');
		expect(r.text).toContain('第2章「旅立ち」のみ');
		expect(r.chapterCount).toBe(1);
		expect(r.sceneCount).toBe(1);
	});

	it('sceneTexts があれば scene.content より優先する', () => {
		const r = buildReviewBundle(
			{ ...input, sceneTexts: new Map([['s3', 'CRDT の本文']]) },
			{ ...opts, scope: 'chapter', chapterId: 'c2' }
		);
		expect(r.text).toContain('CRDT の本文');
		expect(r.text).not.toContain('三つ目。');
	});

	it('設定を含めると、人物・設定資料・プロット・あらすじが前置きに入る', () => {
		const r = buildReviewBundle(input, { ...opts, includeSettings: true });
		expect(r.text).toContain('作品の設定');
		expect(r.text).toContain('#### 架(主人公 / 17歳)');
		expect(r.text).toContain('- 関係: 澪(幼なじみ)');
		expect(r.text).toContain('##### 空の民');
		expect(r.text).toContain('- 再会(シーン・構想済み)');
		expect(r.text).toContain('第2章 旅立ち: 二章のあらすじ');
		expect(r.text.indexOf('作品の設定')).toBeLessThan(r.text.indexOf('本文(添削の対象)'));
	});

	it('設定を含めなければ、設定の節は出ない', () => {
		expect(buildReviewBundle(input, opts).text).not.toContain('作品の設定');
	});

	it('依頼文は先頭に付き、bodyChars には含まれない', () => {
		const withPrompt = buildReviewBundle(input, { ...opts, includePrompt: true });
		const without = buildReviewBundle(input, opts);
		expect(withPrompt.text.startsWith(REVIEW_PROMPT)).toBe(true);
		expect(withPrompt.bodyChars).toBe(without.bodyChars);
		expect(withPrompt.totalChars).toBeGreaterThan(without.totalChars);
	});

	it('章が空でも壊れない', () => {
		const r = buildReviewBundle(
			{ ...input, chapters: [], scenes: [] },
			{ ...opts, includeSettings: true }
		);
		expect(r.sceneCount).toBe(0);
		expect(r.text).toContain('# 空の物語');
	});
});
