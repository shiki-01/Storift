import { describe, expect, it } from 'vitest';
import { PAGE_LABELS, pageFromPath, pageLabel } from './pages';

describe('pageFromPath', () => {
	it('ホーム・設定', () => {
		expect(pageFromPath('/')).toEqual({ page: 'home' });
		expect(pageFromPath('/home')).toEqual({ page: 'home' });
		expect(pageFromPath('/settings')).toEqual({ page: 'settings' });
		expect(pageFromPath('/settings/')).toEqual({ page: 'settings' });
	});

	it('作品の各画面は、画面と作品 ID を返す', () => {
		for (const page of [
			'editor',
			'plot',
			'characters',
			'worldbuilding',
			'progress',
			'preview'
		] as const) {
			expect(pageFromPath(`/project/abc-1/${page}`)).toEqual({ page, projectId: 'abc-1' });
		}
		expect(pageFromPath('/project/abc/editor/')).toEqual({ page: 'editor', projectId: 'abc' });
	});

	it('知らない画面・途中のパスは other(作品 ID は付けない)', () => {
		expect(pageFromPath('/project/abc')).toEqual({ page: 'other' });
		expect(pageFromPath('/project/abc/unknown')).toEqual({ page: 'other' });
		expect(pageFromPath('/setup')).toEqual({ page: 'other' });
		expect(pageFromPath('/join/xyz')).toEqual({ page: 'other' });
		expect(pageFromPath('/monolog/callback')).toEqual({ page: 'other' });
	});
});

describe('PAGE_LABELS', () => {
	it('固定の日本語ラベル', () => {
		expect(pageLabel('editor')).toBe('執筆中');
		expect(PAGE_LABELS.plot).toBe('プロットを練っています');
		expect(PAGE_LABELS.characters).toBe('人物を整理しています');
		expect(PAGE_LABELS.worldbuilding).toBe('世界観を作っています');
		expect(PAGE_LABELS.progress).toBe('進捗を見ています');
		expect(PAGE_LABELS.preview).toBe('通読しています');
		expect(PAGE_LABELS.settings).toBe('設定を開いています');
		expect(PAGE_LABELS.home).toBe('ホーム');
	});
	it('Discord の最小文字数(2 文字)以上', () => {
		for (const label of Object.values(PAGE_LABELS))
			expect([...label].length).toBeGreaterThanOrEqual(2);
	});
});
