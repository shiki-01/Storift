import { connectionsDB, db, historyDB, projectsDB, settingsDB } from '$lib/db';
import { getFirestoreInstance, isFirebaseInitialized } from '$lib/firebase/config';
import {
	ensureSignedIn,
	getConnectionSession,
	openHost,
	registerConnection,
	unregisterConnection
} from '$lib/firebase/connection';
import { decodeInvite, INVITE_ERROR_MESSAGES, type InviteData } from '$lib/firebase/invite';
import {
	JOIN_CHILD_TYPES,
	ProjectMissingError,
	diagnoseDenied,
	fetchSharedSnapshot,
	joinSharedProject,
	leaveSharedProject as leaveSharedProjectRemote,
	type JoinChildType,
	type SharedSnapshot
} from '$lib/firebase/join';
import {
	LOCAL_CONFLICT_MESSAGES,
	ROUTE_BLOCK_MESSAGES,
	checkLocalProject,
	classifyJoinError,
	decideJoinRoute,
	isPermissionDeniedError,
	type JoinRoute,
	type JoinStage
} from '$lib/firebase/joinPolicy';
import { removeBase, setBase } from '$lib/firebase/syncMeta';
import { connectionIdOf, isRevokedSharing, sharedTargetKey } from '$lib/firebase/syncTarget';
import { resolveDisplayName } from '$lib/crdt/presencePolicy';
import { discardProjectCrdtState } from '$lib/services/sceneText.service';
import { authStore } from '$lib/stores/auth.svelte';
import { syncStore } from '$lib/stores/sync.svelte';
import { refreshAccessMode } from '$lib/services/access.service';
import {
	contentDiffers,
	discardGuestTarget,
	flushPendingChanges,
	notifyConnectionsChanged,
	refreshGuestState,
	refreshProjectStores,
	stopProjectRealtime
} from '$lib/services/sync.service';
import type { Connection, History, Project, ProjectSharing } from '$lib/types';
import type { SyncableEntity } from '$lib/firebase/sync';

/**
 * 招待リンクからの参加・退出(ゲスト側)。
 * Firestore の操作は firebase/join.ts にあり、ここはローカル(Dexie)の状態・接続の登録・同期との協調を担う。
 * ゲストのプロジェクトは、ゲストの主 Firebase には同期しない(他人のデータをゲストのクラウドへ複製しない)。
 */

// ---------- 参加の準備 ----------

export type BlockedKind =
	| 'invalid'
	| keyof typeof ROUTE_BLOCK_MESSAGES
	| 'own-project'
	| 'plain-project';

export type PreparedJoin =
	| {
			ok: true;
			invite: InviteData;
			route: JoinRoute;
			/** パスワード方式(リンクに秘密が無い): 入力が必要 */
			needsPassword: boolean;
			/** この端末に既にある同じプロジェクト(再参加)のタイトル */
			existingTitle?: string;
	  }
	| { ok: false; kind: BlockedKind; message: string };

/** 招待リンク(またはペイロード)を読み、参加できるか判断する。参加の処理はしない */
export async function prepareJoin(text: string): Promise<PreparedJoin> {
	const decoded = decodeInvite(text);
	if (!decoded.ok) {
		return { ok: false, kind: 'invalid', message: INVITE_ERROR_MESSAGES[decoded.error] };
	}
	const invite = decoded.invite;

	const primary = await settingsDB.getFirebaseConfig();
	let mode = authStore.accessMode;
	// 主 Firebase と同じで状態が未判定なら、判定してから決める(誤ってオーナー端末に参加しないため)
	const sameHost =
		!!primary &&
		primary.projectId === invite.config.projectId &&
		primary.apiKey === invite.config.apiKey;
	if (sameHost && isFirebaseInitialized() && (mode === null || mode === 'unknown')) {
		mode = await refreshAccessMode();
	}

	const route = decideJoinRoute(primary, invite.config, mode);
	if (
		route.kind === 'owner-device' ||
		route.kind === 'legacy-rules' ||
		route.kind === 'unknown-access'
	) {
		return { ok: false, kind: route.kind, message: ROUTE_BLOCK_MESSAGES[route.kind] };
	}

	const existing = await projectsDB.getById(invite.pid);
	const conflict = checkLocalProject(existing);
	if (conflict) {
		return { ok: false, kind: conflict, message: LOCAL_CONFLICT_MESSAGES[conflict] };
	}

	return {
		ok: true,
		invite,
		route,
		needsPassword: invite.secret === undefined,
		existingTitle: existing?.title
	};
}

// ---------- 参加の実行 ----------

export interface JoinOptions {
	/** パスワード方式のとき、入力されたパスワード */
	password?: string;
	/** メンバー一覧に表示される名前(任意) */
	displayName?: string;
}

export type JoinOutcome =
	| {
			ok: true;
			projectId: string;
			title: string;
			role: 'viewer' | 'editor';
			rejoined: boolean;
			/** 招待の役割と、すでに持っている役割が違うときの案内 */
			note?: string;
	  }
	| { ok: false; message: string };

/** 参加する。事前に prepareJoin で ok を確認しておくこと */
export async function executeJoin(
	prepared: Extract<PreparedJoin, { ok: true }>,
	options: JoinOptions = {}
): Promise<JoinOutcome> {
	const { invite, route } = prepared;
	const secret = invite.secret ?? options.password?.trim();
	if (!secret) return { ok: false, message: 'パスワードを入力してください' };

	let stage: JoinStage = 'signin';
	let legacyRules = false;
	try {
		// 接続先と、その接続での自分の uid
		let firestore;
		let uid: string;
		let connectionId: string | undefined;
		if (route.kind === 'primary-guest') {
			if (!isFirebaseInitialized() || !authStore.user) {
				return {
					ok: false,
					message: 'この端末の Firebase にサインインできていません。通信状態を確認してください'
				};
			}
			firestore = getFirestoreInstance();
			uid = authStore.user.uid;
		} else {
			const handle = openHost(invite.config);
			uid = (await ensureSignedIn(handle)).uid;
			firestore = handle.db;
			connectionId = connectionIdOf(invite.config, invite.pid);
		}

		// 参加(members/{uid} の作成。ルールが秘密を照合する)
		stage = 'member';
		let joined;
		try {
			joined = await joinSharedProject(firestore, uid, {
				pid: invite.pid,
				role: invite.role,
				secret,
				// 参加時の名前: 指定 > 設定の表示名 > ゲスト-<uidの先頭4文字>
				name: resolveDisplayName(
					options.displayName || (await settingsDB.get()).displayName,
					'editor',
					uid
				)
			});
		} catch (error) {
			if (isPermissionDeniedError(error)) {
				legacyRules =
					(await diagnoseDenied(firestore, uid).catch(() => 'unknown')) === 'legacy-rules';
			}
			throw error;
		}

		// 共有側のデータを取得
		stage = 'fetch';
		const snapshot = await fetchSharedSnapshot(firestore, invite.pid);
		if (!snapshot.project) throw new ProjectMissingError();

		// ローカルに保存し、接続を登録する
		const sharing: ProjectSharing = {
			pid: invite.pid,
			role: joined.role,
			...(connectionId ? { connectionId } : {}),
			visibility: snapshot.metaVisibility === 'link' ? 'link' : 'private',
			status: 'active',
			startedAt: Date.now()
		};
		const saved = await saveJoinedProject(snapshot, sharing, invite);

		if (connectionId) {
			const previous = await connectionsDB.get(connectionId);
			const connection: Connection = {
				id: connectionId,
				firebaseConfig: invite.config,
				pid: invite.pid,
				role: joined.role,
				name: invite.nameHint ?? saved.project.title,
				status: 'active',
				createdAt: previous?.createdAt ?? Date.now()
			};
			await connectionsDB.put(connection);
			registerConnection(connection);
			syncStore.isConfigured = true;
		}

		await refreshProjectStores();
		// 同期を始める(待たない)。失敗しても参加は成立している
		void notifyConnectionsChanged().catch((error) =>
			console.warn('Failed to start guest sync after join:', error)
		);

		return {
			ok: true,
			projectId: invite.pid,
			title: saved.project.title,
			role: joined.role,
			rejoined: saved.rejoined,
			...(joined.role !== invite.role
				? {
						note: `招待の権限(${invite.role === 'editor' ? '編集' : '閲覧'})とは異なり、すでに参加している権限(${joined.role === 'editor' ? '編集' : '閲覧'})のままです。権限を変えるには、オーナーにメンバーの削除を依頼してから、もう一度参加してください。`
					}
				: {})
		};
	} catch (error) {
		console.error(`Join failed (${stage}):`, error);
		if (error instanceof ProjectMissingError) {
			return { ok: false, message: error.message };
		}
		return {
			ok: false,
			message: classifyJoinError(error, stage, {
				legacyRules,
				passwordInvite: invite.secret === undefined
			}).message
		};
	}
}

const HISTORY_TYPE: Record<JoinChildType, History['entityType']> = {
	chapters: 'chapter',
	scenes: 'scene',
	characters: 'character',
	plots: 'plot',
	worldbuilding: 'worldbuilding'
};

/**
 * 取得結果をローカルに保存する(リモート優先のマージ)。
 * 同じ ID のプロジェクトが既にあれば再利用し、子要素はリモートの内容で上書きする(内容が違うローカルの版は履歴に退避)。
 * リモートに無いローカルの子要素は消さない。
 */
async function saveJoinedProject(
	snapshot: SharedSnapshot,
	sharing: ProjectSharing,
	invite: InviteData
): Promise<{ project: Project; rejoined: boolean }> {
	const pid = sharing.pid;
	const key = sharedTargetKey(pid, sharing.connectionId);
	const existing = await projectsDB.getById(pid);

	const remote = snapshot.project as unknown as Project;
	const merged: Project = {
		...(existing ?? {}),
		...remote,
		id: pid,
		title: remote.title ?? snapshot.metaName ?? invite.nameHint ?? '共有されたプロジェクト',
		sharing
	};
	delete merged.localOnly;

	// 上書きされるローカルの版を、先に履歴へ退避する(失敗しても参加は続ける)
	for (const type of JOIN_CHILD_TYPES) {
		const table = db[type] as unknown as import('dexie').Table<SyncableEntity, string>;
		const remotes = snapshot.children[type] as unknown as SyncableEntity[];
		const locals = await table.bulkGet(remotes.map((r) => r.id));
		for (const [i, local] of locals.entries()) {
			if (!local || !contentDiffers(local, remotes[i])) continue;
			try {
				await historyDB.create(HISTORY_TYPE[type], local.id, pid, local, 'conflict');
			} catch (error) {
				console.warn(`Failed to back up ${type}/${local.id}:`, error);
			}
		}
	}

	await db.transaction(
		'rw',
		[db.projects, db.chapters, db.scenes, db.characters, db.plots, db.worldbuilding],
		async () => {
			await db.projects.put(merged);
			await db.chapters.bulkPut(snapshot.children.chapters as never[]);
			await db.scenes.bulkPut(snapshot.children.scenes as never[]);
			await db.characters.bulkPut(snapshot.children.characters as never[]);
			await db.plots.bulkPut(snapshot.children.plots as never[]);
			await db.worldbuilding.bulkPut(snapshot.children.worldbuilding as never[]);
		}
	);

	// 取得した版を「共有側と一致していた版」として記録する(以後の差分取得・突き合わせの基準)
	for (const type of JOIN_CHILD_TYPES) {
		for (const entity of snapshot.children[type]) {
			setBase(type, entity.id as string, entity.updatedAt as number, key);
		}
	}
	return { project: merged, rejoined: !!existing };
}

// ---------- 退出 ----------

export type LeaveMode = 'keep' | 'delete';

/**
 * ゲストが共有から退出する。members/{自分のuid} を削除し、ローカルのコピーを
 * 'keep'(共有を解除してローカル専用にする。どこにも同期しない)か 'delete'(削除)にする。
 * 通信できずに退出できなかった場合は、ローカルには何もせず例外を投げる(再試行できる)。
 * アクセス権が既に無効(失効済み)の場合は、リモートの操作をせずローカルの処理だけ行う。
 */
export async function leaveGuestProject(pid: string, mode: LeaveMode): Promise<void> {
	const project = await projectsDB.getById(pid);
	const sharing = project?.sharing;
	if (!project || !sharing || sharing.role === 'owner') {
		throw new Error('このプロジェクトはゲストとして参加していません');
	}

	if (!isRevokedSharing(sharing)) {
		// 編集者の未送信の変更は、退出の前に送っておく(送れなくてもローカルのコピーには残る)
		if (sharing.role === 'editor') await flushPendingChanges().catch(() => undefined);
		try {
			const session = sharing.connectionId
				? await getConnectionSession(sharing.connectionId)
				: authStore.user && isFirebaseInitialized()
					? { db: getFirestoreInstance(), uid: authStore.user.uid }
					: null;
			if (!session) throw new Error('サインインしていません');
			await leaveSharedProjectRemote(session.db, session.uid, pid);
		} catch (error) {
			// 既にメンバーでない(権限なし)なら、退出済みとして続ける
			if (!isPermissionDeniedError(error)) {
				console.error('Failed to leave shared project:', error);
				throw new Error('共有から退出できませんでした。通信状態を確認して、もう一度お試しください');
			}
		}
	}

	stopProjectRealtime(pid);
	const key = sharedTargetKey(pid, sharing.connectionId);
	discardGuestTarget(pid, sharing.connectionId);
	// 共同編集の状態(crdtDocs)は共有側のもの。退出したら捨てる(本文は Scene.content に残る)
	await discardProjectCrdtState(pid).catch((e) => console.warn('Failed to discard CRDT state:', e));

	if (mode === 'keep') {
		await db.transaction('rw', db.projects, async () => {
			const current = await db.projects.get(pid);
			if (!current) return;
			const next: Project = { ...current, localOnly: true };
			delete next.sharing;
			await db.projects.put(next);
		});
	}
	// 共有側と一致していた版の記録は不要になる(ローカル専用のコピーはどこにも同期しない)
	for (const type of JOIN_CHILD_TYPES) {
		const ids = (await db[type].where('projectId').equals(pid).primaryKeys()) as string[];
		for (const id of ids) removeBase(type, id, key);
	}
	if (mode === 'delete') await projectsDB.delete(pid);

	if (sharing.connectionId) {
		await connectionsDB.delete(sharing.connectionId);
		unregisterConnection(sharing.connectionId);
	}
	await refreshGuestState();
	await refreshProjectStores();
}
