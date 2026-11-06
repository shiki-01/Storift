import { describe, it, expect } from 'vitest';
import type { Chapter, Scene } from '$lib/types';
import {
	buildManuscript,
	estimateLines,
	isSameSource,
	progressAt,
	ORPHAN_CHAPTER_ID
} from './manuscript';

function chapter(id: string, order: number, title = id): Chapter {
	return {
		id,
		projectId: 'p',
		title,
		order,
		synopsis: '',
		createdAt: order,
		updatedAt: order,
		_version: 1
	};
}

function scene(id: string, chapterId: string, order: number, content: string, title = id): Scene {
	return {
		id,
		chapterId,
		projectId: 'p',
		title,
		content,
		order,
		characterCount: content.length,
		tags: [],
		createdAt: order,
		updatedAt: order,
		_version: 1
	};
}

describe('buildManuscript', () => {
	it('章とシーンを order 順に並べる(入力順に依存しない)', () => {
		const m = buildManuscript(
			[chapter('c2', 1), chapter('c1', 0)],
			[scene('s3', 'c2', 0, 'ccc'), scene('s2', 'c1', 1, 'bb'), scene('s1', 'c1', 0, 'a')]
		);
		expect(m.chapters.map((c) => c.id)).toEqual(['c1', 'c2']);
		expect(m.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
		expect(m.scenes.map((s) => s.index)).toEqual([0, 1, 2]);
		expect(m.sceneIndexById.get('s3')).toBe(2);
		expect(m.chapters[0].scenes.map((s) => s.indexInChapter)).toEqual([0, 1]);
	});

	it('order が同じなら作成日時、ID の順で安定して並べる', () => {
		const a = { ...scene('b', 'c', 0, ''), createdAt: 5 };
		const b = { ...scene('a', 'c', 0, ''), createdAt: 5 };
		const c = { ...scene('z', 'c', 0, ''), createdAt: 1 };
		const m = buildManuscript([chapter('c', 0)], [a, b, c]);
		expect(m.scenes.map((s) => s.id)).toEqual(['z', 'a', 'b']);
	});

	it('空の章と本文が空のシーンを扱える', () => {
		const m = buildManuscript(
			[chapter('c1', 0), chapter('c2', 1)],
			[scene('s1', 'c2', 0, ''), scene('s2', 'c2', 1, '  \n ')]
		);
		expect(m.chapters[0].scenes).toEqual([]);
		expect(m.chapters[0].charCount).toBe(0);
		expect(m.scenes.map((s) => s.isEmpty)).toEqual([true, true]);
		expect(m.toc[0].scenes).toEqual([]);
		expect(m.totalChars).toBe(4);
	});

	it('入力が空でも落ちない', () => {
		const m = buildManuscript([], []);
		expect(m.chapters).toEqual([]);
		expect(m.totalChars).toBe(0);
	});

	it('章に属さないシーンは最後の擬似章にまとめる', () => {
		const m = buildManuscript(
			[chapter('c1', 0)],
			[scene('o2', 'gone', 1, 'yy'), scene('s1', 'c1', 0, 'x'), scene('o1', 'gone', 0, 'zzz')],
			{ orphanChapterTitle: '孤立' }
		);
		expect(m.chapters.map((c) => c.id)).toEqual(['c1', ORPHAN_CHAPTER_ID]);
		const orphan = m.chapters[1];
		expect(orphan.orphan).toBe(true);
		expect(orphan.title).toBe('孤立');
		expect(orphan.scenes.map((s) => s.id)).toEqual(['o1', 'o2']);
		expect(m.chapters[0].orphan).toBe(false);
	});

	it('孤立シーンが無ければ擬似章は作らない', () => {
		const m = buildManuscript([chapter('c1', 0)], [scene('s1', 'c1', 0, 'x')]);
		expect(m.chapters).toHaveLength(1);
	});

	it('ID が重複した項目は最初の 1 つだけ使う', () => {
		const m = buildManuscript(
			[chapter('c1', 0), chapter('c1', 1)],
			[scene('s1', 'c1', 0, 'a'), scene('s1', 'c1', 1, 'bbb')]
		);
		expect(m.chapters).toHaveLength(1);
		expect(m.scenes).toHaveLength(1);
		expect(m.totalChars).toBe(1);
	});

	it('題名が空のときは既定の表示名にする', () => {
		const m = buildManuscript([chapter('c1', 0, ' ')], [scene('s1', 'c1', 0, 'a', '')]);
		expect(m.chapters[0].title).toBe('無題の章');
		expect(m.scenes[0].title).toBe('無題のシーン');
	});

	it('文字数と累計(シーン・章)を計算する', () => {
		const m = buildManuscript(
			[chapter('c1', 0), chapter('c2', 1)],
			[scene('s1', 'c1', 0, 'abc'), scene('s2', 'c1', 1, 'de'), scene('s3', 'c2', 0, 'fghij')]
		);
		expect(m.scenes.map((s) => [s.charCount, s.startChars])).toEqual([
			[3, 0],
			[2, 3],
			[5, 5]
		]);
		expect(m.chapters.map((c) => [c.charCount, c.startChars])).toEqual([
			[5, 0],
			[5, 5]
		]);
		expect(m.totalChars).toBe(10);
		expect(m.toc[1].scenes[0]).toMatchObject({ id: 's3', startChars: 5, charCount: 5 });
	});

	it('ルビ記法を含む文字数: 既定は記法ごと、excludeRubyFromCount で本文だけ', () => {
		const content = '漢字《かんじ》と｜傍点《ぼう》と《《強調》》';
		const scenes = [scene('s1', 'c1', 0, content)];
		const raw = buildManuscript([chapter('c1', 0)], scenes);
		expect(raw.totalChars).toBe(content.length);
		const plain = buildManuscript([chapter('c1', 0)], scenes, { excludeRubyFromCount: true });
		expect(plain.totalChars).toBe('漢字と傍点と強調'.length);
	});

	it('数万シーンでもほぼ線形の時間で作れる', () => {
		const build = (chapterCount: number, perChapter: number) => {
			const chapters: Chapter[] = [];
			const scenes: Scene[] = [];
			for (let c = 0; c < chapterCount; c++) {
				chapters.push(chapter(`c${c}`, c));
				for (let s = 0; s < perChapter; s++) {
					scenes.push(scene(`s${c}-${s}`, `c${c}`, s, 'あ'.repeat(10)));
				}
			}
			const start = performance.now();
			const m = buildManuscript(chapters, scenes);
			return { ms: performance.now() - start, m };
		};
		const small = build(100, 100); // 1 万シーン
		const large = build(400, 100); // 4 万シーン
		expect(large.m.scenes).toHaveLength(40000);
		expect(large.m.totalChars).toBe(400_000);
		expect(large.m.scenes[39999].startChars).toBe(399_990);
		// 4 倍のデータが 4 倍より大きく悪化しない(余裕を持たせた判定)
		expect(large.ms).toBeLessThan(Math.max(small.ms, 20) * 12);
		expect(large.ms).toBeLessThan(3000);
	});
});

describe('progressAt', () => {
	const m = buildManuscript(
		[chapter('c1', 0)],
		[scene('s1', 'c1', 0, 'a'.repeat(30)), scene('s2', 'c1', 1, 'b'.repeat(70))]
	);

	it('シーン内の割合から累計文字数と進捗を求める', () => {
		expect(progressAt(m, 0, 0)).toEqual({ fraction: 0, readChars: 0, totalChars: 100 });
		expect(progressAt(m, 1, 0)).toEqual({ fraction: 0.3, readChars: 30, totalChars: 100 });
		expect(progressAt(m, 1, 0.5)).toEqual({ fraction: 0.65, readChars: 65, totalChars: 100 });
		expect(progressAt(m, 1, 1).fraction).toBe(1);
	});

	it('範囲外や不正な値は丸める', () => {
		expect(progressAt(m, 99, 5).readChars).toBe(100);
		expect(progressAt(m, -3, -1).readChars).toBe(0);
		expect(progressAt(m, 0, NaN).readChars).toBe(0);
	});

	it('総文字数が 0 でも 0 を返す', () => {
		const empty = buildManuscript([chapter('c', 0)], [scene('s', 'c', 0, '')]);
		expect(progressAt(empty, 0, 0.5)).toEqual({ fraction: 0, readChars: 0, totalChars: 0 });
		expect(progressAt(buildManuscript([], []), 0, 0).fraction).toBe(0);
	});
});

describe('estimateLines', () => {
	it('段落ごとに折り返し行数を数え、空行も 1 行とする', () => {
		expect(estimateLines('', 10)).toBe(1);
		expect(estimateLines('あ'.repeat(10), 10)).toBe(1);
		expect(estimateLines('あ'.repeat(11), 10)).toBe(2);
		expect(estimateLines('あ\n\nい', 10)).toBe(3);
		expect(estimateLines('あ\n', 10)).toBe(2);
	});

	it('1 行の文字数が 0 以下でも落ちない', () => {
		expect(estimateLines('abc', 0)).toBe(3);
	});
});

describe('isSameSource', () => {
	const base = () => ({
		chapters: [chapter('c1', 0)],
		scenes: [scene('s1', 'c1', 0, 'abc'), scene('s2', 'c1', 1, 'de')]
	});

	it('表示に影響する項目が同じなら true(別インスタンスでも)', () => {
		expect(isSameSource(base(), base())).toBe(true);
	});

	it('本文・題名・順序・所属・件数が違えば false', () => {
		const changed = (fn: (d: ReturnType<typeof base>) => void) => {
			const d = base();
			fn(d);
			return isSameSource(base(), d);
		};
		expect(changed((d) => (d.scenes[1].content = 'dX'))).toBe(false);
		expect(changed((d) => (d.scenes[0].title = 'new'))).toBe(false);
		expect(changed((d) => (d.scenes[0].order = 5))).toBe(false);
		expect(changed((d) => (d.scenes[0].chapterId = 'c2'))).toBe(false);
		expect(changed((d) => (d.chapters[0].title = 'new'))).toBe(false);
		expect(changed((d) => d.scenes.pop())).toBe(false);
	});
});
