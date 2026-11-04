import { describe, expect, it } from 'vitest';
import { buildWorkspace, safeName, type WorkspaceData } from './workspace';
import type { Chapter, Memo, Project, Scene } from '$lib/types';

function project(id: string, title: string, updatedAt = 1): Project {
	return {
		id,
		title,
		description: '',
		createdAt: 0,
		updatedAt,
		status: 'writing',
		settings: {
			writingMode: 'vertical',
			fontSize: 16,
			theme: 'light',
			goal: { type: 'daily', target: 1000 }
		},
		_version: 1
	};
}

function chapter(id: string, projectId: string, title: string, order: number): Chapter {
	return { id, projectId, title, order, synopsis: '', createdAt: 0, updatedAt: 0, _version: 1 };
}

function scene(
	id: string,
	chapterId: string,
	projectId: string,
	title: string,
	order: number,
	content: string
): Scene {
	return {
		id,
		chapterId,
		projectId,
		title,
		content,
		order,
		characterCount: content.length,
		tags: [],
		createdAt: 0,
		updatedAt: 0,
		_version: 1
	};
}

const empty: Omit<WorkspaceData, 'projects' | 'chapters' | 'scenes'> = {
	characters: [],
	plots: [],
	worldbuilding: [],
	memos: [],
	progressLogs: [],
	history: [],
	relationMaps: []
};

describe('safeName', () => {
	it('ファイル名に使えない文字を置き換える', () => {
		expect(safeName('a/b:c?')).toBe('a_b_c_');
		expect(safeName('  ..  ')).toBe('無題');
	});
});

describe('buildWorkspace', () => {
	it('章とシーンを順番どおりのファイルにする', () => {
		const result = buildWorkspace({
			...empty,
			projects: [project('p1', '星の物語')],
			chapters: [chapter('c2', 'p1', '二章', 1), chapter('c1', 'p1', '一章', 0)],
			scenes: [scene('s2', 'c1', 'p1', '出会い', 1, 'B'), scene('s1', 'c1', 'p1', '始まり', 0, 'A')]
		});
		expect(result.projectDirs.p1).toBe('projects/星の物語');
		expect(result.sceneFiles.s1).toBe('projects/星の物語/本文/01_一章/01_始まり.md');
		expect(result.sceneFiles.s2).toBe('projects/星の物語/本文/01_一章/02_出会い.md');
		const paths = result.files.map((f) => f.path);
		expect(paths).toContain('CLAUDE.md');
		expect(paths).toContain('projects/星の物語/概要.md');
		expect(result.files.find((f) => f.path === result.sceneFiles.s1)?.content).toBe(
			'# 始まり\n\nA\n'
		);
	});

	it('同名のプロジェクトはフォルダを分ける', () => {
		const result = buildWorkspace({
			...empty,
			projects: [project('aaaaaa1', '同名', 2), project('bbbbbb2', '同名', 1)],
			chapters: [],
			scenes: []
		});
		expect(result.projectDirs.aaaaaa1).toBe('projects/同名');
		expect(result.projectDirs.bbbbbb2).toBe('projects/同名-bbbbbb');
	});
});

describe('buildWorkspace のメモ', () => {
	const base = (memos: Memo[]): WorkspaceData => ({
		...empty,
		projects: [project('p1', '作品')],
		chapters: [chapter('c1', 'p1', '章', 0)],
		scenes: [scene('s1', 'c1', 'p1', '場面', 0, '本文')],
		memos
	});

	it('メモがあれば作品フォルダに メモ.md を書き出す(タグ・完了・引用付き)', () => {
		const result = buildWorkspace(
			base([
				{
					id: 'm1',
					projectId: 'p1',
					text: '伏線を回収する\n詳細',
					tags: ['todo', '伏線'],
					sceneId: 's1',
					anchor: { start: 0, end: 2, quote: '本文' },
					done: true,
					createdAt: 1,
					updatedAt: 1
				}
			])
		);
		const file = result.files.find((f) => f.path === 'projects/作品/メモ.md');
		expect(file?.content).toContain('## [完了] 伏線を回収する');
		expect(file?.content).toContain('- タグ: #todo #伏線');
		expect(file?.content).toContain('- シーン: 場面');
		expect(file?.content).toContain('- 本文の引用: 「本文」');
		expect(file?.content).toContain('詳細');
	});

	it('メモが無ければ メモ.md を作らない', () => {
		const result = buildWorkspace(base([]));
		expect(result.files.some((f) => f.path.endsWith('メモ.md'))).toBe(false);
	});
});

describe('buildWorkspace の未保存の本文', () => {
	it('overrides の本文で書き出す', () => {
		const result = buildWorkspace(
			{
				...empty,
				projects: [project('p1', '作品')],
				chapters: [chapter('c1', 'p1', '章', 0)],
				scenes: [scene('s1', 'c1', 'p1', '場面', 0, '保存済み')]
			},
			{ s1: '未保存' }
		);
		expect(result.files.find((f) => f.path === result.sceneFiles.s1)?.content).toBe(
			'# 場面\n\n未保存\n'
		);
	});
});

describe('buildWorkspace の項目ファイル', () => {
	it('項目ごとのファイルを書き出し、パスから種別と ID を引ける', () => {
		const result = buildWorkspace({
			...empty,
			projects: [project('p1', '作品')],
			chapters: [chapter('c1', 'p1', '序章', 0)],
			scenes: [],
			characters: [
				{
					id: 'ch1',
					projectId: 'p1',
					name: '太郎',
					role: '',
					appearance: '',
					personality: '',
					background: '',
					relationships: [],
					createdAt: 0,
					updatedAt: 0,
					_version: 1
				}
			],
			progressLogs: [
				{
					id: 'l1',
					projectId: 'p1',
					date: '2026-01-02',
					charactersWritten: 5,
					timeSpent: 1,
					sceneIds: [],
					createdAt: 0
				}
			],
			history: [
				{
					id: 'h1',
					entityType: 'character',
					entityId: 'ch1',
					projectId: 'p1',
					snapshot: {},
					changeType: 'update',
					createdAt: 0
				}
			]
		});
		const byKind = (kind: string) =>
			Object.entries(result.entityFiles).filter(([, r]) => r.kind === kind);
		expect(result.entityFiles['projects/作品/キャラクター/太郎.md']).toEqual({
			kind: 'characters',
			id: 'ch1'
		});
		expect(byKind('chapters')).toHaveLength(1);
		expect(byKind('progressLogs')[0][0]).toBe('projects/作品/進捗/2026-01-02.md');
		expect(byKind('history')).toHaveLength(1);
		for (const path of Object.keys(result.entityFiles))
			expect(result.files.some((f) => f.path === path)).toBe(true);
	});
});
