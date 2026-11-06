import {
	collection,
	deleteDoc,
	deleteField,
	doc,
	getDocsFromServer,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	where,
	writeBatch,
	type Firestore,
	type Query
} from 'firebase/firestore';
import type { Project, ProjectSharing } from '$lib/types/project';
import { generateOwnerKey } from './owner';
import { chunkBatches } from './syncPlan';
import { sharedProjectCopyPath, withoutSecrets } from './syncTarget';

/**
 * 共有の開始・停止・管理の Firestore 操作(docs/SHARING_RULES.md 参照)。
 * Firestore インスタンスと uid を引数に取る関数だけで構成し、Emulator テストから直接呼べるようにしている。
 * 呼び出し側(sharing.service.ts)がローカルの状態(Dexie)を管理し、ここはリモートの手順だけを担う。
 *
 * 移行の手順は冪等で、途中で止まっても同じ入力で再実行すれば完了する。
 * データ消失を避けるため、コピー先に書いて「読み戻して確認」してから、コピー元を消す。
 */

export const CHILD_TYPES = ['chapters', 'scenes', 'characters', 'plots', 'worldbuilding'] as const;
export type ChildType = (typeof CHILD_TYPES)[number];

/** 将来、本文の更新ログなどを置くサブコレクション(共有の削除で消す対象) */
const NESTED_SUBCOLLECTIONS = ['updates', 'crdt'] as const;

/** 書き込み1件のサイズの見積もりが取れないときの値 */
const FALLBACK_SIZE = 1000;
/** WriteBatch の上限(500)に対する余裕。1件で複数書くもの(ミラーなど)に備える */
const BATCH_OPS = 400;

type Data = Record<string, unknown>;

// ---------- 秘密 ----------

export type SecretSpec = { type: 'token' | 'password'; value?: string };

/** 暗号論的乱数 32 バイトの base64url(パディング無し) */
export const generateSecretToken = (): string => generateOwnerKey();

/** 指定から秘密の値を決める。パスワードなし(未指定・token)はランダムトークン、パスワードありは入力文字列 */
export function resolveSecret(spec?: SecretSpec): string {
	if (spec?.type === 'password') {
		const value = spec.value ?? '';
		if (value.trim() === '') throw new Error('パスワードが空です');
		return value;
	}
	return generateSecretToken();
}

// ---------- 低レベルの補助 ----------

const updatedAtOf = (data: Data | undefined): number => {
	const v = data?.updatedAt;
	return typeof v === 'number' ? v : 0;
};

/** サーバーから読んだ文書を id → データにする(キャッシュは使わない: 確認の根拠にするため) */
async function readDocs(q: Query): Promise<Map<string, Data>> {
	const snap = await getDocsFromServer(q);
	const map = new Map<string, Data>();
	for (const d of snap.docs) map.set(d.id, d.data() as Data);
	return map;
}

/** syncedAt(サーバー時刻)は書き込み時に付け直すので、読み込んだ値は持ち越さない */
function withoutSyncedAt(data: Data): Data {
	const copy = { ...data };
	delete copy.syncedAt;
	return copy;
}

/** undefined のキーを取り除く(Firestore は undefined を受け付けない) */
function clean<T>(value: T): T {
	if (Array.isArray(value)) return value.map(clean) as T;
	if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		const out: Data = {};
		for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = clean(v);
		return out as T;
	}
	return value;
}

type WriteOp = { kind: 'set'; path: string; data: Data } | { kind: 'delete'; path: string };

/** 件数・サイズの上限に収まるよう分けて、WriteBatch で順にコミットする */
async function commitOps(db: Firestore, ops: WriteOp[]): Promise<void> {
	const sized = ops.map((op) => ({
		op,
		size: op.kind === 'set' ? safeSize(op.data) : 200
	}));
	for (const batch of chunkBatches(sized, BATCH_OPS)) {
		const wb = writeBatch(db);
		for (const { op } of batch) {
			if (op.kind === 'delete') wb.delete(doc(db, op.path));
			else wb.set(doc(db, op.path), op.data);
		}
		await wb.commit();
	}
}

function safeSize(data: Data): number {
	try {
		return JSON.stringify(data).length;
	} catch {
		return FALLBACK_SIZE;
	}
}

const topLevelChildren = (db: Firestore, type: ChildType, pid: string): Query =>
	query(collection(db, type), where('projectId', '==', pid));

const sharedChildren = (db: Firestore, type: ChildType, pid: string): Query =>
	query(collection(db, `shared/${pid}/${type}`));

/** コピー先に無い、またはコピー先が古いものだけを選ぶ */
function pickNewer(source: Map<string, Data>, dest: Map<string, Data>): [string, Data][] {
	return [...source].filter(([id, data]) => {
		const existing = dest.get(id);
		return !existing || updatedAtOf(existing) < updatedAtOf(data);
	});
}

/** source の全件が dest に(同じかより新しい版で)あるか。無いものの id を返す */
function findMissing(source: Map<string, Data>, dest: Map<string, Data>): string[] {
	return [...source]
		.filter(([id, data]) => {
			const existing = dest.get(id);
			return !existing || updatedAtOf(existing) < updatedAtOf(data);
		})
		.map(([id]) => id);
}

export class VerifyError extends Error {
	constructor(
		readonly type: string,
		readonly ids: string[]
	) {
		super(`コピーの確認に失敗しました(${type}: ${ids.length}件)`);
		this.name = 'VerifyError';
	}
}

/** 共有側のプロジェクト文書(ゲストが参照するコピー)。secrets を除き、ルールが要求する projectId を付ける */
function sharedProjectCopy(project: Project, pid: string): Data {
	return clean({ ...withoutSecrets(project), projectId: pid }) as Data;
}

function requireOwnerInput(pid: string, project: Project): ProjectSharing {
	const sharing = project.sharing;
	if (project.id !== pid || !sharing || sharing.pid !== pid) {
		throw new Error('プロジェクトと共有情報の pid が一致しません');
	}
	if (sharing.connectionId) throw new Error('ゲスト接続のプロジェクトは共有を開始できません');
	return sharing;
}

// ---------- 共有の開始 ----------

export interface StartSharingInput {
	pid: string;
	/** sharing(status: 'migrating', migration: 'start', secrets 両方)を含むローカルのプロジェクト */
	project: Project;
	/** コピー元のローカルの子要素。最上位にだけある文書(他端末が作ったもの)は、ここで読んで合わせる */
	children: Record<ChildType, Data[]>;
}

export interface StartSharingResult {
	/** 完了後のプロジェクト(status: 'active'、migration なし)。ローカルに保存する内容 */
	project: Project;
	copied: number;
	removedFromTopLevel: number;
}

/**
 * 共有の開始。
 *  ③ shared/{pid} のメタ → secrets
 *     最上位のポインタ文書を migrating で書く(他端末が「子要素が無い」と誤って削除しないため)
 *  ④ プロジェクトと全子要素を shared/{pid}/{type}/{id} へコピー(コピー先が新しければ上書きしない)
 *  ⑤ 読み戻して確認できたものだけ、最上位の子要素を削除
 *  ⑥ ポインタを active(secrets 付き)に、共有側のコピーも書く
 * 非オーナーは最初の書き込み(メタ)で permission-denied になる。
 */
export async function startSharing(
	db: Firestore,
	uid: string,
	input: StartSharingInput
): Promise<StartSharingResult> {
	const { pid, project } = input;
	const sharing = requireOwnerInput(pid, project);
	const { viewer, editor } = sharing.secrets ?? {};
	if (!viewer || !editor) throw new Error('閲覧用・編集用の秘密が必要です');

	// ③ メタと秘密
	await setDoc(
		doc(db, 'shared', pid),
		{
			visibility: sharing.visibility,
			name: project.title,
			ownerUid: uid,
			updatedAt: Date.now()
		},
		{ merge: true }
	);
	const secrets = writeBatch(db);
	secrets.set(doc(db, `shared/${pid}/secrets/viewer`), { value: viewer });
	secrets.set(doc(db, `shared/${pid}/secrets/editor`), { value: editor });
	await secrets.commit();

	await setDoc(
		doc(db, 'projects', pid),
		{ ...clean(project), syncedAt: serverTimestamp() },
		{ merge: true }
	);

	// ④ コピー
	const verifyList: { type: ChildType; top: Map<string, Data>; local: Map<string, Data> }[] = [];
	let copied = 0;
	for (const type of CHILD_TYPES) {
		const top = await readDocs(topLevelChildren(db, type, pid));
		const shared = await readDocs(sharedChildren(db, type, pid));

		// ローカルと最上位の新しい方を採用する
		const merged = new Map<string, Data>();
		const local = new Map<string, Data>();
		for (const entity of input.children[type]) {
			local.set(entity.id as string, entity);
			merged.set(entity.id as string, entity);
		}
		for (const [id, data] of top) {
			const mine = merged.get(id);
			if (!mine || updatedAtOf(data) > updatedAtOf(mine)) merged.set(id, data);
		}

		const writes = pickNewer(merged, shared).map(
			([id, data]): WriteOp => ({
				kind: 'set',
				path: `shared/${pid}/${type}/${id}`,
				data: { ...clean(withoutSyncedAt(data)), projectId: pid, syncedAt: serverTimestamp() }
			})
		);
		await commitOps(db, writes);
		copied += writes.length;
		verifyList.push({ type, top, local });
	}
	await setDoc(doc(db, sharedProjectCopyPath(pid)), {
		...sharedProjectCopy(project, pid),
		syncedAt: serverTimestamp()
	});

	// ⑤ 確認してから削除
	const deletes: WriteOp[] = [];
	for (const { type, top, local } of verifyList) {
		const after = await readDocs(sharedChildren(db, type, pid));
		const missing = [...findMissing(top, after), ...findMissing(local, after)];
		if (missing.length > 0) throw new VerifyError(type, missing);
		for (const id of top.keys()) deletes.push({ kind: 'delete', path: `${type}/${id}` });
	}
	await commitOps(db, deletes);

	// ⑥ ポインタを active に
	const active = activeProject(project);
	const finalBatch = writeBatch(db);
	finalBatch.set(
		doc(db, 'projects', pid),
		{
			...clean(active),
			sharing: { ...clean(active.sharing), migration: deleteField() },
			syncedAt: serverTimestamp()
		},
		{ merge: true }
	);
	finalBatch.set(doc(db, sharedProjectCopyPath(pid)), {
		...sharedProjectCopy(active, pid),
		syncedAt: serverTimestamp()
	});
	await finalBatch.commit();

	return { project: active, copied, removedFromTopLevel: deletes.length };
}

/** migrating → active にしたプロジェクト(migration を除く) */
export function activeProject(project: Project): Project {
	const sharing = { ...project.sharing!, status: 'active' as const };
	delete sharing.migration;
	return { ...project, sharing };
}

// ---------- 共有の停止 ----------

export interface StopSharingInput {
	pid: string;
	/** sharing 付き(status: 'migrating', migration: 'stop')のローカルのプロジェクト */
	project: Project;
}

export interface StopSharingResult {
	/** 共有を外したプロジェクト(ローカルに保存する内容) */
	project: Project;
	copiedBack: number;
}

/** sharing を外したプロジェクト */
export function unsharedProject(project: Project): Project {
	const copy = { ...project };
	delete copy.sharing;
	return copy;
}

/**
 * 共有の停止。
 *  ② shared 側の子要素を最上位へ書き戻す(最上位が新しければ上書きしない)
 *     読み戻して確認
 *  ③ shared/{pid} 配下をすべて削除
 *  ④ 最上位のポインタ文書から sharing を除く
 * 呼び出し前に、保留中の変更の送信と shared 側の取り込みを済ませておくこと(ゲストの編集を失わないため)。
 */
export async function stopSharing(
	db: Firestore,
	uid: string,
	input: StopSharingInput
): Promise<StopSharingResult> {
	void uid;
	const { pid, project } = input;
	requireOwnerInput(pid, project);

	let copiedBack = 0;
	for (const type of CHILD_TYPES) {
		const shared = await readDocs(sharedChildren(db, type, pid));
		const top = await readDocs(topLevelChildren(db, type, pid));
		const writes = pickNewer(shared, top).map(
			([id, data]): WriteOp => ({
				kind: 'set',
				path: `${type}/${id}`,
				data: { ...clean(withoutSyncedAt(data)), syncedAt: serverTimestamp() }
			})
		);
		await commitOps(db, writes);
		copiedBack += writes.length;

		const after = await readDocs(topLevelChildren(db, type, pid));
		const missing = findMissing(shared, after);
		if (missing.length > 0) throw new VerifyError(type, missing);
	}

	await deleteSharedData(db, pid);

	const bare = unsharedProject(project);
	await setDoc(
		doc(db, 'projects', pid),
		{ ...clean(bare), sharing: deleteField(), syncedAt: serverTimestamp() },
		{ merge: true }
	);
	return { project: bare, copiedBack };
}

// ---------- 共有側の全削除 ----------

/**
 * shared/{pid} 配下(データ、ネストの updates/crdt、presence、members、secrets、メタ)をすべて削除する。
 * 最上位のデータには触れない。メタは最後に消すので、途中で止まっても再実行できる。
 */
export async function deleteSharedData(db: Firestore, pid: string): Promise<void> {
	const base = `shared/${pid}`;
	const ops: WriteOp[] = [];

	for (const type of ['projects', ...CHILD_TYPES] as const) {
		const docs = await readDocs(query(collection(db, `${base}/${type}`)));
		for (const id of docs.keys()) {
			if (type === 'scenes') {
				for (const sub of NESTED_SUBCOLLECTIONS) {
					const nested = await readDocs(query(collection(db, `${base}/${type}/${id}/${sub}`)));
					for (const nid of nested.keys()) {
						ops.push({ kind: 'delete', path: `${base}/${type}/${id}/${sub}/${nid}` });
					}
				}
			}
			ops.push({ kind: 'delete', path: `${base}/${type}/${id}` });
		}
	}
	await commitOps(db, ops);

	const rest: WriteOp[] = [];
	// presence は本人しか削除できないルールなので、オーナーが消せるのは自分の分だけ。
	// 他人の分は消せない(権限エラーは無視する。中身は在席情報だけで、メンバーでなくなれば読めない)
	const presence = await readDocs(query(collection(db, `${base}/presence`)));
	for (const id of presence.keys()) {
		try {
			await deleteDoc(doc(db, `${base}/presence/${id}`));
		} catch (error) {
			if ((error as { code?: string }).code !== 'permission-denied') throw error;
		}
	}
	for (const sub of ['members']) {
		const docs = await readDocs(query(collection(db, `${base}/${sub}`)));
		for (const id of docs.keys()) rest.push({ kind: 'delete', path: `${base}/${sub}/${id}` });
	}
	// secrets はルールで一覧(list)もできないので、役割名を指定して削除する(存在しなくても無害)
	for (const role of ['viewer', 'editor'])
		rest.push({ kind: 'delete', path: `${base}/secrets/${role}` });
	rest.push({ kind: 'delete', path: base });
	await commitOps(db, rest);
}

// ---------- 管理(公開範囲・秘密・メンバー) ----------

/** ポインタ文書(secrets 付き)と共有側のコピー(secrets なし)の sharing を更新する */
export async function writeSharingInfo(
	db: Firestore,
	pid: string,
	sharing: ProjectSharing
): Promise<void> {
	const batch = writeBatch(db);
	batch.set(
		doc(db, 'projects', pid),
		{ sharing: clean(sharing), syncedAt: serverTimestamp() },
		{ merge: true }
	);
	const publicSharing = { ...sharing };
	delete publicSharing.secrets;
	batch.set(
		doc(db, sharedProjectCopyPath(pid)),
		{ projectId: pid, sharing: clean(publicSharing), syncedAt: serverTimestamp() },
		{ merge: true }
	);
	await batch.commit();
}

/** 最上位のポインタ文書から sharing を除く(文書が無ければ何もしない) */
export async function removePointerSharing(db: Firestore, pid: string): Promise<void> {
	try {
		await updateDoc(doc(db, 'projects', pid), { sharing: deleteField() });
	} catch (error) {
		if ((error as { code?: string }).code === 'not-found') return;
		throw error;
	}
}

export async function setVisibility(
	db: Firestore,
	pid: string,
	visibility: 'private' | 'link'
): Promise<void> {
	await setDoc(doc(db, 'shared', pid), { visibility, updatedAt: Date.now() }, { merge: true });
}

/** 秘密の文書を書き換える(クライアントからは読み取れない) */
export async function writeSecret(
	db: Firestore,
	pid: string,
	role: 'viewer' | 'editor',
	value: string
): Promise<void> {
	await setDoc(doc(db, `shared/${pid}/secrets/${role}`), { value });
}

export interface SharedMember {
	uid: string;
	role: 'viewer' | 'editor';
	joinedAt?: number;
	name?: string;
}

function toMillis(value: unknown): number | undefined {
	if (typeof value === 'number') return value;
	if (value && typeof value === 'object' && 'toMillis' in value) {
		return (value as { toMillis: () => number }).toMillis();
	}
	return undefined;
}

export async function listMembers(db: Firestore, pid: string): Promise<SharedMember[]> {
	const docs = await readDocs(query(collection(db, `shared/${pid}/members`)));
	return [...docs]
		.map(([uid, data]): SharedMember => {
			const joinedAt = toMillis(data.joinedAt);
			return {
				uid,
				role: data.role === 'editor' ? 'editor' : 'viewer',
				...(joinedAt !== undefined ? { joinedAt } : {}),
				...(typeof data.name === 'string' ? { name: data.name } : {})
			};
		})
		.sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
}

/** メンバーを失効させる(同じ秘密で再参加できるので、必要なら秘密も再生成すること) */
export async function removeMember(db: Firestore, pid: string, uid: string): Promise<void> {
	const batch = writeBatch(db);
	batch.delete(doc(db, `shared/${pid}/members/${uid}`));
	await batch.commit();
}
