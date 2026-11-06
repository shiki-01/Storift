import {
	collection,
	deleteDoc,
	doc,
	getDocFromServer,
	getDocsFromServer,
	query,
	serverTimestamp,
	setDoc,
	type Firestore
} from 'firebase/firestore';
import { getOwnStatus } from './owner';
import { sharedProjectCopyPath } from './syncTarget';
import { errorCodeOf } from './joinPolicy';

/**
 * 参加・取得・退出の Firestore 操作(docs/SHARING_RULES.md 参照)。
 * Firestore インスタンスと uid を引数に取る関数だけで構成し、Emulator テストから直接呼べるようにしている。
 * ローカル(Dexie)の状態は触らない。それは services/join.service.ts の担当。
 */

export const JOIN_CHILD_TYPES = [
	'chapters',
	'scenes',
	'characters',
	'plots',
	'worldbuilding'
] as const;
export type JoinChildType = (typeof JOIN_CHILD_TYPES)[number];

type Data = Record<string, unknown>;

export interface JoinInput {
	pid: string;
	role: 'viewer' | 'editor';
	/** トークン、または入力されたパスワード */
	secret: string;
	/** メンバー一覧に表示される名前(任意) */
	name?: string;
}

export interface JoinResult {
	/** 参加後の役割。既にメンバーのときは、すでに持っている役割(招待の役割と違うことがある) */
	role: 'viewer' | 'editor';
	/** 既にメンバーだった(新しく作らなかった) */
	alreadyMember: boolean;
}

/**
 * 参加: `shared/{pid}/members/{uid}` を `{role, secret, joinedAt, name?}` で作る。
 * ルールが secrets/{role} の値と照合する(不一致・pid 不存在・共有停止は permission-denied)。
 * 既にメンバーのときは何も書かず、すでに持っている役割を返す(メンバーの更新はオーナーしかできないため。
 * 役割を変えたいときは、オーナーがメンバーを削除してから入り直す)。
 */
export async function joinSharedProject(
	db: Firestore,
	uid: string,
	input: JoinInput
): Promise<JoinResult> {
	const memberRef = doc(db, `shared/${input.pid}/members/${uid}`);

	const existing = await getDocFromServer(memberRef);
	if (existing.exists()) {
		const role = (existing.data() as { role?: unknown }).role === 'editor' ? 'editor' : 'viewer';
		return { role, alreadyMember: true };
	}

	const data: Data = {
		role: input.role,
		secret: input.secret,
		joinedAt: serverTimestamp()
	};
	if (input.name) data.name = input.name;
	await setDoc(memberRef, data);
	return { role: input.role, alreadyMember: false };
}

/** 参加の拒否が、旧ルールの Firebase によるものか。new-rules なら秘密の不一致・無効な招待など */
export async function diagnoseDenied(
	db: Firestore,
	uid: string
): Promise<'legacy-rules' | 'new-rules' | 'unknown'> {
	// 新ルールでは自分の owners/{uid} は誰でも読める(存在しなければ missing)。旧ルールでは読めない(denied)
	const own = await getOwnStatus(db, uid);
	if (own === 'exists' || own === 'missing') return 'new-rules';
	if (own === 'denied') return 'legacy-rules';
	return 'unknown';
}

export interface SharedSnapshot {
	/** 共有側のプロジェクト文書(ゲストが参照するコピー)。projectId / sharing / syncedAt は除いてある */
	project: Data | undefined;
	/** shared/{pid} のメタの name / visibility */
	metaName?: string;
	metaVisibility?: string;
	children: Record<JoinChildType, Data[]>;
}

export class ProjectMissingError extends Error {
	constructor() {
		super('共有されたプロジェクトのデータが見つかりません');
		this.name = 'ProjectMissingError';
	}
}

/** syncedAt(サーバー時刻)は数値(ミリ秒)にそろえる。ローカルの同期の取り込み(syncAllFromFirestore)と同じ */
function normalize(data: Data): Data {
	const out = { ...data };
	const syncedAt = out.syncedAt;
	if (syncedAt && typeof syncedAt === 'object' && 'toMillis' in syncedAt) {
		out.syncedAt = (syncedAt as { toMillis: () => number }).toMillis();
	}
	return out;
}

/**
 * 共有側のプロジェクトと全子要素を読む(サーバーから。キャッシュは使わない)。
 * メンバー(またはリンク公開)でないと permission-denied。
 */
export async function fetchSharedSnapshot(db: Firestore, pid: string): Promise<SharedSnapshot> {
	const meta = await getDocFromServer(doc(db, `shared/${pid}`));
	const metaName =
		meta.exists() && typeof (meta.data() as { name?: unknown }).name === 'string'
			? ((meta.data() as { name: string }).name as string)
			: undefined;

	const metaVisibility =
		meta.exists() && typeof (meta.data() as { visibility?: unknown }).visibility === 'string'
			? ((meta.data() as { visibility: string }).visibility as string)
			: undefined;

	const projectSnap = await getDocFromServer(doc(db, sharedProjectCopyPath(pid)));
	let project: Data | undefined;
	if (projectSnap.exists()) {
		project = normalize(projectSnap.data() as Data);
		// projectId は共有側のルールのために付いている値。sharing はホスト視点の内容なので採用しない
		delete project.projectId;
		delete project.sharing;
	}

	const children = {} as Record<JoinChildType, Data[]>;
	for (const type of JOIN_CHILD_TYPES) {
		const snap = await getDocsFromServer(query(collection(db, `shared/${pid}/${type}`)));
		children[type] = snap.docs.map((d) => normalize(d.data() as Data));
	}
	return { project, metaName, metaVisibility, children };
}

/**
 * 退出: 自分の在席情報(あれば)と `members/{自分のuid}` を削除する。
 * 既にメンバーでない(削除済み)場合も成功として扱う。呼び出し側で、通信できなかったときの扱いを決める。
 */
export async function leaveSharedProject(db: Firestore, uid: string, pid: string): Promise<void> {
	try {
		await deleteDoc(doc(db, `shared/${pid}/presence/${uid}`));
	} catch (error) {
		// 在席情報は退出の必須条件ではない(旧ルールなどで拒否されても続ける)
		if (errorCodeOf(error) !== 'permission-denied') throw error;
	}
	await deleteDoc(doc(db, `shared/${pid}/members/${uid}`));
}
