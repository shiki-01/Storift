import { getAuthInstanceSafe, isFirebaseInitialized } from './config';
import { isConnectionRegistered } from './connection';

/**
 * 共有プロジェクトの接続先(主 Firebase のサインイン、またはゲスト接続の登録)が使えるようになるまで待つ。
 * アプリの起動直後にエディタが開かれると、Firebase の初期化より先にシーンを開く処理が走るため、
 * 少しだけ待ってから接続する(オフラインのときは待たない。時間内に使えなければそのまま続ける)。
 */
export async function waitForTargetReady(
	sharing: { connectionId?: string } | undefined,
	timeoutMs = 5000
): Promise<void> {
	if (typeof navigator !== 'undefined' && !navigator.onLine) return;
	const connectionId = sharing?.connectionId;
	const ready = () =>
		connectionId
			? isConnectionRegistered(connectionId)
			: isFirebaseInitialized() && !!getAuthInstanceSafe()?.currentUser;
	const deadline = Date.now() + timeoutMs;
	while (!ready() && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
