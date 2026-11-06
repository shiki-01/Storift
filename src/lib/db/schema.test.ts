import { describe, expect, it } from 'vitest';
import { StoriftDB } from './schema';

// IndexedDB の無い環境でも検証できる範囲(スキーマ定義)。実際の v3→v4 の移行は、
// 既存のテーブルの定義を変えず、テーブルを足すだけであることで担保する。
describe('Dexie スキーマ v4', () => {
	const db = new StoriftDB();

	it('バージョンは 4', () => {
		expect(db.verno).toBe(4);
	});

	it('v3 までのテーブルと索引は変わらない', () => {
		const indexes = (name: string) =>
			db
				.table(name)
				.schema.indexes.map((i) => i.name)
				.sort();
		expect(db.table('projects').schema.primKey.name).toBe('id');
		expect(indexes('projects')).toEqual(['createdAt', 'status', 'syncedAt', 'title', 'updatedAt']);
		expect(indexes('chapters')).toEqual(['createdAt', 'order', 'projectId', 'updatedAt']);
		expect(indexes('scenes')).toEqual([
			'chapterId',
			'createdAt',
			'order',
			'projectId',
			'updatedAt'
		]);
		expect(indexes('relationMaps')).toEqual(['projectId', 'updatedAt']);
		expect(indexes('memos')).toEqual(['projectId', 'sceneId', 'updatedAt']);
		expect(db.table('settings').schema.primKey.name).toBe('id');
	});

	it('connections テーブルが追加されている(id が主キー、pid・status の索引)', () => {
		const table = db.table('connections');
		expect(table.schema.primKey.name).toBe('id');
		expect(table.schema.indexes.map((i) => i.name).sort()).toEqual(['pid', 'status']);
	});

	it('既存のテーブルがすべて残っている', () => {
		const names = db.tables.map((t) => t.name).sort();
		expect(names).toEqual(
			[
				'chapters',
				'characters',
				'connections',
				'history',
				'memos',
				'plots',
				'progressLogs',
				'projects',
				'relationMaps',
				'scenes',
				'settings',
				'worldbuilding'
			].sort()
		);
	});
});
