import { afterEach, describe, expect, it } from 'vitest';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { projectsStore } from '$lib/stores/projects.svelte';
import type { Project, ProjectSharing } from '$lib/types';
import type { ContextMenuItem } from '$lib/utils/contextMenu';
import { filterReadOnlyMenu, isReadOnlyProject, readOnlyReason } from './readOnly';

const project = (id: string, sharing?: Partial<ProjectSharing>): Project => ({
	id,
	title: id,
	description: '',
	createdAt: 1,
	updatedAt: 1,
	status: 'draft',
	settings: {
		writingMode: 'horizontal',
		fontSize: 16,
		theme: 'light',
		goal: { type: 'daily', target: 2000 }
	},
	_version: 1,
	...(sharing
		? {
				sharing: {
					pid: id,
					role: 'viewer',
					visibility: 'private',
					status: 'active',
					startedAt: 1,
					...sharing
				}
			}
		: {})
});

afterEach(() => {
	projectsStore.projects = [];
	currentProjectStore.project = null;
});

describe('isReadOnlyProject', () => {
	it('閲覧権限と、失効したゲストは読み取り専用', () => {
		projectsStore.projects = [
			project('plain'),
			project('owner', { role: 'owner' }),
			project('viewer', { role: 'viewer' }),
			project('editor', { role: 'editor' }),
			project('revoked', { role: 'editor', revokedAt: 5 })
		];
		expect(isReadOnlyProject('plain')).toBe(false);
		expect(isReadOnlyProject('owner')).toBe(false);
		expect(isReadOnlyProject('viewer')).toBe(true);
		expect(isReadOnlyProject('editor')).toBe(false);
		expect(isReadOnlyProject('revoked')).toBe(true);
		expect(isReadOnlyProject('missing')).toBe(false);
		expect(isReadOnlyProject(undefined)).toBe(false);
	});

	it('開いているプロジェクト(currentProjectStore)を優先する', () => {
		projectsStore.projects = [project('p')];
		currentProjectStore.project = project('p', { role: 'viewer' });
		expect(isReadOnlyProject('p')).toBe(true);
	});

	it('理由を区別できる', () => {
		projectsStore.projects = [
			project('v', { role: 'viewer' }),
			project('r', { role: 'editor', revokedAt: 1 }),
			project('e', { role: 'editor' })
		];
		expect(readOnlyReason('v')).toBe('viewer');
		expect(readOnlyReason('r')).toBe('revoked');
		expect(readOnlyReason('e')).toBeNull();
	});
});

describe('filterReadOnlyMenu', () => {
	const item = (label: string): ContextMenuItem => ({ label, action: () => {} });
	const divider = { divider: true } as ContextMenuItem;

	it('内容を変える項目を取り除き、区切り線が重ならない・端に残らないよう整える', () => {
		const out = filterReadOnlyMenu([
			item('コピー'),
			item('カット'),
			item('貼り付け'),
			divider,
			item('すべて選択'),
			divider,
			item('保存'),
			item('名前を変更'),
			divider,
			item('エクスポート'),
			divider,
			item('削除')
		]);
		expect(out.map((i) => (i.divider ? '---' : i.label))).toEqual([
			'コピー',
			'---',
			'すべて選択',
			'---',
			'エクスポート'
		]);
	});

	it('全部取り除かれたら空', () => {
		expect(filterReadOnlyMenu([item('削除'), divider, item('複製')])).toEqual([]);
	});
});
