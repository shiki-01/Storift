import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './schema';
import { projectsDB } from './projects';
import { chaptersDB } from './chapters';
import { scenesDB } from './scenes';
import { extensionEvents } from '$lib/extensions/events';

// 拡張向けイベントの発行条件。自分が書いた本文の変更だけが scene:updated になる
describe('scenesDB の拡張向けイベント', () => {
	let projectId: string;
	let chapterId: string;
	const updated = vi.fn();
	const created = vi.fn();
	let offs: Array<() => void> = [];

	beforeEach(async () => {
		await Promise.all([
			db.projects.clear(),
			db.chapters.clear(),
			db.scenes.clear(),
			db.history.clear()
		]);
		projectId = (await projectsDB.create({ title: 'P' })).id;
		chapterId = (await chaptersDB.create({ projectId, title: 'C' })).id;
		updated.mockClear();
		created.mockClear();
		offs = [
			extensionEvents.on('scene:updated', updated),
			extensionEvents.on('scene:created', created)
		];
	});

	afterEach(() => offs.forEach((off) => off()));

	const newScene = (content = 'あいう') =>
		scenesDB.create({ chapterId, projectId, title: 'S', content });

	it('create で scene:created を発行する(silent なら発行しない)', async () => {
		const scene = await newScene();
		expect(created).toHaveBeenCalledWith({ sceneId: scene.id, chapterId, projectId });
		created.mockClear();
		await scenesDB.create({ chapterId, projectId, title: 'T' }, { silent: true });
		expect(created).not.toHaveBeenCalled();
	});

	it('本文が変わったら、更新後の文字数と更新前の文字数を付けて発行する', async () => {
		const scene = await newScene('あいう');
		await scenesDB.update(scene.id, { content: 'あいうえお' });
		expect(updated).toHaveBeenCalledTimes(1);
		expect(updated).toHaveBeenCalledWith({
			sceneId: scene.id,
			chapterId,
			projectId,
			characterCount: 5,
			previousCharacterCount: 0 // create は characterCount を 0 で作る
		});
		await scenesDB.update(scene.id, { content: 'あ' });
		expect(updated).toHaveBeenLastCalledWith(
			expect.objectContaining({ characterCount: 1, previousCharacterCount: 5 })
		);
	});

	it('本文が同じ、またはタイトル・並び順だけの更新では発行しない', async () => {
		const scene = await newScene('あいう');
		await scenesDB.update(scene.id, { content: 'あいう' });
		await scenesDB.update(scene.id, { title: '別名' });
		await scenesDB.update(scene.id, { order: 3 });
		expect(updated).not.toHaveBeenCalled();
	});

	it('silent を指定すると、本文が変わっても発行しない(共同編集のミラー・AI の差し替え用)', async () => {
		const scene = await newScene('あいう');
		await scenesDB.update(scene.id, { content: '変わった本文' }, { silent: true });
		expect(updated).not.toHaveBeenCalled();
		expect((await scenesDB.getById(scene.id))?.characterCount).toBe(6);
	});

	it('購読者がいなくても、購読者が例外を投げても、保存は成功する', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		offs.forEach((off) => off());
		const scene = await newScene();
		await scenesDB.update(scene.id, { content: 'x' });
		offs = [
			extensionEvents.on('scene:updated', () => {
				throw new Error('boom');
			})
		];
		await expect(scenesDB.update(scene.id, { content: 'xy' })).resolves.toBeUndefined();
		expect((await scenesDB.getById(scene.id))?.content).toBe('xy');
		spy.mockRestore();
	});
});
