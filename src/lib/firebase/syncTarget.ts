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
 * ゲスト接続(connectionId あり)のプロジェクトは最上位にポインタを持たない。
 */
export function mirrorPidOf(project: { sharing?: ProjectSharing }): string | null {
	const sharing = project.sharing;
	return isSharedStatus(sharing) && !sharing.connectionId ? sharing.pid : null;
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
