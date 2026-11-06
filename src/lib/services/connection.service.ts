import { connectionsDB } from '$lib/db';
import { registerConnection } from '$lib/firebase/connection';
import { syncStore } from '$lib/stores/sync.svelte';

/**
 * ゲスト接続の復元。起動時にバックグラウンドで、保存済みの接続ごとに Firebase アプリを初期化して sync に登録する。
 * サインインは非ブロッキング(失敗しても起動を妨げない)。失効(revoked)した接続は登録せず、同期しない。
 */
export async function initConnections(): Promise<number> {
	try {
		const connections = (await connectionsDB.getAll()).filter((c) => c.status === 'active');
		let registered = 0;
		for (const connection of connections) {
			try {
				registerConnection(connection);
				registered++;
			} catch (error) {
				// 設定が壊れているなど。他の接続や起動は続ける
				console.warn(`Failed to restore guest connection (${connection.id}):`, error);
			}
		}
		// ゲストの同期が動くので、同期の有無の表示を有効にする
		if (registered > 0) syncStore.isConfigured = true;
		return registered;
	} catch (error) {
		console.warn('Failed to load guest connections:', error);
		return 0;
	}
}
