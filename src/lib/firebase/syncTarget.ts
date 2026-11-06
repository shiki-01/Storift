import type { Firestore } from 'firebase/firestore';
import type { ProjectSharing } from '$lib/types/project';
import type { EntityType } from './sync';

/**
 * 同期対象(SyncTarget)。エンティティをどの Firestore のどのパスに置くかを表す。
 * - primary: 従来の最上位コレクション(`{type}/{id}`)
 * - shared: 共有プロジェクト(`shared/{pid}/{type}/{id}`)。connectionId があればゲスト接続先の Firestore
 * キー(key)は pending キュー・base・最終同期時刻に保存するため、安定した文字列にする。
 * このファイルは Firestore に触れない純粋なロジックだけを持つ(テスト対象)。
 */

export const PRIMARY_KEY = 'primary';

export interface TargetRef {
	key: string;
	kind: 'primary' | 'shared';
	/** shared のとき */
	pid?: string;
	/** shared で主 Firebase 以外のとき */
	connectionId?: string;
}

export interface SyncTarget extends TargetRef {
	db: Firestore;
	/** コレクションのパス(例: `scenes` / `shared/p1/scenes`) */
	collectionPath(type: EntityType): string;
	/** 文書のパス(例: `scenes/s1` / `shared/p1/scenes/s1`) */
	docPath(type: EntityType, id: string): string;
}

export const primaryRef: TargetRef = { key: PRIMARY_KEY, kind: 'primary' };

/** 共有ターゲットのキー。主 Firebase は `shared/{pid}`、ゲスト接続は `{connectionId}:shared/{pid}` */
export function sharedTargetKey(pid: string, connectionId?: string): string {
	return connectionId ? `${connectionId}:shared/${pid}` : `shared/${pid}`;
}

export function sharedRef(pid: string, connectionId?: string): TargetRef {
	return {
		key: sharedTargetKey(pid, connectionId),
		kind: 'shared',
		pid,
		...(connectionId ? { connectionId } : {})
	};
}

/** キーからターゲットを復元する。解釈できないキーは null */
export function parseTargetKey(key: string): TargetRef | null {
	if (key === PRIMARY_KEY) return primaryRef;
	const match = /^(?:([^:/]+):)?shared\/([^:/]+)$/.exec(key);
	if (!match) return null;
	return sharedRef(match[2], match[1]);
}

export function collectionPathOf(ref: TargetRef, type: EntityType): string {
	return ref.kind === 'shared' ? `shared/${ref.pid}/${type}` : type;
}

export function docPathOf(ref: TargetRef, type: EntityType, id: string): string {
	return `${collectionPathOf(ref, type)}/${id}`;
}

export function createTarget(ref: TargetRef, db: Firestore): SyncTarget {
	return {
		...ref,
		db,
		collectionPath: (type) => collectionPathOf(ref, type),
		docPath: (type, id) => docPathOf(ref, type, id)
	};
}

/** 共有側のプロジェクト文書(ゲストが参照するコピー)のパス */
export const sharedProjectCopyPath = (pid: string) => `shared/${pid}/projects/${pid}`;

/** 共有として扱う状態か(active / migrating)。error は扱わない(データの場所が確定していないため) */
export function isSharedStatus(sharing: ProjectSharing | undefined): sharing is ProjectSharing {
	return !!sharing && (sharing.status === 'active' || sharing.status === 'migrating');
}

/** プロジェクトの子要素が置かれるターゲットのキー */
export function targetKeyForProject(project: { sharing?: ProjectSharing } | undefined): string {
	const sharing = project?.sharing;
	return isSharedStatus(sharing) ? sharedTargetKey(sharing.pid, sharing.connectionId) : PRIMARY_KEY;
}

/**
 * エンティティの行き先のキー。projects 型(ポインタ文書)は常に primary。
 * 子要素は所属プロジェクトの共有状態で決まる。
 */
export function targetKeyForEntity(
	type: EntityType,
	project: { sharing?: ProjectSharing } | undefined
): string {
	return type === 'projects' ? PRIMARY_KEY : targetKeyForProject(project);
}

/**
 * 共有側にもコピーを書く(ミラー)対象か。主 Firebase の共有中プロジェクトの文書だけ。
 * ゲスト(role が owner 以外)のプロジェクトは最上位にポインタを持たない。
 */
export function mirrorPidOf(project: { sharing?: ProjectSharing }): string | null {
	const sharing = project.sharing;
	return isSharedStatus(sharing) && !sharing.connectionId && sharing.role === 'owner'
		? sharing.pid
		: null;
}

/** 共有側のコピー用に sharing.secrets を取り除いたプロジェクト(元は変更しない) */
export function withoutSecrets<T extends { sharing?: ProjectSharing }>(project: T): T {
	if (!project.sharing || !('secrets' in project.sharing)) return project;
	const sharing = { ...project.sharing };
	delete sharing.secrets;
	return { ...project, sharing };
}

/**
 * 保存済みの pending の target を解決する。旧形式(target なし)は primary。
 * shared のターゲットで、そのプロジェクトがローカルで共有されなくなっている場合は primary に付け替える
 * (共有停止後に、共有側へ書き込んで残骸を作らないため)。プロジェクトがローカルに無い場合はそのまま。
 */
export function effectiveTargetKey(
	stored: string | undefined,
	lookupProject: (pid: string) => { sharing?: ProjectSharing } | undefined
): string {
	const key = stored ?? PRIMARY_KEY;
	const ref = parseTargetKey(key);
	if (!ref || ref.kind !== 'shared' || ref.connectionId || !ref.pid) return key;
	const project = lookupProject(ref.pid);
	if (!project) return key;
	return targetKeyForProject(project);
}

/** ローカルに共有中のプロジェクトがあるか、起動時に再開すべき移行か */
export function needsResume(project: { sharing?: ProjectSharing }): boolean {
	const sharing = project.sharing;
	return (
		!!sharing &&
		!sharing.connectionId &&
		sharing.role === 'owner' &&
		sharing.status === 'migrating' &&
		(sharing.migration === 'start' || sharing.migration === 'stop')
	);
}

/** 共有のデータ置き場(pid)にしてよい ID か。推測できない UUID(v4)だけを許す */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUnguessableProjectId = (id: string): boolean => UUID_V4.test(id);

/**
 * primary から取得した子要素のうち、共有中プロジェクトのものを除く。
 * 共有中のプロジェクトの子要素は shared 側にだけあるべきで、primary に残っている古い文書
 * (共有を知らない端末が書いたものなど)を取り込んだり、突き合わせの対象にしたりしない。
 * projects 型は対象外(ポインタ文書は primary にある)。
 */
export function withoutSharedChildren<T extends { id: string }>(
	remotes: readonly T[],
	excludePids: ReadonlySet<string>
): T[] {
	if (excludePids.size === 0) return [...remotes];
	return remotes.filter((r) => {
		const projectId = (r as { projectId?: unknown }).projectId;
		return typeof projectId !== 'string' || !excludePids.has(projectId);
	});
}

// ---------- ゲスト(招待で参加した共有プロジェクト) ----------

/** ゲスト(owner 以外)として参加している共有か。接続先が主 Firebase でもゲスト接続でも true */
export function isGuestSharing(sharing: ProjectSharing | undefined): sharing is ProjectSharing {
	return !!sharing && sharing.role !== 'owner';
}

/** ゲストで、アクセス権が無効になったことを検知済みか */
export function isRevokedSharing(sharing: ProjectSharing | undefined): boolean {
	return isGuestSharing(sharing) && sharing.revokedAt !== undefined;
}

/**
 * 読み取り専用か(閲覧権限、またはアクセス権が無効)。
 * 同期層の安全網でもあり、これが true のプロジェクトは何も送信せず、取得ではリモートが常に勝つ。
 */
export function isReadOnlySharing(sharing: ProjectSharing | undefined): boolean {
	return isGuestSharing(sharing) && (sharing.role === 'viewer' || sharing.revokedAt !== undefined);
}

/**
 * 主 Firebase(自分のクラウド)の同期対象から外すプロジェクトか。
 * ゲストとして参加したもの(他人のデータ)と、退出後にローカルだけに残したもの。
 * 該当するプロジェクトの文書(ポインタ)と子要素は、主 Firebase へ送らず、主 Firebase からも取り込まない。
 */
export function isExcludedFromPrimary(
	project: { sharing?: ProjectSharing; localOnly?: boolean } | undefined
): boolean {
	return !!project && (!!project.localOnly || isGuestSharing(project.sharing));
}

/** 主 Firebase の取得で、子要素を扱わないプロジェクトの ID(共有中、またはローカル専用) */
export function primaryExcludedIds(
	projects: readonly { id: string; sharing?: ProjectSharing; localOnly?: boolean }[]
): Set<string> {
	return new Set(
		projects.filter((p) => isSharedStatus(p.sharing) || isExcludedFromPrimary(p)).map((p) => p.id)
	);
}

/** ターゲットのキーが指すプロジェクトの ID(shared のときのみ) */
export function pidOfTargetKey(key: string): string | undefined {
	return parseTargetKey(key)?.pid;
}

// ---------- ゲスト接続の識別 ----------

type HostConfig = { apiKey: string; projectId: string };

/** 文字列の非暗号学的ハッシュ(cyrb53)を 14 桁の 16 進にしたもの。識別子用で、秘密の保護には使わない */
export function shortHash(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
	return n.toString(16).padStart(14, '0');
}

/** 同じ Firebase か(projectId と apiKey が一致) */
export function isSameFirebase(a: HostConfig, b: HostConfig): boolean {
	return a.projectId === b.projectId && a.apiKey === b.apiKey;
}

/** ホストの Firebase ごとの名前付きアプリ名。同じホストの接続(プロジェクト違い)は 1 つのアプリを共有する */
export function connectionAppName(config: HostConfig): string {
	return `storift-conn-${shortHash(`${config.projectId}|${config.apiKey}`)}`;
}

/** ゲスト接続の ID。(ホストの Firebase, pid) から決まり、再参加で同じ値になる。キーに使えるよう `:` `/` を含まない */
export function connectionIdOf(config: HostConfig, pid: string): string {
	return `c${shortHash(`${config.projectId}|${config.apiKey}|${pid}`)}`;
}

// ---------- バックアップ・エクスポート ----------

/**
 * バックアップ/エクスポートに載せるプロジェクト。
 * sharing は含めない(secrets=招待に使う秘密の漏えい防止。pid・接続の状態は別の端末・別の保存先に持ち込めない)。
 * ゲストとして参加したプロジェクトは、復元しても自分のクラウドへ複製されないよう localOnly にする。
 */
export function projectForBackup<T extends { sharing?: ProjectSharing; localOnly?: boolean }>(
	project: T
): Omit<T, 'sharing'> {
	const { sharing, ...rest } = project;
	return isGuestSharing(sharing) ? { ...rest, localOnly: true } : rest;
}

/**
 * 復元で書き込むプロジェクト。バックアップ側の sharing は採用しない(古いバックアップに secrets が入っていても使わない)。
 * 同じ ID のプロジェクトが端末に既にあるときは、その共有の状態・ローカル専用の指定を保つ
 * (復元で共有が外れたり、ローカル専用のものがクラウドへ送られたりしないため)。
 */
export function projectForRestore<T extends { sharing?: ProjectSharing; localOnly?: boolean }>(
	incoming: T,
	existing: { sharing?: ProjectSharing; localOnly?: boolean } | undefined
): Omit<T, 'sharing'> & { sharing?: ProjectSharing } {
	const next: Omit<T, 'sharing'> & { sharing?: ProjectSharing } = projectForBackup(incoming);
	if (existing?.sharing) next.sharing = existing.sharing;
	if (existing?.localOnly) next.localOnly = true;
	return next;
}
