import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

export const PROJECT_ID = 'demo-storift';
export const PID = 'p1';
export const OTHER_PID = 'p2';

export async function createEnv(): Promise<RulesTestEnvironment> {
	const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
	return initializeTestEnvironment({
		projectId: PROJECT_ID,
		firestore: {
			rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
			host,
			port: Number(port)
		}
	});
}

export type Db = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;

export const dbOf = (env: RulesTestEnvironment, uid: string): Db =>
	env.authenticatedContext(uid).firestore();

export const unauthDb = (env: RulesTestEnvironment): Db => env.unauthenticatedContext().firestore();

/** ルールを無効化して初期データを投入する */
export async function seed(
	env: RulesTestEnvironment,
	docs: Record<string, Record<string, unknown>>
): Promise<void> {
	await env.withSecurityRulesDisabled(async (ctx) => {
		const db = ctx.firestore();
		for (const [path, data] of Object.entries(docs)) {
			await setDoc(doc(db, path), data);
		}
	});
}

export const OWNER_KEY = 'owner-key-1';

/** 標準的な初期状態: owner1 が登録済み、p1(private)・p2、各ロールの秘密、メンバー */
export const baseSeed = (visibility: 'private' | 'link' = 'private') => ({
	'_config/ownerKey': { key: OWNER_KEY },
	'owners/owner1': { key: OWNER_KEY },
	[`shared/${PID}`]: { visibility, name: 'P1' },
	[`shared/${PID}/secrets/viewer`]: { value: 'vs' },
	[`shared/${PID}/secrets/editor`]: { value: 'es' },
	[`shared/${PID}/members/viewer1`]: { role: 'viewer', secret: 'vs' },
	[`shared/${PID}/members/editor1`]: { role: 'editor', secret: 'es' },
	[`shared/${PID}/projects/${PID}`]: { projectId: PID, title: 't' },
	[`shared/${PID}/scenes/s1`]: { projectId: PID, title: 's' },
	[`shared/${PID}/scenes/s1/updates/u1`]: { data: 'x' },
	[`shared/${PID}/scenes/s1/crdt/c1`]: { data: 'x' },
	[`shared/${OTHER_PID}`]: { visibility: 'private' },
	[`shared/${OTHER_PID}/secrets/editor`]: { value: 'es2' },
	[`shared/${OTHER_PID}/members/editor2`]: { role: 'editor', secret: 'es2' },
	'projects/legacy1': { title: 'legacy' }
});
