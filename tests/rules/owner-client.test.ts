import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, limit, query } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
	bootstrapOwner,
	detectAccessMode,
	getOwnStatus,
	joinAsOwner,
	runDiagnosticProbes
} from '../../src/lib/firebase/owner';
import { PROJECT_ID, createEnv, dbOf } from './helpers';

// クライアント実装(owner.ts)を、実際のルールに対して直接呼ぶ。

// 段階2a より前の「認証済みなら従来 6 コレクションを全開放」ルール(git show 2f09114:firestore.rules と同じ内容)
const LEGACY_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{collection}/{document=**} {
      allow read, write: if request.auth != null
        && collection in ['projects', 'chapters', 'scenes', 'characters', 'plots', 'worldbuilding'];
    }
  }
}
`;

const fs = (env: RulesTestEnvironment, uid: string) => dbOf(env, uid) as unknown as Firestore;

let env: RulesTestEnvironment;
let legacyEnv: RulesTestEnvironment;

beforeAll(async () => {
	env = await createEnv();
	const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
	legacyEnv = await initializeTestEnvironment({
		projectId: `${PROJECT_ID}-legacy`,
		firestore: { rules: LEGACY_RULES, host, port: Number(port) }
	});
});
beforeEach(async () => {
	await env.clearFirestore();
	await legacyEnv.clearFirestore();
});
afterAll(async () => {
	await env?.cleanup();
	await legacyEnv?.cleanup();
});

describe('新ルール下のオーナー登録', () => {
	it('初回端末は bootstrap で owner になり、鍵が返る。再判定でも owner', async () => {
		const a = fs(env, 'devA');
		const first = await detectAccessMode(a, 'devA');
		expect(first.mode).toBe('owner');
		expect(first.ownerKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

		await env.withSecurityRulesDisabled(async (ctx) => {
			const cfg = await getDoc(doc(ctx.firestore(), '_config/ownerKey'));
			expect(cfg.data()).toEqual({ key: first.ownerKey });
			const own = await getDoc(doc(ctx.firestore(), 'owners/devA'));
			expect(own.data()?.key).toBe(first.ownerKey);
		});

		// ローカルの鍵が無くても、登録済みなら owners/{uid} の鍵を復元できる
		const again = await detectAccessMode(a, 'devA');
		expect(again).toMatchObject({ mode: 'owner', own: 'exists', ownerKey: first.ownerKey });
		expect(await getOwnStatus(a, 'devA')).toBe('exists');
	});

	it('2 台目は設定コード由来の鍵で joinAsOwner でき、従来コレクションにアクセスできる', async () => {
		const first = await detectAccessMode(fs(env, 'devA'), 'devA');
		const b = fs(env, 'devB');

		const joined = await detectAccessMode(b, 'devB', first.ownerKey);
		expect(joined).toMatchObject({ mode: 'owner', ownerKey: first.ownerKey, register: 'ok' });
		await getDocs(query(collection(b, 'projects'), limit(1)));
	});

	it('鍵なしの別端末は needs-owner で、従来コレクションにアクセスできない', async () => {
		await detectAccessMode(fs(env, 'devA'), 'devA');
		const c = fs(env, 'devC');

		const result = await detectAccessMode(c, 'devC');
		expect(result).toMatchObject({ mode: 'needs-owner', register: 'denied' });
		expect(result.ownerKey).toBeUndefined();
		await assertFails(getDocs(query(collection(c, 'projects'), limit(1))));
	});

	it('誤った鍵の端末も needs-owner', async () => {
		await detectAccessMode(fs(env, 'devA'), 'devA');
		const d = fs(env, 'devD');
		const result = await detectAccessMode(d, 'devD', 'wrong-key');
		expect(result.mode).toBe('needs-owner');
		expect(await getOwnStatus(d, 'devD')).toBe('missing');
	});

	it('bootstrapOwner / joinAsOwner の個別の結果', async () => {
		const a = fs(env, 'devA');
		const boot = await bootstrapOwner(a, 'devA');
		expect(boot.ok).toBe(true);
		if (!boot.ok) return;

		const second = await bootstrapOwner(fs(env, 'devB'), 'devB');
		expect(second).toMatchObject({ ok: false, reason: 'denied' });

		expect(await joinAsOwner(fs(env, 'devB'), 'devB', 'bad')).toMatchObject({
			ok: false,
			reason: 'denied'
		});
		expect(await joinAsOwner(fs(env, 'devB'), 'devB', boot.key)).toEqual({
			ok: true,
			key: boot.key
		});
	});

	it('鍵が失効(owners 削除)した端末は未登録に戻る', async () => {
		const first = await detectAccessMode(fs(env, 'devA'), 'devA');
		await env.withSecurityRulesDisabled(async (ctx) => {
			const { deleteDoc } = await import('firebase/firestore');
			await deleteDoc(doc(ctx.firestore(), 'owners/devA'));
		});
		// ローカルの鍵が残っていれば、join で再登録できる
		const again = await detectAccessMode(fs(env, 'devA'), 'devA', first.ownerKey);
		expect(again.mode).toBe('owner');
	});

	it('診断は読み取りのみで、登録しない', async () => {
		const c = fs(env, 'devC');
		const before = await runDiagnosticProbes(c, 'devC');
		expect(before.find((i) => i.id === 'rules')?.status).toBe('ok');
		expect(before.find((i) => i.id === 'owner')?.status).toBe('ng');
		expect(await getOwnStatus(c, 'devC')).toBe('missing');

		await detectAccessMode(fs(env, 'devA'), 'devA');
		const after = await runDiagnosticProbes(fs(env, 'devA'), 'devA');
		expect(after.find((i) => i.id === 'owner')?.status).toBe('ok');
	});
});

describe('旧ルール下', () => {
	it('legacy と判定され、登録(書き込み)は行わない', async () => {
		const db = legacyEnv.authenticatedContext('devA').firestore() as unknown as Firestore;
		const result = await detectAccessMode(db, 'devA');
		expect(result).toMatchObject({ mode: 'legacy', own: 'denied', legacy: 'allowed' });
		expect(result.ownerKey).toBeUndefined();
		await legacyEnv.withSecurityRulesDisabled(async (ctx) => {
			const snap = await getDoc(doc(ctx.firestore(), '_config/ownerKey'));
			expect(snap.exists()).toBe(false);
		});
	});

	it('設定コード由来の鍵があっても legacy', async () => {
		const db = legacyEnv.authenticatedContext('devA').firestore() as unknown as Firestore;
		expect((await detectAccessMode(db, 'devA', 'some-key')).mode).toBe('legacy');
	});

	it('診断は旧ルールを示す', async () => {
		const db = legacyEnv.authenticatedContext('devA').firestore() as unknown as Firestore;
		const items = await runDiagnosticProbes(db, 'devA');
		expect(items.find((i) => i.id === 'rules')?.detail).toContain('旧ルール');
	});
});
