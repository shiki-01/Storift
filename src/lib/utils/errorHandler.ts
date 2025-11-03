/**
 * グローバルエラーハンドラー
 */

interface ErrorLog {
	timestamp: number;
	type: string;
	message: string;
	stack?: string;
	url?: string;
	userAgent?: string;
}

const MAX_ERROR_LOGS = 50;
const ERROR_LOGS_KEY = 'storift_error_logs';

/**
 * エラーログを保存
 */
function saveErrorLog(error: ErrorLog): void {
	try {
		const logs = getErrorLogs();
		logs.unshift(error);
		
		// 最大件数を超えたら古いものを削除
		if (logs.length > MAX_ERROR_LOGS) {
			logs.splice(MAX_ERROR_LOGS);
		}
		
		localStorage.setItem(ERROR_LOGS_KEY, JSON.stringify(logs));
	} catch (e) {
		console.error('Failed to save error log:', e);
	}
}

/**
 * エラーログを取得
 */
export function getErrorLogs(): ErrorLog[] {
	try {
		const logs = localStorage.getItem(ERROR_LOGS_KEY);
		return logs ? JSON.parse(logs) : [];
	} catch (e) {
		return [];
	}
}

/**
 * エラーログをクリア
 */
export function clearErrorLogs(): void {
	try {
		localStorage.removeItem(ERROR_LOGS_KEY);
	} catch (e) {
		console.error('Failed to clear error logs:', e);
	}
}

/**
 * グローバルエラーハンドラーを初期化
 */
export function initializeErrorHandler(): void {
	// 未処理のエラーをキャッチ
	window.addEventListener('error', (event) => {
		console.error('Uncaught error:', event.error);
		
		saveErrorLog({
			timestamp: Date.now(),
			type: 'error',
			message: event.error?.message || event.message || 'Unknown error',
			stack: event.error?.stack,
			url: window.location.href,
			userAgent: navigator.userAgent
		});
		
		// エラーをユーザーに通知(オプション)
		if (import.meta.env.DEV) {
			alert(`エラーが発生しました: ${event.error?.message || event.message}`);
		}
	});

	// 未処理のPromise拒否をキャッチ
	window.addEventListener('unhandledrejection', (event) => {
		console.error('Unhandled rejection:', event.reason);
		
		saveErrorLog({
			timestamp: Date.now(),
			type: 'unhandledrejection',
			message: event.reason?.message || String(event.reason) || 'Unknown rejection',
			stack: event.reason?.stack,
			url: window.location.href,
			userAgent: navigator.userAgent
		});
		
		// エラーをユーザーに通知(オプション)
		if (import.meta.env.DEV) {
			alert(`Promise拒否: ${event.reason?.message || String(event.reason)}`);
		}
	});

	console.log('✅ Global error handler initialized');
}

/**
 * エラーを手動で記録
 */
export function logError(error: Error | string, type: string = 'manual'): void {
	const errorMessage = typeof error === 'string' ? error : error.message;
	const errorStack = typeof error === 'string' ? undefined : error.stack;
	
	saveErrorLog({
		timestamp: Date.now(),
		type,
		message: errorMessage,
		stack: errorStack,
		url: window.location.href,
		userAgent: navigator.userAgent
	});
}

/**
 * エラーログをエクスポート
 */
export function exportErrorLogs(): string {
	const logs = getErrorLogs();
	return JSON.stringify(logs, null, 2);
}
