import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './schema';
import { projectsDB } from './projects';
import { charactersDB } from './characters';
import { plotsDB } from './plots';
import { worldbuildingDB } from './worldbuilding';
import { ALL_PLOTS } from '$lib/utils/plotOrdering';
import { MIN_GAP } from '$lib/utils/ordering';

// 並べ替え(moveTo)は、必要な行だけを書く(複数端末の同期で updatedAt の競合を増やさない)
describe('moveTo', () => {
	let projectId: string;

	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(1_000_000);
		await Promise.all(db.tables.map((t) => t.clear()));
		projectId = (await projectsDB.create({ title: 'P' })).id;
	});

	const later = () => vi.setSystemTime(2_000_000);
	const titles = async () => (await plotsDB.getByProjectId(projectId)).map((p) => p.title);

	async function seedPlots(n = 4, status: 'idea' | 'planned' = 'idea') {
		const rows = [];
		for (let i = 0; i < n; i++) {
			vi.setSystemTime(1_000_000 + i);
			rows.push(await plotsDB.create({ projectId, title: `P${i}`, type: 'scene', status }));
		}
		vi.setSystemTime(1_000_000);
		return rows;
	}

	it('作成した項目は末尾に追加される(order は 1024 刻み)', async () => {
		await seedPlots(3);
		expect(await titles()).toEqual(['P0', 'P1', 'P2']);
		const orders = (await plotsDB.getByProjectId(projectId)).map((p) => p.order);
		expect(orders).toEqual([1024, 2048, 3072]);
	});

	it('プロット: 1 件だけ書く(他の行の updatedAt / _version は変わらない)', async () => {
		const rows = await seedPlots();
		later();
		const written = await plotsDB.moveTo(rows[3].id, 1);
		expect(written).toEqual([rows[3].id]);
		expect(await titles()).toEqual(['P0', 'P3', 'P1', 'P2']);
		const after = await plotsDB.getByProjectId(projectId);
		for (const p of after) {
			if (p.id === rows[3].id) {
				expect(p.updatedAt).toBe(2_000_000);
				expect(p._version).toBe(2);
			} else {
				expect(p.updatedAt).toBe(rows.find((r) => r.id === p.id)!.updatedAt);
				expect(p._version).toBe(1);
			}
		}
	});

	it('位置が変わらなければ何も書かない', async () => {
		const rows = await seedPlots();
		later();
		expect(await plotsDB.moveTo(rows[1].id, 1)).toEqual([]);
		expect((await db.plots.get(rows[1].id))!.updatedAt).toBe(rows[1].updatedAt);
		expect(await plotsDB.moveTo('missing', 0)).toEqual([]);
	});

	it('プロット: 別の状態の列へ移すと、状態と order を 1 回の更新で書く', async () => {
		const idea = await seedPlots(2, 'idea');
		const planned = await seedPlots(2, 'planned');
		later();
		const written = await plotsDB.moveTo(idea[0].id, 1, 'planned');
		expect(written).toEqual([idea[0].id]);
		const moved = (await db.plots.get(idea[0].id))!;
		expect(moved.status).toBe('planned');
		expect(moved._version).toBe(2);
		const planColumn = (await plotsDB.getByProjectId(projectId))
			.filter((p) => p.status === 'planned')
			.map((p) => p.id);
		expect(planColumn).toEqual([planned[0].id, idea[0].id, planned[1].id]);
		// 空の列にも入れられる
		await plotsDB.moveTo(idea[1].id, 0, 'revised');
		expect((await db.plots.get(idea[1].id))!.status).toBe('revised');
	});

	it('間隔が尽きたら、そのグループだけ振り直す', async () => {
		const rows = await seedPlots(3);
		const other = await seedPlots(1, 'planned');
		await db.plots.update(rows[0].id, { order: 1 });
		await db.plots.update(rows[1].id, { order: 1 + MIN_GAP * 1.5 });
		await db.plots.update(rows[2].id, { order: 10 });
		later();
		const written = await plotsDB.moveTo(rows[2].id, 1);
		expect(written.length).toBeGreaterThan(1);
		expect(written).not.toContain(other[0].id);
		const col = (await plotsDB.getByProjectId(projectId)).filter((p) => p.status === 'idea');
		expect(col.map((p) => p.title)).toEqual(['P0', 'P2', 'P1']);
		expect(col.map((p) => p.order)).toEqual([1024, 2048, 3072]);
	});

	it('プロット: ALL_PLOTS はタイムライン(全体)の中で動かし、状態は変えない', async () => {
		const a = await seedPlots(2, 'idea');
		const b = await seedPlots(2, 'planned');
		later();
		const written = await plotsDB.moveTo(b[1].id, 0, ALL_PLOTS);
		expect(written).toEqual([b[1].id]);
		const all = await plotsDB.getByProjectId(projectId);
		expect(all.map((p) => p.id)).toEqual([b[1].id, a[0].id, a[1].id, b[0].id]);
		expect(all[0].status).toBe('planned');
	});

	it('人物: order の無い既存データは作成順で並び、初めて動かしたとき全体を書く', async () => {
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			vi.setSystemTime(1_000_000 + i);
			const c = await charactersDB.create({ projectId, name: `C${i}` });
			ids.push(c.id);
			await db.characters.update(c.id, { order: undefined });
		}
		await db.characters.toCollection().modify((c) => {
			delete c.order;
		});
		const names = async () => (await charactersDB.getByProjectId(projectId)).map((c) => c.name);
		expect(await names()).toEqual(['C0', 'C1', 'C2']);
		later();
		const written = await charactersDB.moveTo(ids[2], 0);
		expect(written).toHaveLength(3);
		expect(await names()).toEqual(['C2', 'C0', 'C1']);
		// 2 回目からは 1 件だけ
		later();
		expect(await charactersDB.moveTo(ids[1], 0)).toEqual([ids[1]]);
		expect(await names()).toEqual(['C1', 'C2', 'C0']);
	});

	it('人物: 並べ替えは履歴を残さない', async () => {
		const a = await charactersDB.create({ projectId, name: 'A' });
		await charactersDB.create({ projectId, name: 'B' });
		const before = await db.history.count();
		await charactersDB.moveTo(a.id, 1);
		expect(await db.history.count()).toBe(before);
	});

	it('設定資料: 分類ごとに並ぶ。別の分類へ移すと分類も書く', async () => {
		const t0 = await worldbuildingDB.create({ projectId, category: 'term', title: 'T0' });
		const t1 = await worldbuildingDB.create({ projectId, category: 'term', title: 'T1' });
		const l0 = await worldbuildingDB.create({ projectId, category: 'location', title: 'L0' });
		later();
		expect(await worldbuildingDB.moveTo(t1.id, 0)).toEqual([t1.id]);
		expect((await worldbuildingDB.getByCategory(projectId, 'term')).map((w) => w.title)).toEqual([
			'T1',
			'T0'
		]);
		expect((await db.worldbuilding.get(l0.id))!._version).toBe(1);
		await worldbuildingDB.moveTo(t0.id, 1, 'location');
		const moved = (await db.worldbuilding.get(t0.id))!;
		expect(moved.category).toBe('location');
		expect(
			(await worldbuildingDB.getByCategory(projectId, 'location')).map((w) => w.title)
		).toEqual(['L0', 'T0']);
	});

	it('プロジェクトの更新は 1 回だけ進める', async () => {
		const rows = await seedPlots();
		const before = (await db.projects.get(projectId))!._version;
		await plotsDB.moveTo(rows[3].id, 0);
		expect((await db.projects.get(projectId))!._version).toBe(before + 1);
	});
});
