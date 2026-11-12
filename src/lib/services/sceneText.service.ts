import * as Y from 'yjs';
import type { Firestore } from 'firebase/firestore';
import { db, historyDB, projectsDB, scenesDB } from '$lib/db';
import { getAuthInstanceSafe } from '$lib/firebase/config';
import { getConnectionSession } from '$lib/firebase/connection';
import { targetFromKey } from '$lib/firebase/sync';
import { waitForTargetReady } from '$lib/firebase/targetReady';
import { isGuestSharing, parseTargetKey } from '$lib/firebase/syncTarget';
import {
	CrdtOpenError,
	createDocManager,
	type CrdtOpenFailure,
	type OpenOptions,
	type SceneDocHandle
} from '$lib/crdt/doc';
import { dexiePersistence, removeCrdtDocs } from '$lib/crdt/persistence';
import { firestoreTransport } from '$lib/crdt/transport';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { syncStore } from '$lib/stores/sync.svelte';
import { queueChange, revokeGuestAccess } from '$lib/services/sync.service';
import type { Project } from '$lib/types';

/**
 * シーン本文の窓口(共有プロジェクトのシーンは CRDT、それ以外は従来どおり Scene.content)。
 * エディタ・検索置換・AI の applyEdit・シーン切替は、共有プロジェクトのシーンの本文を
 * ここを通して読み書きする(Scene.content を直接書くと、CRDT 側の本文と食い違う)。
 */

// ターゲットごとの、サインイン中のユーザー ID(updates 文書の by に入れる)
const uidByTarget = new Map<string, string>();

async function resolveDb(targetKey: string): Promise<Firestore | null> {
	const ref = parseTargetKey(targetKey);
	if (!ref || ref.kind !== 'shared') return null;
	if (ref.connectionId) {
		// ゲスト接続は匿名サインインの完了を待つ(オフラインで新規サインインできない場合は例外)
		const session = await getConnectionSession(ref.connectionId);
		uidByTarget.set(targetKey, session.uid);
		return session.db;
	}
	const target = targetFromKey(targetKey);
	if (!target) return null;
	uidByTarget.set(targetKey, getAuthInstanceSafe()?.currentUser?.uid ?? '');
	return target.db;
}

/** ミラー後に、開いているプロジェクトのシーン一覧(文字数の表示など)を更新する */
async function refreshSceneInStore(sceneId: string, projectId: string): Promise<void> {
	if (currentProjectStore.project?.id !== projectId) return;
	const latest = await scenesDB.getById(sceneId);
	if (!latest) return;
	currentProjectStore.scenes = currentProjectStore.scenes.map((s) =>
		s.id === sceneId ? latest : s
	);
}

const manager = createDocManager({
	transport: firestoreTransport,
	persistence: dexiePersistence,
	resolveDb,
	async getScene(sceneId) {
		const scene = await scenesDB.getById(sceneId);
		return scene ? { content: scene.content, projectId: scene.projectId } : undefined;
	},
	async mirrorContent(sceneId, text, { projectId, readOnly }) {
		// characterCount・履歴・プロジェクトの更新日時は scenesDB.update の既存のロジックに任せる
		// 共同編集のミラーは他の人の変更や復元を含むため、拡張向けのイベントは発行しない(自分の分だけを切り分けられない)
		await scenesDB.update(sceneId, { content: text }, { silent: true });
		await refreshSceneInStore(sceneId, projectId);
		// 共有側の scenes 文書の content もミラーとして従来の同期で更新する(読み取り専用は送らない)
		if (!readOnly) await queueChange('scenes', sceneId, 'update');
	},
	async backupScene(sceneId) {
		const scene = await scenesDB.getById(sceneId);
		if (scene) await historyDB.create('scene', scene.id, scene.projectId, scene, 'conflict');
	},
	currentUid: (targetKey) => uidByTarget.get(targetKey) ?? '',
	onPermissionDenied({ pid }) {
		syncStore.error =
			'共有プロジェクトの本文を書き込む権限がありません。本文は読み取り専用になりました';
		// ゲストなら、2b-3 の仕組みでアクセス失効として扱う(接続を無効にし、プロジェクトを読み取り専用にする)
		void (async () => {
			const project = await projectsDB.getById(pid);
			if (project && isGuestSharing(project.sharing)) await revokeGuestAccess(pid);
		})();
	},
	onError(message) {
		syncStore.error = message;
	},
	isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
	onOnline(callback) {
		if (typeof window === 'undefined') return () => {};
		window.addEventListener('online', callback);
		return () => window.removeEventListener('online', callback);
	},
	now: () => Date.now()
});

async function projectOfScene(sceneId: string): Promise<Project | undefined> {
	const scene = await scenesDB.getById(sceneId);
	return scene ? await projectsDB.getById(scene.projectId) : undefined;
}

/** 共有プロジェクト(共有が active)のシーンか。true なら本文は CRDT が正 */
export async function isCrdtScene(sceneId: string): Promise<boolean> {
	const project = await projectOfScene(sceneId);
	return project?.sharing?.status === 'active';
}

/**
 * シーンを開く(エディタ用。3b で結合する)。同じシーンを複数回開いても 1 つの文書を共有する。
 * 開けない場合は CrdtOpenError(reason 付き)。その場合、呼び出し側は従来の content で扱う。
 */
export async function openSceneDoc(
	sceneId: string,
	options?: OpenOptions
): Promise<SceneDocHandle> {
	const project = await projectOfScene(sceneId);
	if (!project) throw new CrdtOpenError('unavailable', 'シーンまたはプロジェクトが見つかりません');
	// 起動直後は Firebase の初期化・ゲスト接続の登録が終わっていないことがあるので、少し待ってから開く
	await waitForTargetReady(project.sharing);
	return manager.openScene(sceneId, project, options);
}

/**
 * 現在の本文。開いていればその文書、保存済みの状態があればそれ(ネットワーク不要)、
 * どちらも無ければ Scene.content。
 */
export async function getSceneText(sceneId: string): Promise<string | undefined> {
	const open = manager.peekText(sceneId);
	if (open !== undefined) return open;

	const scene = await scenesDB.getById(sceneId);
	if (!scene) return undefined;
	const row = await dexiePersistence.load(sceneId);
	if (!row) return scene.content;

	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, row.state);
		if (row.pending) Y.applyUpdate(doc, row.pending);
		return doc.getText('content').toString();
	} finally {
		doc.destroy();
	}
}

export type ApplySceneTextResult =
	| { ok: true; changed: boolean }
	| { ok: false; reason: 'not-crdt' | 'read-only' | CrdtOpenFailure; message: string };

const FAILURE_MESSAGES: Record<CrdtOpenFailure | 'not-crdt' | 'read-only', string> = {
	'not-crdt': 'このシーンは共有プロジェクトのシーンではありません',
	'read-only': 'このシーンは読み取り専用です',
	'not-shared': 'このプロジェクトは共有されていません',
	offline:
		'オフラインのため、共同編集の本文をまだ取得できていません。オンラインで一度開いてから編集してください',
	'no-snapshot': '共同編集の本文がまだ作成されていません(編集権限のある人が一度開くと作成されます)',
	denied: 'このシーンを編集する権限がありません',
	unavailable: 'シーンを開けませんでした'
};

/**
 * 本文を newText にする(最小差分を適用して送信)。開いていないシーンでも、保存済みの状態または
 * snapshot から文書を読み込んで適用する。オフラインで初回の snapshot が無い場合は失敗を理由つきで返す。
 * 開いているシーンの場合、送信・保存は文書側のデバウンスに任せる。
 */
export async function applySceneText(
	sceneId: string,
	newText: string,
	origin: unknown = 'local'
): Promise<ApplySceneTextResult> {
	const project = await projectOfScene(sceneId);
	if (!project || project.sharing?.status !== 'active') {
		return { ok: false, reason: 'not-crdt', message: FAILURE_MESSAGES['not-crdt'] };
	}

	const wasOpen = manager.isOpen(sceneId);
	let handle: SceneDocHandle;
	try {
		handle = await manager.openScene(sceneId, project, { listen: wasOpen });
	} catch (error) {
		const reason = error instanceof CrdtOpenError ? error.reason : 'unavailable';
		return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
	}

	try {
		if (handle.readOnly) {
			return { ok: false, reason: 'read-only', message: FAILURE_MESSAGES['read-only'] };
		}
		const before = handle.ytext.toString();
		handle.setText(newText, origin);
		if (!wasOpen) await handle.flush();
		return { ok: true, changed: before !== newText };
	} finally {
		await handle.destroy();
	}
}

let resuming = false;

/**
 * 未送信の更新が残っているシーン(オフラインで編集して閉じたもの)を再送する。
 * オンラインに戻ったとき、アプリの起動時に呼ぶ。
 */
export async function resumePendingSends(): Promise<void> {
	if (resuming || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
	resuming = true;
	try {
		for (const row of await dexiePersistence.listWithPending()) {
			if (manager.isOpen(row.sceneId)) continue;
			const project = await projectOfScene(row.sceneId);
			if (!project || project.sharing?.status !== 'active') continue;
			try {
				const handle = await manager.openScene(row.sceneId, project, { listen: false });
				try {
					await handle.flush();
				} finally {
					await handle.destroy();
				}
			} catch (error) {
				console.warn(`Failed to resume pending CRDT updates (${row.sceneId}):`, error);
			}
		}
	} finally {
		resuming = false;
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => void resumePendingSends());
}

/** 開いている全シーンの保存を今すぐ行う(離脱時など) */
export const persistOpenScenes = () => manager.persistAll();

/** 開いている全シーンの保存・ミラー・送信を今すぐ行う(共有の停止の前に最新の本文をそろえるとき) */
export const flushOpenSceneDocs = () => manager.flushAll();

/**
 * プロジェクトの共同編集の状態を捨てる(共有の停止・退出・アクセス失効のとき)。
 * 開いている文書は以後 通信・保存・ミラーをせず、crdtDocs の行も削除する。Scene.content はそのまま残る。
 */
export async function discardProjectCrdtState(projectId: string): Promise<void> {
	const sceneIds = (await db.scenes.where('projectId').equals(projectId).primaryKeys()) as string[];
	for (const sceneId of sceneIds) manager.discard(sceneId);
	await removeCrdtDocs(sceneIds);
}
