import { beforeEach, describe, expect, it, vi } from 'vitest';

// DB と同期キューを差し替え、作成の呼び出し順・ID・同期キューへの積み方を検証する
const mocks = vi.hoisted(() => ({
	projectGet: vi.fn(),
	projectCreate: vi.fn(),
	projectDelete: vi.fn(),
	chapterCreate: vi.fn(),
	sceneCreate: vi.fn(),
	characterCreate: vi.fn(),
	characterUpdate: vi.fn(),
	plotCreate: vi.fn(),
	plotUpdate: vi.fn(),
	worldCreate: vi.fn(),
	worldUpdate: vi.fn(),
	queueChange: vi.fn()
}));

vi.mock('$lib/db', () => ({
	projectsDB: {
		getById: mocks.projectGet,
		create: mocks.projectCreate,
		delete: mocks.projectDelete
	},
	chaptersDB: { create: mocks.chapterCreate },
	scenesDB: { create: mocks.sceneCreate },
	charactersDB: { create: mocks.characterCreate, update: mocks.characterUpdate },
	plotsDB: { create: mocks.plotCreate, update: mocks.plotUpdate },
	worldbuildingDB: { create: mocks.worldCreate, update: mocks.worldUpdate }
}));

vi.mock('$lib/services/sync.service', () => ({
	queueChange: mocks.queueChange
}));

const { createSampleProject, SAMPLE_PROJECT_ID } = await import('./sample');

// 渡された id をそのまま返す、作成関数の代わり
const echoId = async (input: { id?: string }) => ({ id: input.id });

beforeEach(() => {
	vi.clearAllMocks();
	mocks.projectGet.mockResolvedValue(undefined);
	mocks.projectCreate.mockImplementation(async (input: { id?: string; title: string }) => ({
		id: input.id,
		title: input.title
	}));
	mocks.chapterCreate.mockImplementation(echoId);
	mocks.sceneCreate.mockImplementation(echoId);
	mocks.characterCreate.mockImplementation(echoId);
	mocks.characterUpdate.mockResolvedValue(undefined);
	mocks.plotCreate.mockImplementation(echoId);
	mocks.plotUpdate.mockResolvedValue(undefined);
	mocks.worldCreate.mockImplementation(echoId);
	mocks.worldUpdate.mockResolvedValue(undefined);
	mocks.queueChange.mockResolvedValue(undefined);
	mocks.projectDelete.mockResolvedValue(undefined);
});

describe('createSampleProject', () => {
	it('固定 ID のサンプル作品を、章・シーン・キャラクター・プロット・設定資料付きで作る', async () => {
		const result = await createSampleProject();

		expect(result.created).toBe(true);
		expect(SAMPLE_PROJECT_ID).toBe('sample-project-v1');
		expect(mocks.projectCreate).toHaveBeenCalledWith(
			expect.objectContaining({ id: SAMPLE_PROJECT_ID, title: 'サンプル作品' })
		);

		// 章 2 つ、シーン 3 つ(章ごとの振り分けも確認する)
		expect(mocks.chapterCreate).toHaveBeenCalledTimes(2);
		expect(mocks.sceneCreate).toHaveBeenCalledTimes(3);
		const scenes = mocks.sceneCreate.mock.calls.map(([input]) => input);
		expect(scenes.filter((s) => s.chapterId === 'sample-chapter-1')).toHaveLength(2);
		expect(scenes.filter((s) => s.chapterId === 'sample-chapter-2')).toHaveLength(1);
		for (const scene of scenes) {
			expect(scene.projectId).toBe(SAMPLE_PROJECT_ID);
			expect(scene.content.length).toBeGreaterThan(0);
		}

		// キャラクター 2 名(人物像を書き足し、互いを相関図で結ぶ)
		expect(mocks.characterCreate).toHaveBeenCalledTimes(2);
		expect(mocks.characterUpdate).toHaveBeenCalledWith(
			'sample-character-1',
			expect.objectContaining({
				relationships: [{ characterId: 'sample-character-2', relation: '幼なじみ' }]
			})
		);
		expect(mocks.characterUpdate).toHaveBeenCalledWith(
			'sample-character-2',
			expect.objectContaining({
				relationships: [{ characterId: 'sample-character-1', relation: '幼なじみ' }]
			})
		);

		expect(mocks.plotCreate).toHaveBeenCalledTimes(1);
		expect(mocks.plotUpdate).toHaveBeenCalledTimes(1);
		expect(mocks.worldCreate).toHaveBeenCalledTimes(1);
		expect(mocks.worldUpdate).not.toHaveBeenCalled();
	});

	it('作成した全要素を同期キューに create として積む', async () => {
		await createSampleProject();

		const queued = mocks.queueChange.mock.calls.map((args) => args);
		expect(queued).toHaveLength(10);
		expect(queued).toEqual(
			expect.arrayContaining([
				['projects', SAMPLE_PROJECT_ID, 'create'],
				['chapters', 'sample-chapter-1', 'create'],
				['scenes', 'sample-scene-2-1', 'create'],
				['characters', 'sample-character-2', 'create'],
				['plots', 'sample-plot-1', 'create'],
				['worldbuilding', 'sample-worldbuilding-1', 'create']
			])
		);
		// 作成より先に積まれていないこと(作成完了後にだけ同期対象になる)
		expect(mocks.queueChange.mock.invocationCallOrder[0]).toBeGreaterThan(
			mocks.worldCreate.mock.invocationCallOrder[0]
		);
	});

	it('既に存在する場合は新規作成せず、既存の作品を返す', async () => {
		const existing = { id: SAMPLE_PROJECT_ID, title: 'サンプル作品' };
		mocks.projectGet.mockResolvedValue(existing);

		const result = await createSampleProject();

		expect(result).toEqual({ project: existing, created: false });
		expect(mocks.projectCreate).not.toHaveBeenCalled();
		expect(mocks.chapterCreate).not.toHaveBeenCalled();
		expect(mocks.queueChange).not.toHaveBeenCalled();
	});

	it('途中で失敗したら中途半端な作品を削除し、同期キューには積まずに例外を投げ直す', async () => {
		mocks.chapterCreate.mockRejectedValueOnce(new Error('disk full'));

		await expect(createSampleProject()).rejects.toThrow('disk full');
		expect(mocks.projectDelete).toHaveBeenCalledWith(SAMPLE_PROJECT_ID);
		expect(mocks.queueChange).not.toHaveBeenCalled();
	});
});
