import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
	CHILD_TYPES,
	activeProject,
	deleteSharedData,
	listMembers,
	removeMember,
	removePointerSharing,
	setVisibility,
	startSharing,
	stopSharing,
	writeSecret,
	writeSharingInfo,
	type ChildType
} from '../../src/lib/firebase/sharing';
import type { Project } from '../../src/lib/types/project';
import { OWNER_KEY, createEnv, dbOf, seed } from './helpers';

// クライアント実装(sharing.ts)を、実際のルールに対して直接呼ぶ。

const PID = '3b1d6a1e-6f0a-4c2e-9a53-0d3f2b7e8c41';
const OTHER = '9c7e2f10-1111-4222-8333-444455556666';

const fs = (env: RulesTestEnvironment, uid: string) => dbOf(env, uid) as unknown as Firestore;

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await createEnv();
});
beforeEach(async () => {
	await env.clearFirestore();
});
afterAll(async () => {
	await env?.cleanup();
});

type Data = Record<string, unknown>;

const project = (extra: Partial<Project> = {}): Project => ({
	id: PID,
	title: 'タイトル',
	description: '',
	createdAt: 1,
	updatedAt: 100,
	status: 'draft',
	settings: {
		writingMode: 'horizontal',
		fontSize: 16,
		theme: 'light',
		goal: { type: 'daily', target: 2000 }
	},
	_version: 1,
	...extra
});

const migratingProject = (direction: 'start' | 'stop' = 'start'): Project =>
	project({
		sharing: {
			pid: PID,
			role: 'owner',
			visibility: 'link',
			status: 'migrating',
			secrets: { viewer: 'viewer-secret', editor: 'editor-secret' },
			startedAt: 1000,
			migration: direction
		}
	});

const entity = (id: string, updatedAt = 100, extra: Data = {}): Data => ({
	id,
	projectId: PID,
	title: id,
	updatedAt,
	_version: 1,
	...extra
});

const emptyChildren = (): Record<ChildType, Data[]> => ({
	chapters: [],
	scenes: [],
	characters: [],
	plots: [],
	worldbuilding: []
});

const localChildren = (): Record<ChildType, Data[]> => ({
	chapters: [entity('c1')],
	scenes: [entity('s1'), entity('s2')],
	characters: [entity('ch1')],
	plots: [entity('p1')],
	worldbuilding: [entity('w1')]
});

/** ルールを無効化して、あるコレクションの文書 id 一覧を読む */
async function idsOf(path: string): Promise<string[]> {
	let ids: string[] = [];
	await env.withSecurityRulesDisabled(async (ctx) => {
		const snap = await getDocs(collection(ctx.firestore(), path));
		ids = snap.docs.map((d) => d.id).sort();
	});
	return ids;
}

async function dataOf(path: string): Promise<Data | undefined> {
	let data: Data | undefined;
	await env.withSecurityRulesDisabled(async (ctx) => {
		const snap = await getDoc(doc(ctx.firestore(), path));
		data = snap.exists() ? (snap.data() as Data) : undefined;
	});
	return data;
}

/** オーナー登録済みの状態で、最上位に子要素とポインタ(共有前)を置く */
async function seedTopLevel(children = localChildren()) {
	const docs: Record<string, Data> = {
		'_config/ownerKey': { key: OWNER_KEY },
		'owners/owner1': { key: OWNER_KEY },
		[`projects/${PID}`]: { ...project() }
	};
	for (const type of CHILD_TYPES) {
		for (const e of children[type]) docs[`${type}/${e.id}`] = e;
	}
	await seed(env, docs);
}

const allSharedPaths = async () => {
	const out: string[] = [];
	for (const sub of ['projects', ...CHILD_TYPES, 'secrets', 'members', 'presence']) {
		out.push(...(await idsOf(`shared/${PID}/${sub}`)).map((id) => `${sub}/${id}`));
	}
	if ((await dataOf(`shared/${PID}`)) !== undefined) out.push('(meta)');
	return out;
};

describe('startSharing', () => {
	it('データが shared に入り、最上位の子要素が消え、ポインタが active で残る', async () => {
		await seedTopLevel();
		const db = fs(env, 'owner1');

		const result = await startSharing(db, 'owner1', {
			pid: PID,
			project: migratingProject(),
			children: localChildren()
		});

		expect(result.copied).toBe(6);
		expect(result.removedFromTopLevel).toBe(6);
		expect(result.project.sharing).toMatchObject({ status: 'active' });
		expect(result.project.sharing).not.toHaveProperty('migration');

		// shared 側: 全子要素 + プロジェクトのコピー。projectId == pid
		expect(await idsOf(`shared/${PID}/scenes`)).toEqual(['s1', 's2']);
		expect(await idsOf(`shared/${PID}/chapters`)).toEqual(['c1']);
		expect(await idsOf(`shared/${PID}/projects`)).toEqual([PID]);
		expect((await dataOf(`shared/${PID}/scenes/s1`))?.projectId).toBe(PID);

		// 最上位の子要素は消え、ポインタ(secrets 付き)が残る
		for (const type of CHILD_TYPES) expect(await idsOf(type)).toEqual([]);
		const pointer = await dataOf(`projects/${PID}`);
		expect(pointer?.title).toBe('タイトル');
		expect(pointer?.sharing).toMatchObject({
			pid: PID,
			role: 'owner',
			status: 'active',
			visibility: 'link',
			secrets: { viewer: 'viewer-secret', editor: 'editor-secret' }
		});
		expect((pointer?.sharing as Data).migration).toBeUndefined();

		// 共有側のコピーに secrets は無い
		const copy = await dataOf(`shared/${PID}/projects/${PID}`);
		expect(copy?.projectId).toBe(PID);
		expect(copy?.sharing).toMatchObject({ status: 'active', visibility: 'link' });
		expect((copy?.sharing as Data).secrets).toBeUndefined();

		// メタと秘密文書。秘密はオーナーでも読めない
		expect(await dataOf(`shared/${PID}`)).toMatchObject({ visibility: 'link', name: 'タイトル' });
		expect(await dataOf(`shared/${PID}/secrets/viewer`)).toEqual({ value: 'viewer-secret' });
		expect(await dataOf(`shared/${PID}/secrets/editor`)).toEqual({ value: 'editor-secret' });
		await assertFails(getDoc(doc(db, `shared/${PID}/secrets/viewer`)));
		await assertFails(getDoc(doc(db, `shared/${PID}/secrets/editor`)));
	});

	it('最上位にだけある文書(他端末が作った)や、最上位の方が新しい版も取りこぼさない', async () => {
		await seedTopLevel({
			...emptyChildren(),
			scenes: [entity('s1', 100, { title: '古い' }), entity('only-top', 50)]
		});
		// 最上位の s1 の方が新しい(ローカルが未取得)
		await seed(env, { 'scenes/s1': entity('s1', 300, { title: '新しい' }) });
		const db = fs(env, 'owner1');

		await startSharing(db, 'owner1', {
			pid: PID,
			project: migratingProject(),
			children: { ...emptyChildren(), scenes: [entity('s1', 100, { title: '古い' })] }
		});

		expect(await idsOf(`shared/${PID}/scenes`)).toEqual(['only-top', 's1']);
		expect((await dataOf(`shared/${PID}/scenes/s1`))?.title).toBe('新しい');
		expect(await idsOf('scenes')).toEqual([]);
	});

	it('途中で失敗しても最上位は消えず、再実行で完了する(冪等)', async () => {
		await seedTopLevel();
		const db = fs(env, 'owner1');

		// worldbuilding のコピーで失敗させる(Firestore が受け付けない値)
		const broken = localChildren();
		broken.worldbuilding = [entity('w1', 100, { bad: () => 1 })];
		await expect(
			startSharing(db, 'owner1', {
				pid: PID,
				project: migratingProject(),
				children: broken
			})
		).rejects.toBeTruthy();

		// コピー確認の前なので、最上位の子要素はすべて残っている
		expect(await idsOf('scenes')).toEqual(['s1', 's2']);
		expect(await idsOf('worldbuilding')).toEqual(['w1']);
		// 他端末が子要素を誤って消さないよう、ポインタは migrating で書かれている
		expect((await dataOf(`projects/${PID}`))?.sharing).toMatchObject({
			status: 'migrating',
			migration: 'start'
		});
		// ここまでのコピーは shared に入っている
		expect(await idsOf(`shared/${PID}/scenes`)).toEqual(['s1', 's2']);

		// 再実行
		const result = await startSharing(db, 'owner1', {
			pid: PID,
			project: migratingProject(),
			children: localChildren()
		});
		// コピー済みの分は書き直さない(w1 だけ)
		expect(result.copied).toBe(1);
		expect(await idsOf(`shared/${PID}/worldbuilding`)).toEqual(['w1']);
		for (const type of CHILD_TYPES) expect(await idsOf(type)).toEqual([]);
		expect((await dataOf(`projects/${PID}`))?.sharing).toMatchObject({ status: 'active' });
		expect(((await dataOf(`projects/${PID}`))?.sharing as Data).migration).toBeUndefined();
	});

	it('shared 側が既に新しい版なら、古いローカルで上書きしない', async () => {
		await seedTopLevel();
		await seed(env, {
			[`shared/${PID}`]: { visibility: 'link', name: 'x' },
			[`shared/${PID}/scenes/s1`]: entity('s1', 999, { title: '共有側の編集' })
		});
		await startSharing(fs(env, 'owner1'), 'owner1', {
			pid: PID,
			project: migratingProject(),
			children: localChildren()
		});
		expect((await dataOf(`shared/${PID}/scenes/s1`))?.title).toBe('共有側の編集');
	});

	it('非オーナーは拒否され、何も書き込まれない', async () => {
		await seedTopLevel();
		await expect(
			startSharing(fs(env, 'stranger'), 'stranger', {
				pid: PID,
				project: migratingProject(),
				children: localChildren()
			})
		).rejects.toMatchObject({ code: 'permission-denied' });

		expect(await allSharedPaths()).toEqual([]);
		expect(await idsOf('scenes')).toEqual(['s1', 's2']);
		expect((await dataOf(`projects/${PID}`))?.sharing).toBeUndefined();
	});

	it('sharing が無い・pid が違う入力は拒否する', async () => {
		await seedTopLevel();
		const db = fs(env, 'owner1');
		await expect(
			startSharing(db, 'owner1', { pid: PID, project: project(), children: emptyChildren() })
		).rejects.toThrow();
		await expect(
			startSharing(db, 'owner1', {
				pid: OTHER,
				project: migratingProject(),
				children: emptyChildren()
			})
		).rejects.toThrow();
		expect(await allSharedPaths()).toEqual([]);
	});

	it('secrets が揃っていない入力は拒否する', async () => {
		await seedTopLevel();
		const p = migratingProject();
		p.sharing!.secrets = { viewer: 'only-viewer' };
		await expect(
			startSharing(fs(env, 'owner1'), 'owner1', {
				pid: PID,
				project: p,
				children: emptyChildren()
			})
		).rejects.toThrow();
		expect(await allSharedPaths()).toEqual([]);
	});
});

describe('stopSharing', () => {
	async function started() {
		await seedTopLevel();
		const db = fs(env, 'owner1');
		const result = await startSharing(db, 'owner1', {
			pid: PID,
			project: migratingProject(),
			children: localChildren()
		});
		return { db, active: result.project };
	}

	const stopping = (active: Project): Project => ({
		...active,
		sharing: { ...active.sharing!, status: 'migrating', migration: 'stop' }
	});

	it('子要素が最上位に戻り、shared 配下が空になり、ポインタから sharing が消える', async () => {
		const { db, active } = await started();
		// 参加者・presence・ネストの更新ログも消える
		await seed(env, {
			[`shared/${PID}/members/viewer1`]: { role: 'viewer', secret: 'viewer-secret' },
			[`shared/${PID}/presence/owner1`]: { at: 1 },
			[`shared/${PID}/presence/viewer1`]: { at: 1 },
			[`shared/${PID}/scenes/s1/updates/u1`]: { data: 'x' },
			[`shared/${PID}/scenes/s1/crdt/c1`]: { data: 'x' }
		});

		const result = await stopSharing(db, 'owner1', { pid: PID, project: stopping(active) });

		expect(result.copiedBack).toBe(6);
		expect(result.project.sharing).toBeUndefined();
		expect(await idsOf('scenes')).toEqual(['s1', 's2']);
		expect(await idsOf('chapters')).toEqual(['c1']);
		expect(await idsOf('worldbuilding')).toEqual(['w1']);
		expect((await dataOf('scenes/s1'))?.projectId).toBe(PID);

		// 他人の presence はルール上オーナーでも消せないので残る(それ以外は空)
		expect(await allSharedPaths()).toEqual(['presence/viewer1']);
		expect(await idsOf(`shared/${PID}/scenes/s1/updates`)).toEqual([]);
		expect(await idsOf(`shared/${PID}/scenes/s1/crdt`)).toEqual([]);

		const pointer = await dataOf(`projects/${PID}`);
		expect(pointer?.title).toBe('タイトル');
		expect(pointer?.sharing).toBeUndefined();
	});

	it('共有側で編集された内容は最上位に戻る(共有側が新しい場合)', async () => {
		const { db, active } = await started();
		await seed(env, {
			[`shared/${PID}/scenes/s1`]: entity('s1', 500, { title: 'ゲストの編集' }),
			[`shared/${PID}/scenes/guest-new`]: entity('guest-new', 500)
		});
		await stopSharing(db, 'owner1', { pid: PID, project: stopping(active) });
		expect((await dataOf('scenes/s1'))?.title).toBe('ゲストの編集');
		expect(await idsOf('scenes')).toEqual(['guest-new', 's1', 's2']);
	});

	it('再実行しても壊れない(途中まで進んだ状態から完了する)', async () => {
		const { db, active } = await started();
		// 書き戻し済み・shared は一部削除済み、ポインタは sharing が残ったまま、という状態を作る
		await seed(env, {
			'scenes/s1': entity('s1'),
			'scenes/s2': entity('s2')
		});
		await env.withSecurityRulesDisabled(async (ctx) => {
			const { deleteDoc } = await import('firebase/firestore');
			await deleteDoc(doc(ctx.firestore(), `shared/${PID}/scenes/s1`));
		});

		await stopSharing(db, 'owner1', { pid: PID, project: stopping(active) });
		await stopSharing(db, 'owner1', { pid: PID, project: stopping(active) });

		expect(await idsOf('scenes')).toEqual(['s1', 's2']);
		expect(await allSharedPaths()).toEqual([]);
		expect((await dataOf(`projects/${PID}`))?.sharing).toBeUndefined();
	});

	it('開始 → 停止 → 再開始ができる', async () => {
		const { db, active } = await started();
		const stopped = await stopSharing(db, 'owner1', { pid: PID, project: stopping(active) });
		const again = await startSharing(db, 'owner1', {
			pid: PID,
			project: { ...migratingProject(), updatedAt: stopped.project.updatedAt },
			children: localChildren()
		});
		expect(again.removedFromTopLevel).toBe(6);
		expect(await idsOf(`shared/${PID}/scenes`)).toEqual(['s1', 's2']);
	});

	it('非オーナーは拒否される', async () => {
		const { active } = await started();
		await expect(
			stopSharing(fs(env, 'stranger'), 'stranger', { pid: PID, project: stopping(active) })
		).rejects.toMatchObject({ code: 'permission-denied' });
		expect(await idsOf(`shared/${PID}/scenes`)).toEqual(['s1', 's2']);
	});
});

describe('共有の管理', () => {
	it('公開範囲・秘密・ポインタの更新、メンバーの一覧と削除', async () => {
		await seedTopLevel();
		const db = fs(env, 'owner1');
		const result = await startSharing(db, 'owner1', {
			pid: PID,
			project: migratingProject(),
			children: localChildren()
		});

		await setVisibility(db, PID, 'private');
		expect(await dataOf(`shared/${PID}`)).toMatchObject({ visibility: 'private' });

		await writeSecret(db, PID, 'editor', 'new-editor-secret');
		expect(await dataOf(`shared/${PID}/secrets/editor`)).toEqual({ value: 'new-editor-secret' });
		await assertFails(getDoc(doc(db, `shared/${PID}/secrets/editor`)));

		const next = {
			...result.project.sharing!,
			visibility: 'private' as const,
			secrets: { viewer: 'viewer-secret', editor: 'new-editor-secret' }
		};
		await writeSharingInfo(db, PID, next);
		expect((await dataOf(`projects/${PID}`))?.sharing).toMatchObject({
			visibility: 'private',
			secrets: { editor: 'new-editor-secret' }
		});
		const copy = await dataOf(`shared/${PID}/projects/${PID}`);
		expect(copy?.sharing).toMatchObject({ visibility: 'private' });
		expect((copy?.sharing as Data).secrets).toBeUndefined();

		// メンバー(参加は 2b-3 のクライアントが行うので、ここでは seed)
		await seed(env, {
			[`shared/${PID}/members/u-old`]: { role: 'viewer', secret: 'viewer-secret', joinedAt: 10 },
			[`shared/${PID}/members/u-new`]: {
				role: 'editor',
				secret: 'editor-secret',
				joinedAt: 20,
				name: 'ゲスト'
			}
		});
		expect(await listMembers(db, PID)).toEqual([
			{ uid: 'u-old', role: 'viewer', joinedAt: 10 },
			{ uid: 'u-new', role: 'editor', joinedAt: 20, name: 'ゲスト' }
		]);
		await removeMember(db, PID, 'u-old');
		expect((await listMembers(db, PID)).map((m) => m.uid)).toEqual(['u-new']);

		// 非オーナーは管理できない
		const stranger = fs(env, 'stranger');
		await assertFails(setVisibility(stranger, PID, 'link'));
		await assertFails(writeSecret(stranger, PID, 'viewer', 'x'));
		await assertFails(removeMember(stranger, PID, 'u-new'));
	});

	it('removePointerSharing / deleteSharedData(プロジェクト削除の前処理)', async () => {
		await seedTopLevel();
		const db = fs(env, 'owner1');
		await startSharing(db, 'owner1', {
			pid: PID,
			project: migratingProject(),
			children: localChildren()
		});
		await seed(env, { [`shared/${PID}/scenes/s1/updates/u1`]: { data: 'x' } });

		await deleteSharedData(db, PID);
		await removePointerSharing(db, PID);
		expect(await allSharedPaths()).toEqual([]);
		expect((await dataOf(`projects/${PID}`))?.sharing).toBeUndefined();
		expect((await dataOf(`projects/${PID}`))?.title).toBe('タイトル');

		// ポインタが無くても失敗しない
		await removePointerSharing(db, OTHER);
	});

	it('activeProject は migration を除いて active にする', () => {
		const active = activeProject(migratingProject());
		expect(active.sharing).toMatchObject({ status: 'active' });
		expect(active.sharing).not.toHaveProperty('migration');
	});
});
