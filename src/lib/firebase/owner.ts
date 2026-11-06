import {
	collection,
	doc,
	getDocFromServer,
	getDocsFromServer,
	limit,
	query,
	serverTimestamp,
	writeBatch,
	type Firestore
} from 'firebase/firestore';
import type { AccessMode } from '$lib/types';

/**
 * オーナー鍵とオーナー登録(docs/SHARING_RULES.md 参照)。
 * Firestore インスタンスと uid を引数に取る関数だけで構成し、Emulator テストから直接呼べるようにしている。
 */

/** 暗号論的乱数 32 バイトの base64url(パディング無し) */
export function generateOwnerKey(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function errorCode(error: unknown): string {
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? (error as { code?: unknown }).code
			: undefined;
	if (typeof code !== 'string') return '';
	const slash = code.lastIndexOf('/');
	return (slash >= 0 ? code.slice(slash + 1) : code).toLowerCase();
}

const isPermissionDenied = (error: unknown) => errorCode(error) === 'permission-denied';

// ---------- 純粋関数(プローブ結果 → モード) ----------

/** owners/{uid} の読み取り結果 */
export type OwnProbe = 'exists' | 'missing' | 'denied' | 'error';
/** オーナー登録(bootstrap / join)の結果 */
export type RegisterProbe = 'ok' | 'denied' | 'error';
/** 従来コレクションの読み取り結果 */
export type LegacyProbe = 'allowed' | 'denied' | 'error';

export type AccessStep =
	| { done: true; mode: AccessMode }
	/** 新ルール適用済みでオーナー未登録。登録を試す */
	| { done: false; next: 'register' }
	/** owners が読めない = 旧ルールかもしれない。従来コレクションの読み取りを試す */
	| { done: false; next: 'probe-legacy' };

export function decideAfterOwnProbe(probe: OwnProbe): AccessStep {
	switch (probe) {
		case 'exists':
			return { done: true, mode: 'owner' };
		case 'missing':
			return { done: false, next: 'register' };
		case 'denied':
			return { done: false, next: 'probe-legacy' };
		default:
			return { done: true, mode: 'unknown' };
	}
}

export function decideAfterRegister(probe: RegisterProbe): AccessMode {
	if (probe === 'ok') return 'owner';
	// 鍵が既に存在し、自分は未登録(または鍵が違う)
	if (probe === 'denied') return 'needs-owner';
	return 'unknown';
}

export function decideAfterLegacyProbe(probe: LegacyProbe): AccessMode {
	if (probe === 'allowed') return 'legacy';
	if (probe === 'denied') return 'needs-owner';
	return 'unknown';
}

// ---------- Firestore 操作 ----------

async function probeOwn(db: Firestore, uid: string): Promise<{ probe: OwnProbe; key?: string }> {
	try {
		const snap = await getDocFromServer(doc(db, 'owners', uid));
		if (!snap.exists()) return { probe: 'missing' };
		const key = (snap.data() as { key?: unknown }).key;
		return { probe: 'exists', key: typeof key === 'string' && key ? key : undefined };
	} catch (error) {
		return { probe: isPermissionDenied(error) ? 'denied' : 'error' };
	}
}

/** 自分の owners/{uid} の状態。サーバーに問い合わせる(キャッシュは使わない) */
export async function getOwnStatus(db: Firestore, uid: string): Promise<OwnProbe> {
	return (await probeOwn(db, uid)).probe;
}

export type RegisterResult =
	| { ok: true; key: string }
	| { ok: false; reason: 'denied' | 'error'; error: unknown };

/** 初回端末: _config/ownerKey と owners/{uid} を 1 batch で作る(先着) */
export async function bootstrapOwner(db: Firestore, uid: string): Promise<RegisterResult> {
	const key = generateOwnerKey();
	try {
		const batch = writeBatch(db);
		batch.set(doc(db, '_config', 'ownerKey'), { key });
		batch.set(doc(db, 'owners', uid), { key, createdAt: serverTimestamp() });
		await batch.commit();
		return { ok: true, key };
	} catch (error) {
		return { ok: false, reason: isPermissionDenied(error) ? 'denied' : 'error', error };
	}
}

/** 2 台目以降: 既存のオーナー鍵で owners/{uid} を作る */
export async function joinAsOwner(
	db: Firestore,
	uid: string,
	key: string
): Promise<RegisterResult> {
	try {
		const batch = writeBatch(db);
		batch.set(doc(db, 'owners', uid), { key, createdAt: serverTimestamp() });
		await batch.commit();
		return { ok: true, key };
	} catch (error) {
		return { ok: false, reason: isPermissionDenied(error) ? 'denied' : 'error', error };
	}
}

/** 従来コレクションを 1 件だけ読んでみる(旧ルールか、新ルールの未登録かの判別に使う) */
export async function probeLegacyAccess(db: Firestore): Promise<LegacyProbe> {
	try {
		await getDocsFromServer(query(collection(db, 'projects'), limit(1)));
		return 'allowed';
	} catch (error) {
		return isPermissionDenied(error) ? 'denied' : 'error';
	}
}

const registerProbe = (result: RegisterResult): RegisterProbe => (result.ok ? 'ok' : result.reason);

export interface DetectResult {
	mode: AccessMode;
	/** 'owner' のとき、この端末が使うオーナー鍵(初回登録なら新しく生成した鍵)。保存して設定コードに使う */
	ownerKey?: string;
	/** 判定の根拠(診断表示用) */
	own: OwnProbe;
	legacy?: LegacyProbe;
	register?: RegisterProbe;
}

/**
 * アクセスモードの判定。ユーザー入力は不要。
 * localOwnerKey がある(設定コード由来)なら join、無ければ bootstrap を試す。
 */
export async function detectAccessMode(
	db: Firestore,
	uid: string,
	localOwnerKey?: string
): Promise<DetectResult> {
	const { probe: own, key: remoteKey } = await probeOwn(db, uid);
	const step = decideAfterOwnProbe(own);
	if (step.done) {
		// 登録済みなら、owners/{uid} に入っている鍵をそのまま使える(ローカルに無い場合の復元)
		return {
			mode: step.mode,
			own,
			ownerKey: step.mode === 'owner' ? (localOwnerKey ?? remoteKey) : undefined
		};
	}

	if (step.next === 'register') {
		const result = localOwnerKey
			? await joinAsOwner(db, uid, localOwnerKey)
			: await bootstrapOwner(db, uid);
		const register = registerProbe(result);
		return {
			mode: decideAfterRegister(register),
			ownerKey: result.ok ? result.key : undefined,
			own,
			register
		};
	}

	const legacy = await probeLegacyAccess(db);
	return { mode: decideAfterLegacyProbe(legacy), own, legacy };
}

// ---------- 診断(読み取りのみ。登録などの書き込みはしない) ----------

export type CheckStatus = 'ok' | 'ng' | 'unknown';

export interface DiagnosticItem {
	id: 'reachability' | 'auth' | 'rules' | 'owner';
	label: string;
	status: CheckStatus;
	detail: string;
}

/** プローブ結果から診断項目を組み立てる(純粋関数) */
export function buildDiagnostics(input: {
	hasUser: boolean;
	own: OwnProbe;
	legacy?: LegacyProbe;
}): DiagnosticItem[] {
	const { hasUser, own, legacy } = input;

	const reachability: DiagnosticItem =
		own === 'error'
			? {
					id: 'reachability',
					label: 'Firestore への到達',
					status: 'ng',
					detail: '接続できませんでした(オフライン、または設定の誤りの可能性があります)'
				}
			: {
					id: 'reachability',
					label: 'Firestore への到達',
					status: 'ok',
					detail: 'サーバーから応答がありました'
				};

	const auth: DiagnosticItem = hasUser
		? { id: 'auth', label: '匿名認証', status: 'ok', detail: 'サインイン済みです' }
		: {
				id: 'auth',
				label: '匿名認証',
				status: 'ng',
				detail: 'サインインしていません(Firebase の匿名認証が有効か確認してください)'
			};

	let rules: DiagnosticItem;
	let owner: DiagnosticItem;
	if (own === 'exists' || own === 'missing') {
		rules = { id: 'rules', label: 'ルールの版', status: 'ok', detail: '新ルール(オーナー鍵あり)' };
		owner =
			own === 'exists'
				? { id: 'owner', label: 'オーナー登録', status: 'ok', detail: 'この端末は登録済みです' }
				: {
						id: 'owner',
						label: 'オーナー登録',
						status: 'ng',
						detail: 'この端末は未登録です(オーナー端末の設定コードが必要です)'
					};
	} else if (own === 'denied') {
		if (legacy === 'allowed') {
			rules = { id: 'rules', label: 'ルールの版', status: 'ok', detail: '旧ルール(共有機能なし)' };
		} else {
			rules = {
				id: 'rules',
				label: 'ルールの版',
				status: 'unknown',
				detail: '判定できませんでした(認証の状態を確認してください)'
			};
		}
		owner = {
			id: 'owner',
			label: 'オーナー登録',
			status: 'unknown',
			detail: legacy === 'allowed' ? '旧ルールでは不要です' : '判定できませんでした'
		};
	} else {
		rules = { id: 'rules', label: 'ルールの版', status: 'unknown', detail: '判定できませんでした' };
		owner = {
			id: 'owner',
			label: 'オーナー登録',
			status: 'unknown',
			detail: '判定できませんでした'
		};
	}

	return [reachability, auth, rules, owner];
}

/** 診断を実行する(読み取りのみ) */
export async function runDiagnosticProbes(
	db: Firestore,
	uid: string | null
): Promise<DiagnosticItem[]> {
	if (!uid) return buildDiagnostics({ hasUser: false, own: 'error' });
	const own = await getOwnStatus(db, uid);
	const legacy = own === 'denied' ? await probeLegacyAccess(db) : undefined;
	return buildDiagnostics({ hasUser: true, own, legacy });
}
