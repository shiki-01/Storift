import type { Unsubscribe } from 'firebase/firestore';
import { getAuthInstanceSafe, getFirestoreInstanceSafe } from '$lib/firebase/config';
import { getConnectionSession } from '$lib/firebase/connection';
import { deletePresence, listenPresence, writePresence } from '$lib/firebase/presence';
import { isPermissionDeniedError } from '$lib/firebase/joinPolicy';
import { isRevokedSharing } from '$lib/firebase/syncTarget';
import { waitForTargetReady } from '$lib/firebase/targetReady';
import {
	PRESENCE_INTERVAL_MS,
	presenceColor,
	resolveDisplayName,
	type PresenceCursor
} from '$lib/crdt/presencePolicy';
import { createCursorThrottle } from '$lib/crdt/remoteCursor';
import { withTimeout } from '$lib/utils/asyncControl';
import { presenceStore } from '$lib/stores/presence.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { Project } from '$lib/types';

/**
 * 在席情報の送受信。エディタを開いている間だけ動かす。
 * - 書き込み: シーンを開いた時・30 秒ごと(タブが見えている間)・離脱時に削除(ベストエフォート)
 * - カーソル: 選択範囲の変化を 3 秒以上あけて書く(最後の位置は必ず送る)。設定で「他の人のカーソルを表示」が
 *   オフの間は、通信量を抑えるため自分の位置も送らない(null のまま)
 * - 購読: presence コレクション。表示側(presenceStore.others)が 90 秒以内の他者だけに絞る
 * ゲスト接続(connectionId)の Firestore にも対応する。権限が無い・通信できないときは黙って止める。
 */

export interface PresenceSession {
	/** 開いているシーンが変わった */
	setScene(sceneId: string | null): void;
	/** 本文での選択範囲(相対位置)。フォーカスを失ったら null。書き込みは間引かれる */
	setCursor(cursor: PresenceCursor | null): void;
	stop(): Promise<void>;
}

const CLEAR_TIMEOUT = 3_000;

export async function startPresence(
	project: Project,
	initialSceneId: string | null
): Promise<PresenceSession | null> {
	const sharing = project.sharing;
	if (!sharing || sharing.status !== 'active' || isRevokedSharing(sharing)) return null;
	const pid = sharing.pid;

	let session;
	try {
		await waitForTargetReady(sharing);
		if (sharing.connectionId) {
			session = await getConnectionSession(sharing.connectionId);
		} else {
			const db = getFirestoreInstanceSafe();
			const uid = getAuthInstanceSafe()?.currentUser?.uid;
			if (!db || !uid) return null;
			session = { db, uid };
		}
	} catch (error) {
		console.warn('Presence: connection not ready:', error);
		return null;
	}
	const { db, uid } = session;

	let sceneId = initialSceneId;
	let stopped = false;
	let denied = false;
	let unsubscribe: Unsubscribe | null = null;

	presenceStore.selfUid = uid;

	const cursorEnabled = () => settingsStore.settings.showRemoteCursors !== false;

	const write = async () => {
		if (stopped || denied || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
		// 定期書き込み・シーン切り替えにも最新の位置を載せ、予約中のカーソル書き込みは不要になる
		const cursor = sceneId && cursorEnabled() ? cursorThrottle.latest : null;
		cursorThrottle.markSent(cursor);
		try {
			await writePresence(db, pid, uid, {
				name: resolveDisplayName(settingsStore.settings.displayName, sharing.role, uid),
				color: presenceColor(uid),
				sceneId,
				cursor,
				updatedAt: Date.now()
			});
		} catch (error) {
			if (isPermissionDeniedError(error)) denied = true;
			else console.debug('Presence: write failed:', error);
		}
	};

	// 間隔があいたときに呼ばれる。write() が最新の位置を載せる
	const cursorThrottle = createCursorThrottle({ send: () => void write() });

	const clear = () => deletePresence(db, pid, uid).catch(() => undefined);

	const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

	// 購読した在席の期限切れ判定用の時刻は 15 秒ごとに更新し、書き込みは 30 秒ごとに行う
	let beat = 0;
	const timer = setInterval(() => {
		presenceStore.tick();
		beat += 1;
		if (beat % 2 === 0 && isVisible()) void write();
	}, PRESENCE_INTERVAL_MS / 2);

	const onVisibility = () => {
		if (isVisible()) void write();
	};
	// 離脱時は削除を試みる(完了を待てないので、取りこぼしても 90 秒で表示から消える)
	const onPageHide = () => void clear();
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pagehide', onPageHide);

	unsubscribe = listenPresence(
		db,
		pid,
		(entries) => {
			presenceStore.entries = entries;
			presenceStore.tick();
		},
		(error) => {
			if (!isPermissionDeniedError(error)) console.debug('Presence: listen failed:', error);
			unsubscribe?.();
			unsubscribe = null;
		}
	);

	void write();

	return {
		setScene(next) {
			if (next === sceneId) return;
			sceneId = next;
			// 位置は別のシーンのものなので捨てる(新しいシーンの位置は setCursor で改めて来る)
			cursorThrottle.markSent(null);
			void write();
		},
		setCursor(cursor) {
			if (stopped || denied || !sceneId) return;
			cursorThrottle.push(cursorEnabled() ? cursor : null);
		},
		async stop() {
			if (stopped) return;
			stopped = true;
			cursorThrottle.dispose();
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', onPageHide);
			unsubscribe?.();
			unsubscribe = null;
			presenceStore.reset();
			await withTimeout(clear(), CLEAR_TIMEOUT, '在席情報の削除').catch(() => undefined);
		}
	};
}
