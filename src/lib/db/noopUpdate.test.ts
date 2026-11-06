import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './schema';
import { projectsDB } from './projects';
import { chaptersDB } from './chapters';
import { scenesDB } from './scenes';
import { charactersDB } from './characters';
import { plotsDB } from './plots';
import { worldbuildingDB } from './worldbuilding';

// 内容が変わらない update で updatedAt / _version を進めない(別端末との不要な競合の原因になる)
describe('未変更の update は書き込まない', () => {
	let projectId: string;

	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(1_000_000);
		await Promise.all([
			db.projects.clear(),
			db.chapters.clear(),
			db.scenes.clear(),
			db.characters.clear(),
			db.plots.clear(),
			db.worldbuilding.clear(),
			db.history.clear()
		]);
		projectId = (await projectsDB.create({ title: 'P' })).id;
	});

	/** 時刻を進めてから呼ぶ。進めなければ updatedAt が変わっても検出できない */
	const later = () => vi.setSystemTime(2_000_000);

	it('シーン: 同じ本文を保存しても updatedAt / _version / プロジェクトは変わらない', async () => {
		const chapter = await chaptersDB.create({ projectId, title: 'C' });
		const scene = await scenesDB.create({
			chapterId: chapter.id,
			projectId,
			title: 'S',
			content: '本文'
		});
		// create は characterCount を 0 で作るので、一度保存して導出値をそろえてから比べる
		await scenesDB.update(scene.id, { content: '本文' });
		const before = await db.scenes.get(scene.id);
		const projectBefore = await db.projects.get(projectId);
		later();

		await scenesDB.update(scene.id, { content: '本文' });
		await scenesDB.update(scene.id, { title: 'S', order: before!.order });

		expect(await db.scenes.get(scene.id)).toEqual(before);
		expect(await db.projects.get(projectId)).toEqual(projectBefore);
	});

	it('シーン: characterCount が実際と違う旧データは、保存で値が直る(書く)', async () => {
		const chapter = await chaptersDB.create({ projectId, title: 'C' });
		const scene = await scenesDB.create({
			chapterId: chapter.id,
			projectId,
			title: 'S',
			content: '本文'
		});
		await db.scenes.update(scene.id, { characterCount: 99 });
		later();
		await scenesDB.update(scene.id, { content: '本文' });
		const after = await db.scenes.get(scene.id);
		expect(after?.characterCount).toBe(2);
		expect(after?.updatedAt).toBe(2_000_000);
	});

	it('シーン: 本文が変われば従来どおり updatedAt / _version / characterCount を更新する', async () => {
		const chapter = await chaptersDB.create({ projectId, title: 'C' });
		const scene = await scenesDB.create({
			chapterId: chapter.id,
			projectId,
			title: 'S',
			content: '本文'
		});
		later();
		await scenesDB.update(scene.id, { content: '本文です' });
		const after = await db.scenes.get(scene.id);
		expect(after).toMatchObject({ content: '本文です', characterCount: 4, updatedAt: 2_000_000 });
		expect(after?._version).toBe(2);
		expect((await db.projects.get(projectId))?.updatedAt).toBe(2_000_000);
	});

	it('章・人物・プロット・設定資料・プロジェクト: 同じ値の更新は何も書かない', async () => {
		const chapter = await chaptersDB.create({ projectId, title: 'C' });
		const character = await charactersDB.create({ projectId, name: 'N' });
		const plot = await plotsDB.create({ projectId, title: 'T', type: 'main' } as never);
		const world = await worldbuildingDB.create({
			projectId,
			title: 'W',
			category: 'location'
		} as never);
		const snapshot = async () => [
			await db.projects.get(projectId),
			await db.chapters.get(chapter.id),
			await db.characters.get(character.id),
			await db.plots.get(plot.id),
			await db.worldbuilding.get(world.id),
			await db.history.count()
		];
		const before = await snapshot();
		later();

		await projectsDB.update(projectId, { title: 'P' });
		await chaptersDB.update(chapter.id, { title: 'C', order: chapter.order });
		await charactersDB.update(character.id, { name: 'N', relationships: [] });
		await plotsDB.update(plot.id, { title: 'T', position: { x: 0, y: 0 } });
		await worldbuildingDB.update(world.id, { title: 'W', tags: [] });

		expect(await snapshot()).toEqual(before);
	});

	it('並べ替え: 位置が変わらないものは更新しない', async () => {
		const chapter = await chaptersDB.create({ projectId, title: 'C' });
		const a = await scenesDB.create({ chapterId: chapter.id, projectId, title: 'a' });
		const b = await scenesDB.create({ chapterId: chapter.id, projectId, title: 'b' });
		const c1 = await chaptersDB.create({ projectId, title: 'C1' });
		const before = [
			await db.scenes.get(a.id),
			await db.scenes.get(b.id),
			await db.chapters.get(c1.id)
		];
		later();
		await scenesDB.reorder(chapter.id, [a.id, b.id]);
		await chaptersDB.reorder(projectId, [chapter.id, c1.id]);
		expect([
			await db.scenes.get(a.id),
			await db.scenes.get(b.id),
			await db.chapters.get(c1.id)
		]).toEqual(before);
		// 入れ替えれば両方が更新される
		await scenesDB.reorder(chapter.id, [b.id, a.id]);
		expect((await db.scenes.get(a.id))?.order).toBe(1);
		expect((await db.scenes.get(a.id))?.updatedAt).toBe(2_000_000);
	});
});
