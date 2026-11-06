import { afterAll, beforeEach, describe, it } from 'vitest';
import {
	assertFails,
	assertSucceeds,
	type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { OWNER_KEY, baseSeed, createEnv, dbOf, seed, unauthDb } from './helpers';

let env: RulesTestEnvironment;

beforeEach(async () => {
	env ??= await createEnv();
	await env.clearFirestore();
});
afterAll(async () => {
	await env?.cleanup();
});

const bootstrapBatch = (db: ReturnType<typeof dbOf>, uid: string, key: string) => {
	const b = writeBatch(db);
	b.set(doc(db, '_config/ownerKey'), { key });
	b.set(doc(db, `owners/${uid}`), { key });
	return b;
};

describe('未認証', () => {
	it('すべて拒否される', async () => {
		await seed(env, baseSeed('link'));
		const db = unauthDb(env);
		for (const path of [
			'projects/legacy1',
			'shared/p1',
			'shared/p1/projects/p1',
			'owners/owner1',
			'_config/ownerKey',
			'shared/p1/members/viewer1'
		]) {
			await assertFails(getDoc(doc(db, path)));
		}
		await assertFails(setDoc(doc(db, 'projects/x'), { a: 1 }));
		await assertFails(setDoc(doc(db, 'owners/x'), { key: 'k' }));
		await assertFails(bootstrapBatch(db, 'x', 'k').commit());
	});
});

describe('オーナー bootstrap', () => {
	it('初回端末は 1 batch で ownerKey と owners を作成できる', async () => {
		await assertSucceeds(bootstrapBatch(dbOf(env, 'u1'), 'u1', 'k1').commit());
		await assertSucceeds(getDoc(doc(dbOf(env, 'u1'), 'owners/u1')));
		await assertSucceeds(setDoc(doc(dbOf(env, 'u1'), 'projects/a'), { t: 1 }));
	});

	it('先着: 競合した後続の bootstrap は ownerKey 既存のため拒否される(仕様)', async () => {
		await assertSucceeds(bootstrapBatch(dbOf(env, 'u1'), 'u1', 'k1').commit());
		await assertFails(bootstrapBatch(dbOf(env, 'u2'), 'u2', 'k2').commit());
	});

	it('ownerKey が既にある状態で別鍵の bootstrap は拒否される', async () => {
		await seed(env, { '_config/ownerKey': { key: 'k1' }, 'owners/u1': { key: 'k1' } });
		await assertFails(bootstrapBatch(dbOf(env, 'u2'), 'u2', 'other').commit());
	});

	it('bootstrap で ownerKey と owners の key が不一致なら拒否', async () => {
		const db = dbOf(env, 'u1');
		const b = writeBatch(db);
		b.set(doc(db, '_config/ownerKey'), { key: 'a' });
		b.set(doc(db, 'owners/u1'), { key: 'b' });
		await assertFails(b.commit());
	});

	it('ownerKey だけ(owners 無し)の作成は拒否', async () => {
		await assertFails(setDoc(doc(dbOf(env, 'u1'), '_config/ownerKey'), { key: 'k' }));
	});

	it('他人の uid で bootstrap は拒否', async () => {
		const db = dbOf(env, 'u1');
		const b = writeBatch(db);
		b.set(doc(db, '_config/ownerKey'), { key: 'k' });
		b.set(doc(db, 'owners/u2'), { key: 'k' });
		await assertFails(b.commit());
	});

	it('正しい鍵で 2 台目を登録できる', async () => {
		await seed(env, { '_config/ownerKey': { key: 'k1' }, 'owners/u1': { key: 'k1' } });
		await assertSucceeds(setDoc(doc(dbOf(env, 'u2'), 'owners/u2'), { key: 'k1' }));
	});

	it('誤った鍵の 2 台目は拒否', async () => {
		await seed(env, { '_config/ownerKey': { key: 'k1' }, 'owners/u1': { key: 'k1' } });
		await assertFails(setDoc(doc(dbOf(env, 'u2'), 'owners/u2'), { key: 'wrong' }));
	});

	it('鍵未設定で owners だけ作ろうとすると拒否', async () => {
		await assertFails(setDoc(doc(dbOf(env, 'u2'), 'owners/u2'), { key: 'k1' }));
	});

	it('他人の uid の owners は作れない', async () => {
		await seed(env, { '_config/ownerKey': { key: 'k1' }, 'owners/u1': { key: 'k1' } });
		await assertFails(setDoc(doc(dbOf(env, 'u2'), 'owners/u3'), { key: 'k1' }));
	});
});

describe('ownerKey / owners の管理', () => {
	beforeEach(async () => {
		await seed(env, baseSeed());
	});

	it('ownerKey は誰も read できない(オーナーでも)', async () => {
		await assertFails(getDoc(doc(dbOf(env, 'owner1'), '_config/ownerKey')));
		await assertFails(getDoc(doc(dbOf(env, 'viewer1'), '_config/ownerKey')));
	});

	it('オーナーは鍵をローテーションでき、旧鍵では 2 台目登録できなくなる', async () => {
		await assertSucceeds(
			updateDoc(doc(dbOf(env, 'owner1'), '_config/ownerKey'), { key: 'new-key' })
		);
		await assertFails(setDoc(doc(dbOf(env, 'u2'), 'owners/u2'), { key: OWNER_KEY }));
		await assertSucceeds(setDoc(doc(dbOf(env, 'u2'), 'owners/u2'), { key: 'new-key' }));
	});

	it('非オーナーは鍵を更新・削除できない', async () => {
		await assertFails(updateDoc(doc(dbOf(env, 'viewer1'), '_config/ownerKey'), { key: 'x' }));
		await assertFails(deleteDoc(doc(dbOf(env, 'viewer1'), '_config/ownerKey')));
	});

	it('オーナーは他端末を失効(delete)でき、失効後は従来データに触れない', async () => {
		await seed(env, { 'owners/owner2': { key: OWNER_KEY } });
		await assertSucceeds(getDoc(doc(dbOf(env, 'owner2'), 'projects/legacy1')));
		await assertSucceeds(deleteDoc(doc(dbOf(env, 'owner1'), 'owners/owner2')));
		await assertFails(getDoc(doc(dbOf(env, 'owner2'), 'projects/legacy1')));
	});

	it('非オーナーは owners を delete できない', async () => {
		await assertFails(deleteDoc(doc(dbOf(env, 'viewer1'), 'owners/owner1')));
	});

	it('owners の read は自分自身かオーナー', async () => {
		await assertSucceeds(getDoc(doc(dbOf(env, 'owner1'), 'owners/owner1')));
		await assertSucceeds(getDoc(doc(dbOf(env, 'viewer1'), 'owners/viewer1')));
		await assertFails(getDoc(doc(dbOf(env, 'viewer1'), 'owners/owner1')));
	});

	it('owners の update は拒否(オーナーでも)', async () => {
		await assertFails(updateDoc(doc(dbOf(env, 'owner1'), 'owners/owner1'), { key: 'z' }));
	});
});

describe('従来コレクション', () => {
	beforeEach(async () => {
		await seed(env, baseSeed());
	});

	it('オーナーは 6 コレクションとネストを read/write できる', async () => {
		const db = dbOf(env, 'owner1');
		for (const col of ['projects', 'chapters', 'scenes', 'characters', 'plots', 'worldbuilding']) {
			await assertSucceeds(setDoc(doc(db, `${col}/a`), { t: 1 }));
			await assertSucceeds(getDoc(doc(db, `${col}/a`)));
		}
		await assertSucceeds(setDoc(doc(db, 'scenes/a/updates/u'), { t: 1 }));
		await assertSucceeds(deleteDoc(doc(db, 'projects/a')));
	});

	it('定義外のコレクションはオーナーでも拒否', async () => {
		await assertFails(setDoc(doc(dbOf(env, 'owner1'), 'unknown/a'), { t: 1 }));
		await assertFails(getDoc(doc(dbOf(env, 'owner1'), 'unknown/a')));
	});

	it('非オーナー(メンバー含む)は read/write 不可', async () => {
		for (const uid of ['viewer1', 'editor1', 'stranger']) {
			const db = dbOf(env, uid);
			await assertFails(getDoc(doc(db, 'projects/legacy1')));
			await assertFails(setDoc(doc(db, 'projects/legacy1'), { t: 2 }));
			await assertFails(setDoc(doc(db, 'scenes/a/updates/u'), { t: 2 }));
		}
	});
});
