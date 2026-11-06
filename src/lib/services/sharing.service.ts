import { db } from '$lib/db';
import { getFirestoreInstance, isFirebaseInitialized } from '$lib/firebase/config';
import {
	CHILD_TYPES,
	deleteSharedData,
	listMembers as listMembersRemote,
	removeMember as removeMemberRemote,
	removePointerSharing,
	resolveSecret,
	setVisibility as setVisibilityRemote,
	startSharing as startSharingRemote,
	stopSharing as stopSharingRemote,
	writeSecret,
	writeSharingInfo,
	type ChildType,
	type SecretSpec,
	type SharedMember
} from '$lib/firebase/sharing';
import {
	getBase,
	removeBase,
	loadSyncState,
	saveSyncState,
	withoutTargetState
} from '$lib/firebase/syncMeta';
import { isUnguessableProjectId, needsResume, sharedTargetKey } from '$lib/firebase/syncTarget';
import { authStore } from '$lib/stores/auth.svelte';
import {
	downloadAllFromFirestore,
	flushPendingChanges,
	getPendingSnapshot,
	pullSharedProject,
	queueChanges,
	refreshProjectStores,
	restartProjectRealtime,
	setSharingBusy,
	stopProjectRealtime
} from '$lib/services/sync.service';
import type { Project, ProjectSharing } from '$lib/types';

/**
 * 共有の開始・停止・管理(オーナー端末のみ)。
 * リモートの手順は firebase/sharing.ts にあり、ここはローカル(Dexie)の状態・同期との協調・排他を担う。
 *
 * ローカルの sharing.status を 'migrating' にして保存してから移行を始めるので、途中で止まっても
 * 次回の起動(resumeSharingMigrations)か、ダイアログからの再実行で完了する。
 * migrating の間、子要素の行き先は shared 側になる(編集は shared へ送られる)。
 */

export const SHARING_NEEDS_OWNER_MESSAGE = '共有には新しいルール(オーナー登録)が必要です';

export interface StartSharingOptions {
	visibility: 'private' | 'link';
	/** 省略・token はランダムトークン、password は入力文字列 */
	viewerSecret?: SecretSpec;
	editorSecret?: SecretSpec;
}

export type ShareAvailability = { ok: true } | { ok: false; message: string };

/** この端末で共有の開始・管理ができるか */
export function getShareAvailability(): ShareAvailability {
	if (!isFirebaseInitialized()) {
		return { ok: false, message: 'Firebase が設定されていないため、共有は使えません' };
	}
	if (authStore.accessMode !== 'owner') return { ok: false, message: SHARING_NEEDS_OWNER_MESSAGE };
	if (!authStore.user) return { ok: false, message: 'サインインしていません' };
	return { ok: true };
}

function requireOwner(): string {
	const availability = getShareAvailability();
	if (!availability.ok) throw new Error(availability.message);
	return authStore.user!.uid;
}

// プロセス内で移行を実行中のプロジェクト(二重実行を防ぐ)
const running = new Set<string>();

async function exclusive<T>(pid: string, fn: () => Promise<T>): Promise<T> {
	if (running.has(pid)) throw new Error('このプロジェクトの共有の処理を実行中です');
	running.add(pid);
	setSharingBusy(pid, true);
	try {
		return await fn();
	} finally {
		running.delete(pid);
		setSharingBusy(pid, false);
	}
}

/** ローカルのプロジェクトの sharing だけを書き換える(updatedAt は変えない。リモートへは別途書く) */
async function writeLocalSharing(
	pid: string,
	sharing: ProjectSharing | undefined,
	bump = false
): Promise<Project> {
	const result = await db.transaction('rw', db.projects, async () => {
		const current = await db.projects.get(pid);
		if (!current) throw new Error('プロジェクトが見つかりません');
		const next: Project = bump
			? { ...current, updatedAt: Date.now(), _version: (current._version || 0) + 1 }
			: { ...current };
		if (sharing) next.sharing = sharing;
		else delete next.sharing;
		await db.projects.put(next);
		return next;
	});
	await refreshProjectStores();
	return result;
}

async function getProjectOrThrow(pid: string): Promise<Project> {
	const project = await db.projects.get(pid);
	if (!project) throw new Error('プロジェクトが見つかりません');
	return project;
}

async function childrenOf(pid: string): Promise<Record<ChildType, Record<string, unknown>[]>> {
	const out = {} as Record<ChildType, Record<string, unknown>[]>;
	for (const type of CHILD_TYPES) {
		out[type] = (await db[type].where('projectId').equals(pid).toArray()) as unknown as Record<
			string,
			unknown
		>[];
	}
	return out;
}

// ---------- 開始 ----------

/**
 * 共有を開始する(冪等・再開可能)。
 * ① 保留中の変更をフラッシュ ② ローカルを migrating で保存 ③〜⑥ リモートの移行 ⑦ ローカルを active に
 * 失敗しても migrating のまま残るので、同じ呼び出し(または起動時の再開)で続きから完了する。
 */
export async function startSharing(projectId: string, options: StartSharingOptions): Promise<void> {
	const uid = requireOwner();
	if (!isUnguessableProjectId(projectId)) {
		// pid は共有側のパスになり、link 公開では ID を知っていれば読める。推測できる ID は使えない
		throw new Error(
			'このプロジェクトの ID は推測しやすいため、共有できません(複製してから共有してください)'
		);
	}

	await exclusive(projectId, async () => {
		const project = await getProjectOrThrow(projectId);
		if (
			project.sharing &&
			!(project.sharing.status === 'migrating' && project.sharing.migration === 'start')
		) {
			throw new Error('このプロジェクトは既に共有されています');
		}

		if (!project.sharing) {
			// 秘密の指定を先に検証・生成する(空のパスワードなど)
			const viewer = resolveSecret(options.viewerSecret);
			const editor = resolveSecret(options.editorSecret);

			// ① 保留中の変更を送る。送れていないと、最上位と shared の食い違いが残るので開始しない
			await flushPendingChanges();
			const blockers = getPendingSnapshot().filter(
				(c) => c.target === 'primary' && (c.type !== 'projects' || c.id !== projectId)
			);
			if (blockers.length > 0) {
				throw new Error('未送信の変更があります。同期が終わってからもう一度お試しください');
			}

			// ② migrating で保存(秘密もここで確定。再開時に同じ値を使う)
			await writeLocalSharing(
				projectId,
				{
					pid: projectId,
					role: 'owner',
					visibility: options.visibility,
					status: 'migrating',
					secrets: { viewer, editor },
					// 方式を記録する(招待リンクにトークンだけを含めるため)
					secretKinds: {
						viewer: options.viewerSecret?.type === 'password' ? 'password' : 'token',
						editor: options.editorSecret?.type === 'password' ? 'password' : 'token'
					},
					startedAt: Date.now(),
					migration: 'start'
				},
				true
			);
		}
		await runStart(projectId, uid);
	});
}

async function runStart(pid: string, uid: string): Promise<void> {
	// 開いているプロジェクトの購読先を shared に切り替える(最上位の子要素が消えても削除と誤解しない)
	await restartProjectRealtime(pid);

	const project = await getProjectOrThrow(pid);
	const result = await startSharingRemote(getFirestoreInstance(), uid, {
		pid,
		project,
		children: await childrenOf(pid)
	});

	// ⑦ ローカルを active に(移行中に編集されていても、本文などは触らず sharing だけ更新する)
	await writeLocalSharing(pid, result.project.sharing);
	await restartProjectRealtime(pid);
	// shared 側の内容を取り込む(基準になる base を作る)
	void downloadAllFromFirestore().catch((e) => console.warn('Download after sharing failed:', e));
}

// ---------- 停止 ----------

/**
 * 共有を停止して、データを最上位に戻す(冪等・再開可能)。
 * ゲスト側のデータはゲスト端末のローカルに残る(この段階では扱わない)。
 */
export async function stopSharing(projectId: string): Promise<void> {
	const uid = requireOwner();
	await exclusive(projectId, async () => {
		const project = await getProjectOrThrow(projectId);
		const sharing = project.sharing;
		if (!sharing) return;
		if (sharing.status === 'migrating' && sharing.migration === 'start') {
			throw new Error('共有の開始が途中です。先に開始を完了してください');
		}
		if (!(sharing.status === 'migrating' && sharing.migration === 'stop')) {
			await writeLocalSharing(projectId, { ...sharing, status: 'migrating', migration: 'stop' });
		}
		await runStop(projectId, uid);
	});
}

async function runStop(pid: string, uid: string): Promise<void> {
	// 共有側が消えるので購読を止める
	stopProjectRealtime(pid);

	// 保留中の変更を共有側に送り、他の参加者の編集もローカルに取り込む(書き戻す内容を最新にする)
	await flushPendingChanges();
	await pullSharedProject(pid);

	const project = await getProjectOrThrow(pid);
	await stopSharingRemote(getFirestoreInstance(), uid, { pid, project });

	// ローカルから sharing を外す。以後、子要素の行き先は primary
	const key = sharedTargetKey(pid);
	const unsynced: { type: ChildType | 'projects'; id: string }[] = [{ type: 'projects', id: pid }];
	for (const type of CHILD_TYPES) {
		for (const entity of await db[type].where('projectId').equals(pid).toArray()) {
			const base = getBase(type, entity.id, key);
			// 共有側と一致していた版は書き戻し済み。未送信の編集(base より新しい/base なし)だけ最上位へ送る
			if (base === undefined || entity.updatedAt > base) unsynced.push({ type, id: entity.id });
			removeBase(type, entity.id, key);
		}
	}
	await writeLocalSharing(pid, undefined);
	saveSyncState(withoutTargetState(loadSyncState(), key));

	await queueChanges(unsynced.map(({ type, id }) => ({ type, id, action: 'update' as const })));
	await restartProjectRealtime(pid);
}

// ---------- プロジェクトの削除 ----------

/**
 * 共有中のプロジェクトを削除する前に、共有側(データ・参加者・秘密・メタ)を削除する。
 * 共有側のデータはここで失われる。完了後はローカルの sharing も外すので、続く削除は通常の経路になる。
 * 共有していないプロジェクトでは何もしない。
 */
export async function deleteProjectSharing(projectId: string): Promise<void> {
	const project = await db.projects.get(projectId);
	// ゲストのプロジェクト(接続あり・なし)は共有側を削除しない(それはオーナーの操作)
	if (!project?.sharing || project.sharing.connectionId || project.sharing.role !== 'owner') return;
	requireOwner();

	await exclusive(projectId, async () => {
		stopProjectRealtime(projectId);
		const firestore = getFirestoreInstance();
		await deleteSharedData(firestore, projectId);
		await removePointerSharing(firestore, projectId);
		saveSyncState(withoutTargetState(loadSyncState(), sharedTargetKey(projectId)));
		await writeLocalSharing(projectId, undefined);
	});
}

// ---------- 起動時の再開 ----------

let resumeStarted = false;

/** status が migrating のまま残っているプロジェクトの移行を再開する(バックグラウンド。失敗は次回に持ち越す) */
export async function resumeSharingMigrations(): Promise<void> {
	if (!getShareAvailability().ok) return;
	const uid = authStore.user!.uid;
	const targets = (await db.projects.toArray()).filter(needsResume);
	if (targets.length === 0 || resumeStarted) return;
	resumeStarted = true;
	try {
		for (const project of targets) {
			const pid = project.id;
			if (running.has(pid)) continue;
			try {
				await exclusive(pid, () =>
					project.sharing?.migration === 'stop' ? runStop(pid, uid) : runStart(pid, uid)
				);
				console.log(`✅ Resumed sharing migration: ${pid}`);
			} catch (error) {
				console.warn(`Failed to resume sharing migration for ${pid}:`, error);
			}
		}
	} finally {
		resumeStarted = false;
	}
}

// ---------- 管理 ----------

async function requireActiveOwner(
	pid: string
): Promise<{ project: Project; sharing: ProjectSharing }> {
	const project = await getProjectOrThrow(pid);
	const sharing = project.sharing;
	if (!sharing || sharing.role !== 'owner' || sharing.connectionId) {
		throw new Error('このプロジェクトはオーナーとして共有していません');
	}
	if (sharing.status !== 'active') throw new Error('共有の移行中は変更できません');
	return { project, sharing };
}

/** 公開範囲の変更 */
export async function changeVisibility(
	projectId: string,
	visibility: 'private' | 'link'
): Promise<void> {
	requireOwner();
	await exclusive(projectId, async () => {
		const { sharing } = await requireActiveOwner(projectId);
		if (sharing.visibility === visibility) return;
		const next: ProjectSharing = { ...sharing, visibility };
		const firestore = getFirestoreInstance();
		await writeLocalSharing(projectId, next);
		try {
			await setVisibilityRemote(firestore, projectId, visibility);
			await writeSharingInfo(firestore, projectId, next);
		} catch (error) {
			await writeLocalSharing(projectId, sharing);
			throw error;
		}
	});
}

/**
 * 秘密の再生成(viewer / editor)。新しい値で secrets 文書とローカル(ポインタ)を更新する。
 * 以前の秘密で発行した招待は使えなくなる。参加済みのメンバーは失効しない(メンバーの削除で失効させる)。
 * 戻り値は新しい秘密(パスワードを指定した場合はその文字列)。
 */
export async function regenerateSecret(
	projectId: string,
	role: 'viewer' | 'editor',
	spec?: SecretSpec
): Promise<string> {
	requireOwner();
	return exclusive(projectId, async () => {
		const { sharing } = await requireActiveOwner(projectId);
		const value = resolveSecret(spec);
		const next: ProjectSharing = {
			...sharing,
			secrets: { ...sharing.secrets, [role]: value },
			secretKinds: {
				...sharing.secretKinds,
				[role]: spec?.type === 'password' ? 'password' : 'token'
			}
		};
		const firestore = getFirestoreInstance();
		// 秘密はクライアントから読み戻せないので、ローカルに先に保存する(保存前に落ちて新しい値を失うのを避ける)
		await writeLocalSharing(projectId, next);
		try {
			await writeSecret(firestore, projectId, role, value);
			await writeSharingInfo(firestore, projectId, next);
		} catch (error) {
			await writeLocalSharing(projectId, sharing);
			throw error;
		}
		return value;
	});
}

export async function getMembers(projectId: string): Promise<SharedMember[]> {
	requireOwner();
	await requireActiveOwner(projectId);
	return listMembersRemote(getFirestoreInstance(), projectId);
}

/** メンバーを失効させる。同じ秘密で再参加できるので、必要なら秘密も再生成すること */
export async function removeMember(projectId: string, uid: string): Promise<void> {
	requireOwner();
	await requireActiveOwner(projectId);
	await removeMemberRemote(getFirestoreInstance(), projectId, uid);
}
