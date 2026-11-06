import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
	removeMember,
	startSharing,
	writeSecret,
	writeSharingInfo
} from '../../src/lib/firebase/sharing';
import {
	JOIN_CHILD_TYPES,
	diagnoseDenied,
	fetchSharedSnapshot,
	joinSharedProject,
	leaveSharedProject,
	ProjectMissingError
} from '../../src/lib/firebase/join';
import { classifyJoinError, isPermissionDeniedError } from '../../src/lib/firebase/joinPolicy';
import type { Project } from '../../src/lib/types/project';
import { PROJECT_ID, OWNER_KEY, createEnv, dbOf, seed } from './helpers';

// 参加・取得・退出のクライアント実装(join.ts)を、実際のルールに対して直接呼ぶ。
// ホスト側は startSharing(sharing.ts)で共有を開始した状態から始める。

const PID = '3b1d6a1e-6f0a-4c2e-9a53-0d3f2b7e8c41';
const MISSING_PID = '9c7e2f10-1111-4222-8333-444455556666';

// トークン方式(閲覧)とパスワード方式(編集)
const VIEWER_TOKEN = 'Zm9vYmFyLXRva2VuLWZvci12aWV3ZXItMDAwMDAwMDAwMA';
const EDITOR_PASSWORD = '合言葉 pass-word 12';

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

const entity = (id: string, extra: Data = {}): Data => ({
	id,
	projectId: PID,
	title: id,
	updatedAt: 100,
	_version: 1,
	...extra
});

const hostProject = (visibility: 'private' | 'link' = 'private'): Project => ({
	id: PID,
	title: 'ホストの作品',
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
	sharing: {
		pid: PID,
		role: 'owner',
		visibility,
		status: 'migrating',
		secrets: { viewer: VIEWER_TOKEN, editor: EDITOR_PASSWORD },
		startedAt: 1000,
		migration: 'start'
	}
});

/** ホスト(owner1)が共有を開始した状態を作る */
async function hostShares(visibility: 'private' | 'link' = 'private') {
	await seed(env, { '_config/ownerKey': { key: OWNER_KEY }, 'owners/owner1': { key: OWNER_KEY } });
	await startSharing(fs(env, 'owner1'), 'owner1', {
		pid: PID,
		project: hostProject(visibility),
		children: {
			chapters: [entity('c1')],
			scenes: [entity('s1'), entity('s2')],
			characters: [entity('ch1')],
			plots: [],
			worldbuilding: [entity('w1')]
		}
	});
}

async function memberDoc(uid: string): Promise<Data | undefined> {
	let data: Data | undefined;
	await env.withSecurityRulesDisabled(async (ctx) => {
		const snap = await getDoc(doc(ctx.firestore(), `shared/${PID}/members/${uid}`));
		data = snap.exists() ? (snap.data() as Data) : undefined;
	});
	return data;
}

const rejectsDenied = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e
	);
	expect(error, '拒否されるはず').toBeDefined();
	expect(isPermissionDeniedError(error)).toBe(true);
	return error;
};

describe('参加(members の作成)', () => {
	it('正しいトークンで viewer として参加できる。メンバー文書は {role, secret, joinedAt}', async () => {
		await hostShares();
		const result = await joinSharedProject(fs(env, 'guest1'), 'guest1', {
			pid: PID,
			role: 'viewer',
			secret: VIEWER_TOKEN
		});
		expect(result).toEqual({ role: 'viewer', alreadyMember: false });
		const member = await memberDoc('guest1');
		expect(member).toMatchObject({ role: 'viewer', secret: VIEWER_TOKEN });
		expect(member?.joinedAt).toBeDefined();
		expect(member).not.toHaveProperty('name');
	});

	it('正しいパスワード(日本語・空白入り)で editor として参加できる。名前も付けられる', async () => {
		await hostShares();
		await joinSharedProject(fs(env, 'guest2'), 'guest2', {
			pid: PID,
			role: 'editor',
			secret: EDITOR_PASSWORD,
			name: 'ゲスト太郎'
		});
		expect(await memberDoc('guest2')).toMatchObject({
			role: 'editor',
			secret: EDITOR_PASSWORD,
			name: 'ゲスト太郎'
		});
	});

	it('誤った秘密は拒否される(permission-denied)。メンバー文書は作られない', async () => {
		await hostShares();
		await rejectsDenied(
			joinSharedProject(fs(env, 'guest1'), 'guest1', {
				pid: PID,
				role: 'editor',
				secret: 'wrong-password'
			})
		);
		expect(await memberDoc('guest1')).toBeUndefined();
	});

	it('存在しない pid は拒否される', async () => {
		await hostShares();
		await rejectsDenied(
			joinSharedProject(fs(env, 'guest1'), 'guest1', {
				pid: MISSING_PID,
				role: 'viewer',
				secret: VIEWER_TOKEN
			})
		);
	});

	it('viewer の秘密で editor を名乗ると拒否される(逆も同様)', async () => {
		await hostShares();
		await rejectsDenied(
			joinSharedProject(fs(env, 'guest1'), 'guest1', {
				pid: PID,
				role: 'editor',
				secret: VIEWER_TOKEN
			})
		);
		await rejectsDenied(
			joinSharedProject(fs(env, 'guest1'), 'guest1', {
				pid: PID,
				role: 'viewer',
				secret: EDITOR_PASSWORD
			})
		);
		expect(await memberDoc('guest1')).toBeUndefined();
	});

	it('拒否のエラーは、日本語の案内に分類される', async () => {
		await hostShares();
		const error = await rejectsDenied(
			joinSharedProject(fs(env, 'guest1'), 'guest1', {
				pid: PID,
				role: 'editor',
				secret: 'wrong'
			})
		);
		const failure = classifyJoinError(error, 'member', { passwordInvite: true });
		expect(failure.code).toBe('denied');
		expect(failure.message).toContain('パスワードが違う');
	});

	it('既にメンバーで役割が同じなら、作り直さずに成功する', async () => {
		await hostShares();
		const db = fs(env, 'guest1');
		await joinSharedProject(db, 'guest1', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		const result = await joinSharedProject(db, 'guest1', {
			pid: PID,
			role: 'viewer',
			secret: VIEWER_TOKEN
		});
		expect(result).toEqual({ role: 'viewer', alreadyMember: true });
	});

	it('既にメンバーの人が別の役割の招待で入っても、役割は変わらない(秘密も検証されず、書き込みもしない)', async () => {
		await hostShares();
		const db = fs(env, 'guest1');
		await joinSharedProject(db, 'guest1', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });

		const result = await joinSharedProject(db, 'guest1', {
			pid: PID,
			role: 'editor',
			secret: EDITOR_PASSWORD
		});
		expect(result).toEqual({ role: 'viewer', alreadyMember: true });
		expect(await memberDoc('guest1')).toMatchObject({ role: 'viewer', secret: VIEWER_TOKEN });
	});

	it('役割を変えるには、オーナーがメンバーを削除してから入り直す', async () => {
		await hostShares();
		const db = fs(env, 'guest1');
		await joinSharedProject(db, 'guest1', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await removeMember(fs(env, 'owner1'), PID, 'guest1');
		const result = await joinSharedProject(db, 'guest1', {
			pid: PID,
			role: 'editor',
			secret: EDITOR_PASSWORD
		});
		expect(result).toEqual({ role: 'editor', alreadyMember: false });
		expect(await memberDoc('guest1')).toMatchObject({ role: 'editor' });
	});

	it('メンバーの更新(自己昇格)はルールで禁止されたまま', async () => {
		await hostShares();
		const db = fs(env, 'guest1');
		await joinSharedProject(db, 'guest1', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await assertFails(
			setDoc(doc(db, `shared/${PID}/members/guest1`), {
				role: 'editor',
				secret: EDITOR_PASSWORD
			})
		);
	});
});

describe('参加後のデータ取得', () => {
	it('メンバーは、プロジェクトのコピーと全子要素を取得できる(projectId / sharing は除いてある)', async () => {
		await hostShares();
		const db = fs(env, 'guest1');
		await joinSharedProject(db, 'guest1', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });

		const snapshot = await fetchSharedSnapshot(db, PID);
		expect(snapshot.project).toMatchObject({ id: PID, title: 'ホストの作品' });
		expect(snapshot.project).not.toHaveProperty('projectId');
		expect(snapshot.project).not.toHaveProperty('sharing');
		expect(snapshot.metaName).toBe('ホストの作品');
		expect(snapshot.metaVisibility).toBe('private');
		expect(snapshot.children.scenes.map((e) => e.id).sort()).toEqual(['s1', 's2']);
		expect(snapshot.children.chapters.map((e) => e.id)).toEqual(['c1']);
		expect(snapshot.children.characters.map((e) => e.id)).toEqual(['ch1']);
		expect(snapshot.children.plots).toEqual([]);
		expect(snapshot.children.worldbuilding.map((e) => e.id)).toEqual(['w1']);
		for (const type of JOIN_CHILD_TYPES) {
			for (const e of snapshot.children[type]) {
				// サーバー時刻は数値(ミリ秒)にそろえてある
				expect(typeof e.syncedAt).toBe('number');
			}
		}
	});

	it('参加前(非メンバー、private)は取得できない', async () => {
		await hostShares();
		await rejectsDenied(fetchSharedSnapshot(fs(env, 'stranger'), PID));
	});

	it('link 公開なら、参加していなくても読める(書き込みはできない)', async () => {
		await hostShares('link');
		const db = fs(env, 'stranger');
		const snapshot = await fetchSharedSnapshot(db, PID);
		expect(snapshot.project).toMatchObject({ id: PID });
		expect(snapshot.metaVisibility).toBe('link');
		await assertFails(setDoc(doc(db, `shared/${PID}/scenes/x`), entity('x')));
	});

	it('共有側のコピーが無いプロジェクトは project が undefined(呼び出し側が ProjectMissingError にする)', async () => {
		await hostShares();
		const db = fs(env, 'guest1');
		await joinSharedProject(db, 'guest1', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await env.withSecurityRulesDisabled(async (ctx) => {
			await deleteDoc(doc(ctx.firestore(), `shared/${PID}/projects/${PID}`));
		});
		const snapshot = await fetchSharedSnapshot(db, PID);
		expect(snapshot.project).toBeUndefined();
		expect(new ProjectMissingError().message).toContain('見つかりません');
	});
});

describe('権限の反映', () => {
	it('viewer は読めるが書けない。editor は書ける', async () => {
		await hostShares();
		const viewer = fs(env, 'viewer1');
		const editor = fs(env, 'editor1');
		await joinSharedProject(viewer, 'viewer1', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await joinSharedProject(editor, 'editor1', {
			pid: PID,
			role: 'editor',
			secret: EDITOR_PASSWORD
		});

		const scene = `shared/${PID}/scenes/s1`;
		await assertSucceeds(getDoc(doc(viewer, scene)));
		await assertFails(setDoc(doc(viewer, scene), entity('s1', { title: '改ざん' })));
		await assertFails(setDoc(doc(viewer, `shared/${PID}/scenes/new`), entity('new')));
		await assertFails(deleteDoc(doc(viewer, scene)));

		await assertSucceeds(
			setDoc(doc(editor, scene), entity('s1', { title: '編集', updatedAt: 200 }))
		);
		await assertSucceeds(setDoc(doc(editor, `shared/${PID}/scenes/new`), entity('new')));
		await assertSucceeds(deleteDoc(doc(editor, `shared/${PID}/scenes/new`)));

		// 他人の projectId を名乗る書き込みは、editor でも拒否される
		await assertFails(
			setDoc(doc(editor, `shared/${PID}/scenes/bad`), entity('bad', { projectId: MISSING_PID }))
		);
	});

	it('メンバーは自分のメンバー文書を読める。他人のは読めない', async () => {
		await hostShares();
		const a = fs(env, 'guestA');
		const b = fs(env, 'guestB');
		await joinSharedProject(a, 'guestA', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await joinSharedProject(b, 'guestB', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await assertSucceeds(getDoc(doc(a, `shared/${PID}/members/guestA`)));
		await assertFails(getDoc(doc(a, `shared/${PID}/members/guestB`)));
		await assertFails(getDocs(collection(a, `shared/${PID}/members`)));
	});
});

describe('退出', () => {
	it('自分のメンバー文書と在席情報が消え、以後は読めなくなる', async () => {
		await hostShares();
		const db = fs(env, 'guest1');
		await joinSharedProject(db, 'guest1', { pid: PID, role: 'editor', secret: EDITOR_PASSWORD });
		await setDoc(doc(db, `shared/${PID}/presence/guest1`), { at: 1 });

		await leaveSharedProject(db, 'guest1', PID);

		expect(await memberDoc('guest1')).toBeUndefined();
		await env.withSecurityRulesDisabled(async (ctx) => {
			const snap = await getDoc(doc(ctx.firestore(), `shared/${PID}/presence/guest1`));
			expect(snap.exists()).toBe(false);
		});
		await rejectsDenied(fetchSharedSnapshot(db, PID));
	});

	it('他のメンバーには影響しない', async () => {
		await hostShares();
		await joinSharedProject(fs(env, 'a'), 'a', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await joinSharedProject(fs(env, 'b'), 'b', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await leaveSharedProject(fs(env, 'a'), 'a', PID);
		expect(await memberDoc('b')).toBeDefined();
		await assertSucceeds(fetchSharedSnapshot(fs(env, 'b'), PID));
	});

	it('既にメンバーでない(削除済み)場合も、エラーにならない', async () => {
		await hostShares();
		await leaveSharedProject(fs(env, 'ghost'), 'ghost', PID);
	});

	it('他人のメンバー文書は削除できない', async () => {
		await hostShares();
		await joinSharedProject(fs(env, 'a'), 'a', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await assertFails(deleteDoc(doc(fs(env, 'b'), `shared/${PID}/members/a`)));
	});
});

describe('アクセス権の失効(permission-denied になる)', () => {
	it('オーナーがメンバーを削除すると、読み取りも書き込みも permission-denied になる', async () => {
		await hostShares();
		const guest = fs(env, 'editor1');
		await joinSharedProject(guest, 'editor1', {
			pid: PID,
			role: 'editor',
			secret: EDITOR_PASSWORD
		});
		await assertSucceeds(fetchSharedSnapshot(guest, PID));

		await removeMember(fs(env, 'owner1'), PID, 'editor1');

		await rejectsDenied(fetchSharedSnapshot(guest, PID));
		await rejectsDenied(
			setDoc(doc(guest, `shared/${PID}/scenes/s1`), entity('s1', { title: '失効後' }))
		);
		await rejectsDenied(getDocs(collection(guest, `shared/${PID}/scenes`)));
	});

	it('メンバーを削除されたあとの再参加は、同じ秘密ならできる(秘密を再生成すると、古い秘密では不可)', async () => {
		await hostShares();
		const guest = fs(env, 'g');
		await joinSharedProject(guest, 'g', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await removeMember(fs(env, 'owner1'), PID, 'g');
		await joinSharedProject(guest, 'g', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await assertSucceeds(fetchSharedSnapshot(guest, PID));

		// 秘密の再生成: 以前のリンクは使えなくなるが、参加済みのメンバーは失効しない
		const owner = fs(env, 'owner1');
		await removeMember(owner, PID, 'g');
		await writeSecret(owner, PID, 'viewer', 'new-viewer-secret');
		await rejectsDenied(
			joinSharedProject(guest, 'g', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN })
		);
		await joinSharedProject(guest, 'g', { pid: PID, role: 'viewer', secret: 'new-viewer-secret' });
		await assertSucceeds(fetchSharedSnapshot(guest, PID));
	});

	it('秘密の再生成だけでは既存メンバーは失効しない', async () => {
		await hostShares();
		const guest = fs(env, 'g');
		await joinSharedProject(guest, 'g', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await writeSecret(fs(env, 'owner1'), PID, 'viewer', 'rotated');
		await assertSucceeds(fetchSharedSnapshot(guest, PID));
	});

	it('共有の停止(shared 配下の削除)後は、メンバーだった人も permission-denied', async () => {
		await hostShares();
		const guest = fs(env, 'g');
		await joinSharedProject(guest, 'g', { pid: PID, role: 'editor', secret: EDITOR_PASSWORD });
		await env.withSecurityRulesDisabled(async (ctx) => {
			const admin = ctx.firestore();
			await deleteDoc(doc(admin, `shared/${PID}/members/g`));
			await deleteDoc(doc(admin, `shared/${PID}`));
		});
		await rejectsDenied(fetchSharedSnapshot(guest, PID));
	});

	it('失効の判定に使うエラーは isPermissionDeniedError で検出できる', async () => {
		await hostShares();
		const error = await fetchSharedSnapshot(fs(env, 'nobody'), PID).catch((e: unknown) => e);
		expect(isPermissionDeniedError(error)).toBe(true);
	});

	it('owner が presence を削除できる(メンバー削除後の片付け)', async () => {
		await hostShares();
		const guest = fs(env, 'g');
		await joinSharedProject(guest, 'g', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		await setDoc(doc(guest, `shared/${PID}/presence/g`), { at: 1 });
		await removeMember(fs(env, 'owner1'), PID, 'g');
		await assertSucceeds(deleteDoc(doc(fs(env, 'owner1'), `shared/${PID}/presence/g`)));
	});

	it('writeSharingInfo で公開範囲を変えても、メンバーの読み取りは続く(private のまま)', async () => {
		await hostShares();
		const guest = fs(env, 'g');
		await joinSharedProject(guest, 'g', { pid: PID, role: 'viewer', secret: VIEWER_TOKEN });
		const sharing = hostProject().sharing!;
		await writeSharingInfo(fs(env, 'owner1'), PID, { ...sharing, status: 'active' });
		await assertSucceeds(fetchSharedSnapshot(guest, PID));
	});
});

describe('旧ルールの Firebase の判別(diagnoseDenied)', () => {
	it('新ルールでは自分の owners/{uid} が読める(missing)ので new-rules', async () => {
		await hostShares();
		expect(await diagnoseDenied(fs(env, 'guest1'), 'guest1')).toBe('new-rules');
	});

	it('旧ルール(従来コレクションだけ全開放)では legacy-rules。参加はルール未適用として案内される', async () => {
		const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
		const legacy = await initializeTestEnvironment({
			projectId: `${PROJECT_ID}-legacy`,
			firestore: {
				host,
				port: Number(port),
				rules: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{col}/{document=**} {
      allow read, write: if request.auth != null
        && col in ['projects', 'chapters', 'scenes', 'characters', 'plots', 'worldbuilding'];
    }
  }
}`
			}
		});
		try {
			const db = legacy.authenticatedContext('guest1').firestore() as unknown as Firestore;
			expect(await diagnoseDenied(db, 'guest1')).toBe('legacy-rules');

			const error = await joinSharedProject(db, 'guest1', {
				pid: PID,
				role: 'viewer',
				secret: VIEWER_TOKEN
			}).catch((e: unknown) => e);
			expect(isPermissionDeniedError(error)).toBe(true);
			const failure = classifyJoinError(error, 'member', { legacyRules: true });
			expect(failure.code).toBe('legacy-rules');
			expect(failure.message).toContain('新しいルール');
		} finally {
			await legacy.cleanup();
		}
	});
});
