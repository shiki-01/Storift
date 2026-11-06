import { beforeEach, describe, expect, it, vi } from 'vitest';

const scenes = vi.hoisted(() => ({ list: [] as Record<string, unknown>[] }));
const project = vi.hoisted(() => ({ shared: false }));
const applied = vi.hoisted(() => ({
	calls: [] as { id: string; text: string }[],
	failures: {} as Record<string, { reason: string; message: string }>
}));
const updates = vi.hoisted(() => ({ calls: [] as { id: string; changes: unknown }[] }));
const crdtText = vi.hoisted(() => ({ map: {} as Record<string, string> }));

vi.mock('$lib/db', () => ({
	db: {
		scenes: {
			where: () => ({ equals: () => ({ toArray: async () => scenes.list }) }),
			update: async (id: string, changes: unknown) => void updates.calls.push({ id, changes })
		},
		projects: {
			get: async () => ({ id: 'p1', sharing: project.shared ? { status: 'active' } : undefined })
		}
	}
}));

vi.mock('$lib/services/sceneText.service', () => ({
	getSceneText: async (id: string) => crdtText.map[id],
	applySceneText: async (id: string, text: string) => {
		const failure = applied.failures[id];
		if (failure) return { ok: false, ...failure };
		applied.calls.push({ id, text });
		return { ok: true, changed: true };
	}
}));

import { replaceInProject, searchInProject } from './search.service';

const scene = (id: string, content: string) => ({
	id,
	projectId: 'p1',
	title: `シーン${id}`,
	content,
	_version: 1
});

beforeEach(() => {
	scenes.list = [scene('s1', '猫と猫'), scene('s2', '犬だけ'), scene('s3', '猫がいる')];
	project.shared = false;
	applied.calls = [];
	applied.failures = {};
	updates.calls = [];
	crdtText.map = {};
});

const options = { query: '猫', replaceWith: '虎', replaceAll: true, scopes: ['scenes' as const] };

describe('replaceInProject', () => {
	it('共有していないプロジェクトは従来どおり DB を直接更新する', async () => {
		const result = await replaceInProject('p1', options);
		expect(result.replaced).toBe(3);
		expect(result.sceneIds).toEqual(['s1', 's3']);
		expect(result.skipped).toEqual([]);
		expect(updates.calls.map((c) => c.id)).toEqual(['s1', 's3']);
		expect(applied.calls).toEqual([]);
	});

	it('共有プロジェクトは applySceneText で反映し、DB を直接書かない', async () => {
		project.shared = true;
		crdtText.map = { s1: '猫と猫(共同編集の最新)', s2: '犬だけ', s3: '猫がいる' };
		const result = await replaceInProject('p1', options);
		expect(applied.calls).toEqual([
			{ id: 's1', text: '虎と虎(共同編集の最新)' },
			{ id: 's3', text: '虎がいる' }
		]);
		expect(updates.calls).toEqual([]);
		expect(result.replaced).toBe(3);
		expect(result.skipped).toEqual([]);
	});

	it('反映できないシーン(オフライン・読み取り専用など)はスキップし、理由を返す', async () => {
		project.shared = true;
		applied.failures = {
			s1: { reason: 'offline', message: 'オフラインです' },
			s3: { reason: 'read-only', message: '読み取り専用です' }
		};
		const result = await replaceInProject('p1', options);
		expect(result.replaced).toBe(0);
		expect(result.sceneIds).toEqual([]);
		expect(result.skipped).toEqual([
			{ sceneId: 's1', title: 'シーンs1', reason: 'offline', message: 'オフラインです' },
			{ sceneId: 's3', title: 'シーンs3', reason: 'read-only', message: '読み取り専用です' }
		]);
	});

	it('一部だけ失敗しても、成功したシーンは置換される', async () => {
		project.shared = true;
		applied.failures = { s1: { reason: 'no-snapshot', message: 'x' } };
		const result = await replaceInProject('p1', options);
		expect(result.sceneIds).toEqual(['s3']);
		expect(result.replaced).toBe(1);
		expect(result.skipped.map((s) => s.sceneId)).toEqual(['s1']);
	});
});

describe('searchInProject(共有プロジェクト)', () => {
	it('Scene.content ではなく共同編集の本文を検索する', async () => {
		project.shared = true;
		crdtText.map = { s1: '最新の本文', s2: '犬だけ', s3: '猫がいる' };
		const results = await searchInProject('p1', { query: '猫', scopes: ['scenes'] });
		expect(results.map((r) => r.id)).toEqual(['s3']);
	});
});
