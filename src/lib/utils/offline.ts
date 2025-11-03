/**
 * オフライン状態の検知と管理
 */

export type NetworkStatus = 'online' | 'offline' | 'slow';

let currentStatus: NetworkStatus = navigator.onLine ? 'online' : 'offline';
let listeners: ((status: NetworkStatus) => void)[] = [];

/**
 * ネットワーク状態の監視を開始
 */
export function startNetworkMonitoring(): void {
	window.addEventListener('online', handleOnline);
	window.addEventListener('offline', handleOffline);

	// 定期的な接続チェック（オプション）
	setInterval(checkConnection, 30000); // 30秒ごと
}

/**
 * ネットワーク状態の監視を停止
 */
export function stopNetworkMonitoring(): void {
	window.removeEventListener('online', handleOnline);
	window.removeEventListener('offline', handleOffline);
}

/**
 * 現在のネットワーク状態を取得
 */
export function getNetworkStatus(): NetworkStatus {
	return currentStatus;
}

/**
 * ネットワーク状態の変更を監視
 */
export function onNetworkStatusChange(listener: (status: NetworkStatus) => void): () => void {
	listeners.push(listener);
	// 初回呼び出し
	listener(currentStatus);
	// クリーンアップ関数を返す
	return () => {
		listeners = listeners.filter((l) => l !== listener);
	};
}

const handleOnline = () => {
	updateStatus('online');
}

const handleOffline = () => {
	updateStatus('offline');
}

function updateStatus(status: NetworkStatus) {
	if (currentStatus !== status) {
		currentStatus = status;
		notifyListeners();
	}
}

const notifyListeners = () => {
	listeners.forEach((listener) => listener(currentStatus));
}

/**
 * 接続速度をチェック（簡易版）
 */
const checkConnection = async() => {
	if (!navigator.onLine) {
		updateStatus('offline');
		return;
	}

	try {
		const start = Date.now();
		const response = await fetch('/favicon.svg', { method: 'HEAD', cache: 'no-cache' });
		const duration = Date.now() - start;

		if (response.ok) {
			// 500ms以上かかる場合は低速と判断
			updateStatus(duration > 500 ? 'slow' : 'online');
		} else {
			updateStatus('offline');
		}
	} catch {
		updateStatus('offline');
	}
}
