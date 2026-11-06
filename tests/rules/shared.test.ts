import { afterAll, beforeEach, describe, it } from 'vitest';
import {
	assertFails,
	assertSucceeds,
	type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	query,
	setDoc,
	updateDoc,
	where
} from 'firebase/firestore';
import { OTHER_PID, PID, baseSeed, createEnv, dbOf, seed } from './helpers';

let env: RulesTestEnvironment;

beforeEach(async () => {
	env ??= await createEnv();
	await env.clearFirestore();
	await seed(env, baseSeed('private'));
});
afterAll(async () => {
	await env?.cleanup();
});

const meta = (uid: string, pid = PID) => getDoc(doc(dbOf(env, uid), `shared/${pid}`));

describe('shared メタ', () => {
	it('private: オーナー/メンバーは read 可、非メンバーと別 PJ のメンバーは不可', async () => {
		await assertSucceeds(meta('owner1'));
		await assertSucceeds(meta('viewer1'));
		await assertSucceeds(meta('editor1'));
		await assertFails(meta('stranger'));
		await assertFails(meta('editor2'));
	});

	it('link: 非メンバーも read 可', async () => {
		await seed(env, { [`shared/${PID}`]: { visibility: 'link' } });
		await assertSucceeds(meta('stranger'));
	});

	it('存在しないメタは非オーナーは read 不可', async () => {
		await assertFails(meta('stranger', 'nope'));
	});

	it('write はオーナーのみ', async () => {
		await assertSucceeds(setDoc(doc(dbOf(env, 'owner1'), 'shared/p9'), { visibility: 'link' }));
		await assertSucceeds(updateDoc(doc(dbOf(env, 'owner1'), `shared/${PID}`), { name: 'x' }));
		for (const uid of ['editor1', 'viewer1', 'stranger']) {
			await assertFails(updateDoc(doc(dbOf(env, uid), `shared/${PID}`), { name: 'x' }));
			await assertFails(setDoc(doc(dbOf(env, uid), 'shared/p9'), { visibility: 'link' }));
			await assertFails(deleteDoc(doc(dbOf(env, uid), `shared/${PID}`)));
		}
	});

	it('list: オーナーは全件可', async () => {
		await assertSucceeds(getDocs(collection(dbOf(env, 'owner1'), 'shared')));
	});

	it('list: 非オーナーの無条件 list は拒否', async () => {
		await assertFails(getDocs(collection(dbOf(env, 'stranger'), 'shared')));
		await assertFails(getDocs(collection(dbOf(env, 'editor1'), 'shared')));
	});

	it('list: visibility==link 条件のクエリも非オーナーには拒否(pid の列挙を防ぐ)', async () => {
		await seed(env, { [`shared/${PID}`]: { visibility: 'link' } });
		const q = query(collection(dbOf(env, 'stranger'), 'shared'), where('visibility', '==', 'link'));
		await assertFails(getDocs(q));
	});

	it('list: visibility==private 条件のクエリは非オーナーには拒否', async () => {
		const q = query(
			collection(dbOf(env, 'stranger'), 'shared'),
			where('visibility', '==', 'private')
		);
		await assertFails(getDocs(q));
	});
});

describe('secrets', () => {
	it('read は誰も不可(オーナー含む)', async () => {
		for (const uid of ['owner1', 'editor1', 'viewer1', 'stranger']) {
			await assertFails(getDoc(doc(dbOf(env, uid), `shared/${PID}/secrets/editor`)));
			await assertFails(getDocs(collection(dbOf(env, uid), `shared/${PID}/secrets`)));
		}
	});

	it('write はオーナーのみ', async () => {
		await assertSucceeds(
			setDoc(doc(dbOf(env, 'owner1'), `shared/${PID}/secrets/editor`), { value: 'n' })
		);
		for (const uid of ['editor1', 'viewer1', 'stranger']) {
			await assertFails(
				setDoc(doc(dbOf(env, uid), `shared/${PID}/secrets/editor`), { value: 'n' })
			);
			await assertFails(deleteDoc(doc(dbOf(env, uid), `shared/${PID}/secrets/viewer`)));
		}
	});
});

describe('参加 (members)', () => {
	const join = (uid: string, data: Record<string, unknown>, pid = PID) =>
		setDoc(doc(dbOf(env, uid), `shared/${pid}/members/${uid}`), data);

	it('正しい viewer 秘密で viewer として参加できる', async () => {
		await assertSucceeds(join('n1', { role: 'viewer', secret: 'vs', joinedAt: 1, name: 'n' }));
		await assertSucceeds(getDoc(doc(dbOf(env, 'n1'), `shared/${PID}`)));
	});

	it('正しい editor 秘密で editor として参加できる', async () => {
		await assertSucceeds(join('n1', { role: 'editor', secret: 'es' }));
		await assertSucceeds(
			setDoc(doc(dbOf(env, 'n1'), `shared/${PID}/scenes/new`), { projectId: PID })
		);
	});

	it('viewer 秘密で editor を名乗れない', async () => {
		await assertFails(join('n1', { role: 'editor', secret: 'vs' }));
	});

	it('誤った秘密は拒否', async () => {
		await assertFails(join('n1', { role: 'viewer', secret: 'bad' }));
	});

	it('秘密文書が無い場合は拒否', async () => {
		await assertFails(join('n1', { role: 'viewer', secret: 'vs' }, OTHER_PID));
	});

	it('不正な role は拒否', async () => {
		await assertFails(join('n1', { role: 'owner', secret: 'vs' }));
	});

	it('他人の uid での作成は拒否', async () => {
		await assertFails(
			setDoc(doc(dbOf(env, 'n1'), `shared/${PID}/members/n2`), { role: 'viewer', secret: 'vs' })
		);
	});

	it('余計なフィールドは拒否', async () => {
		await assertFails(join('n1', { role: 'viewer', secret: 'vs', admin: true }));
	});

	it('自己昇格(update)は拒否、オーナーは可', async () => {
		await assertFails(
			updateDoc(doc(dbOf(env, 'viewer1'), `shared/${PID}/members/viewer1`), { role: 'editor' })
		);
		await assertSucceeds(
			updateDoc(doc(dbOf(env, 'owner1'), `shared/${PID}/members/viewer1`), { role: 'editor' })
		);
	});

	it('read は自分自身かオーナーのみ', async () => {
		await assertSucceeds(getDoc(doc(dbOf(env, 'viewer1'), `shared/${PID}/members/viewer1`)));
		await assertSucceeds(getDoc(doc(dbOf(env, 'owner1'), `shared/${PID}/members/viewer1`)));
		await assertFails(getDoc(doc(dbOf(env, 'editor1'), `shared/${PID}/members/viewer1`)));
		await assertFails(getDocs(collection(dbOf(env, 'editor1'), `shared/${PID}/members`)));
	});

	it('delete は自分自身かオーナー', async () => {
		await assertFails(deleteDoc(doc(dbOf(env, 'editor1'), `shared/${PID}/members/viewer1`)));
		await assertSucceeds(deleteDoc(doc(dbOf(env, 'viewer1'), `shared/${PID}/members/viewer1`)));
		await assertSucceeds(deleteDoc(doc(dbOf(env, 'owner1'), `shared/${PID}/members/editor1`)));
	});
});

describe('共有データ', () => {
	const p = (path: string) => `shared/${PID}/${path}`;

	it('editor は create/update/delete 可', async () => {
		const db = dbOf(env, 'editor1');
		await assertSucceeds(setDoc(doc(db, p('chapters/c1')), { projectId: PID }));
		await assertSucceeds(updateDoc(doc(db, p('scenes/s1')), { title: 'new' }));
		await assertSucceeds(deleteDoc(doc(db, p('scenes/s1'))));
		await assertSucceeds(getDoc(doc(db, p('projects/' + PID))));
	});

	it('viewer は read のみ', async () => {
		const db = dbOf(env, 'viewer1');
		await assertSucceeds(getDoc(doc(db, p('scenes/s1'))));
		await assertSucceeds(getDocs(collection(db, p('scenes'))));
		await assertFails(setDoc(doc(db, p('chapters/c1')), { projectId: PID }));
		await assertFails(updateDoc(doc(db, p('scenes/s1')), { title: 'x' }));
		await assertFails(deleteDoc(doc(db, p('scenes/s1'))));
	});

	it('オーナーも共有データを read/write できる', async () => {
		const db = dbOf(env, 'owner1');
		await assertSucceeds(getDoc(doc(db, p('scenes/s1'))));
		await assertSucceeds(setDoc(doc(db, p('scenes/s2')), { projectId: PID }));
		await assertSucceeds(deleteDoc(doc(db, p('scenes/s2'))));
	});

	it('private の非メンバーは全拒否', async () => {
		const db = dbOf(env, 'stranger');
		await assertFails(getDoc(doc(db, p('scenes/s1'))));
		await assertFails(getDocs(collection(db, p('scenes'))));
		await assertFails(setDoc(doc(db, p('scenes/s2')), { projectId: PID }));
		await assertFails(getDoc(doc(db, p('scenes/s1/updates/u1'))));
	});

	it('link 公開では非メンバーは read のみ', async () => {
		await seed(env, { [`shared/${PID}`]: { visibility: 'link' } });
		const db = dbOf(env, 'stranger');
		await assertSucceeds(getDoc(doc(db, p('scenes/s1'))));
		await assertSucceeds(getDocs(collection(db, p('scenes'))));
		await assertSucceeds(getDoc(doc(db, p('scenes/s1/updates/u1'))));
		await assertFails(setDoc(doc(db, p('scenes/s2')), { projectId: PID }));
		await assertFails(updateDoc(doc(db, p('scenes/s1')), { title: 'x' }));
		await assertFails(deleteDoc(doc(db, p('scenes/s1'))));
		await assertFails(setDoc(doc(db, p('scenes/s1/updates/u2')), { d: 1 }));
	});

	it('link 公開でも secrets / members / presence は非メンバーに見えない', async () => {
		await seed(env, {
			[`shared/${PID}`]: { visibility: 'link' },
			[`shared/${PID}/presence/viewer1`]: { t: 1 }
		});
		const db = dbOf(env, 'stranger');
		await assertFails(getDoc(doc(db, p('secrets/viewer'))));
		await assertFails(getDoc(doc(db, p('members/viewer1'))));
		await assertFails(getDoc(doc(db, p('presence/viewer1'))));
	});

	it('別プロジェクトのメンバーは不可', async () => {
		const db = dbOf(env, 'editor2');
		await assertFails(getDoc(doc(db, p('scenes/s1'))));
		await assertFails(setDoc(doc(db, p('scenes/s2')), { projectId: PID }));
		// 自分の PJ には書ける
		await assertSucceeds(
			setDoc(doc(db, `shared/${OTHER_PID}/scenes/s2`), { projectId: OTHER_PID })
		);
	});

	it('projectId 不一致・欠落の書き込みは拒否', async () => {
		const db = dbOf(env, 'editor1');
		await assertFails(setDoc(doc(db, p('scenes/s2')), { projectId: OTHER_PID }));
		await assertFails(setDoc(doc(db, p('scenes/s2')), { title: 'no pid' }));
		await assertFails(updateDoc(doc(db, p('scenes/s1')), { projectId: OTHER_PID }));
		await assertFails(setDoc(doc(dbOf(env, 'owner1'), p('scenes/s2')), { projectId: OTHER_PID }));
	});

	it('projects 型の文書は id == pid が必要', async () => {
		const db = dbOf(env, 'editor1');
		await assertFails(setDoc(doc(db, p('projects/other')), { projectId: PID }));
		await assertSucceeds(setDoc(doc(db, p('projects/' + PID)), { projectId: PID, title: 'x' }));
	});

	it('ネスト(updates, crdt): editor は read/write 可、viewer は read のみ', async () => {
		const ed = dbOf(env, 'editor1');
		const vw = dbOf(env, 'viewer1');
		for (const path of ['scenes/s1/updates/u1', 'scenes/s1/crdt/c1']) {
			await assertSucceeds(getDoc(doc(ed, p(path))));
			await assertSucceeds(setDoc(doc(ed, p(path)), { data: 'y' }));
			await assertSucceeds(getDoc(doc(vw, p(path))));
			await assertFails(setDoc(doc(vw, p(path)), { data: 'z' }));
			await assertFails(deleteDoc(doc(vw, p(path))));
		}
		await assertSucceeds(setDoc(doc(ed, p('scenes/s1/updates/editor1')), { data: 'new' }));
		await assertSucceeds(deleteDoc(doc(ed, p('scenes/s1/updates/editor1'))));
		// 深いネスト
		await assertSucceeds(setDoc(doc(ed, p('scenes/s1/crdt/c1/chunks/k1')), { d: 1 }));
		await assertFails(setDoc(doc(vw, p('scenes/s1/crdt/c1/chunks/k2')), { d: 1 }));
	});

	it('type 名以外のコレクションは拒否(オーナー・editor でも)', async () => {
		await assertFails(setDoc(doc(dbOf(env, 'editor1'), p('misc/x')), { projectId: PID }));
		await assertFails(setDoc(doc(dbOf(env, 'owner1'), p('misc/x')), { projectId: PID }));
		await assertFails(setDoc(doc(dbOf(env, 'owner1'), p('misc/x/sub/y')), { d: 1 }));
	});

	it('抜け道なし: editor は secrets の read/write、他メンバーの members read ができない', async () => {
		const db = dbOf(env, 'editor1');
		await assertFails(getDoc(doc(db, p('secrets/viewer'))));
		await assertFails(setDoc(doc(db, p('secrets/viewer')), { value: 'hack' }));
		await assertFails(getDoc(doc(db, p('members/viewer1'))));
		await assertFails(setDoc(doc(db, p('members/viewer1')), { role: 'editor', secret: 'es' }));
		await assertFails(setDoc(doc(db, p('members/viewer1/x/y')), { d: 1 }));
		await assertFails(setDoc(doc(db, p('secrets/viewer/x/y')), { d: 1 }));
	});
});

describe('presence', () => {
	const path = (uid: string) => `shared/${PID}/presence/${uid}`;

	it('メンバー(viewer/editor)は自分の presence を write できる', async () => {
		await assertSucceeds(setDoc(doc(dbOf(env, 'viewer1'), path('viewer1')), { t: 1 }));
		await assertSucceeds(setDoc(doc(dbOf(env, 'editor1'), path('editor1')), { t: 1 }));
	});

	it('オーナーも自分の uid なら write できる', async () => {
		await assertSucceeds(setDoc(doc(dbOf(env, 'owner1'), path('owner1')), { t: 1 }));
	});

	it('他人の uid への write は拒否', async () => {
		await assertFails(setDoc(doc(dbOf(env, 'editor1'), path('viewer1')), { t: 1 }));
		await assertFails(setDoc(doc(dbOf(env, 'owner1'), path('viewer1')), { t: 1 }));
	});

	it('非メンバーは write/read 不可(link 公開でも)', async () => {
		await seed(env, { [`shared/${PID}`]: { visibility: 'link' } });
		await assertFails(setDoc(doc(dbOf(env, 'stranger'), path('stranger')), { t: 1 }));
		await assertFails(getDoc(doc(dbOf(env, 'stranger'), path('viewer1'))));
	});

	it('別プロジェクトのメンバーは不可', async () => {
		await assertFails(setDoc(doc(dbOf(env, 'editor2'), path('editor2')), { t: 1 }));
	});

	it('delete は本人とオーナー。他のメンバー・非メンバーは拒否', async () => {
		await seed(env, { [path('editor1')]: { t: 1 }, [path('viewer1')]: { t: 1 } });
		await assertFails(deleteDoc(doc(dbOf(env, 'viewer1'), path('editor1'))));
		await assertFails(deleteDoc(doc(dbOf(env, 'stranger'), path('editor1'))));
		await assertSucceeds(deleteDoc(doc(dbOf(env, 'editor1'), path('editor1'))));
		// オーナーは他人の presence を削除できる(共有の停止・メンバー削除後の片付け)
		await assertSucceeds(deleteDoc(doc(dbOf(env, 'owner1'), path('viewer1'))));
	});

	it('メンバーでなくなった(members を削除された)uid は自分の presence も消せない', async () => {
		await seed(env, { [`shared/${PID}/presence/ghost`]: { t: 1 } });
		await assertFails(deleteDoc(doc(dbOf(env, 'ghost'), `shared/${PID}/presence/ghost`)));
		await assertSucceeds(deleteDoc(doc(dbOf(env, 'owner1'), `shared/${PID}/presence/ghost`)));
	});

	it('read はメンバーとオーナー', async () => {
		await seed(env, { [path('editor1')]: { t: 1 } });
		await assertSucceeds(getDoc(doc(dbOf(env, 'viewer1'), path('editor1'))));
		await assertSucceeds(getDocs(collection(dbOf(env, 'viewer1'), `shared/${PID}/presence`)));
		await assertSucceeds(getDoc(doc(dbOf(env, 'owner1'), path('editor1'))));
		await assertFails(getDoc(doc(dbOf(env, 'stranger'), path('editor1'))));
	});
});

describe('その他', () => {
	it('未知のトップレベルパスは拒否(オーナーでも)', async () => {
		await assertFails(setDoc(doc(dbOf(env, 'owner1'), 'foo/bar'), { a: 1 }));
		await assertFails(getDoc(doc(dbOf(env, 'owner1'), 'foo/bar')));
	});
});
