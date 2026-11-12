/**
 * Monolog. 連携の共有状態と、接続・解除の操作。
 * 設定画面・コールバックのページ・拡張本体が同じトークン管理とクライアントを使う。
 */
import { isDesktop } from '$lib/desktop/platform';
import { ApiError, MonologClient } from './client';
import { DESKTOP_REDIRECT_URI, isConnectAvailable } from './config';
import {
	NetworkError,
	beginAuthorization,
	clearPending,
	describeAuthError,
	exchangeCode,
	parseCallback,
	takePending
} from './oauth';
import {
	ReauthRequiredError,
	TokenManager,
	createTokenStorage,
	readNeedsReauth,
	setNeedsReauth
} from './tokens';

export type ConnectionStatus =
	/** まだ確認していない */
	| 'unknown'
	| 'checking'
	| 'connected'
	| 'disconnected'
	/** リフレッシュトークンが無効になった。再接続が必要 */
	| 'reauth'
	/** トークンはあるが、いま確認できない(オフラインなど) */
	| 'unreachable';

export const monologState = $state<{ connection: ConnectionStatus; sessionActive: boolean }>({
	connection: 'unknown',
	sessionActive: false
});

export const monologTokens = new TokenManager({ storage: createTokenStorage(isDesktop()) });
export const monologClient = new MonologClient({ tokens: monologTokens });

monologTokens.onReauthRequired = () => {
	monologState.connection = 'reauth';
};

/** この環境で連携を始められるか(本番のオリジン、またはデスクトップ版) */
export function canConnectHere(): boolean {
	return isConnectAvailable(
		isDesktop(),
		typeof location === 'undefined' ? undefined : location.origin
	);
}

/** GET /me で接続を確認して、状態を更新する */
export async function refreshConnection(): Promise<ConnectionStatus> {
	monologState.connection = 'checking';
	try {
		const tokens = await monologTokens.load();
		if (!tokens) {
			monologState.connection = readNeedsReauth() ? 'reauth' : 'disconnected';
			return monologState.connection;
		}
		await monologClient.getMe();
		monologState.connection = 'connected';
	} catch (error) {
		if (error instanceof ReauthRequiredError) monologState.connection = 'reauth';
		else if (error instanceof ApiError && error.status === 401) monologState.connection = 'reauth';
		else if (error instanceof NetworkError) monologState.connection = 'unreachable';
		else {
			console.warn('Monolog. の接続を確認できませんでした:', error);
			monologState.connection = 'unreachable';
		}
	}
	return monologState.connection;
}

/** 接続を開始する。Web は認可ページへ移動し、デスクトップはシステムブラウザで開く */
export async function startConnect(): Promise<void> {
	const desktop = isDesktop();
	const url = await beginAuthorization(desktop);
	if (desktop) {
		const { openUrl } = await import('@tauri-apps/plugin-opener');
		await openUrl(url);
	} else {
		location.assign(url);
	}
}

/** 認可の戻りを処理できなかった理由 */
export class AuthFlowError extends Error {
	constructor(
		readonly kind: 'no-pending' | 'failed',
		message: string
	) {
		super(message);
		this.name = 'AuthFlowError';
	}
}

/**
 * 認可の戻り(Web のコールバック URL / デスクトップの storift:// URL)を処理する。
 * state を検証し、認可コードをトークンに交換して保存する。
 * 認可コードは 1 回限りなので、失敗しても再送しない(接続をやり直す)。途中状態は必ず消す
 */
export async function completeAuthorization(callbackUrl: string): Promise<void> {
	const pending = takePending();
	if (!pending) {
		throw new AuthFlowError(
			'no-pending',
			'接続の手続きが見つかりません。設定からもう一度接続してください'
		);
	}
	const parsed = parseCallback(callbackUrl);
	if (!parsed) throw new AuthFlowError('failed', 'Monolog. からの応答が正しくありません');
	if (parsed.kind === 'error') {
		throw new AuthFlowError('failed', describeAuthError(parsed.error, parsed.description));
	}
	if (parsed.state !== pending.state) {
		throw new AuthFlowError('failed', '接続の確認に失敗しました。もう一度接続してください');
	}
	try {
		const tokens = await exchangeCode({
			code: parsed.code,
			verifier: pending.verifier,
			redirectUri: pending.redirectUri
		});
		await monologTokens.setTokens(tokens);
	} catch (error) {
		console.error('Monolog. のトークン交換に失敗しました:', error);
		throw new AuthFlowError('failed', '接続に失敗しました。もう一度接続してください');
	}
	setNeedsReauth(false);
	await refreshConnection();
}

/** デスクトップの deep link として受け取った URL が、Monolog. のコールバックか */
export function isDesktopCallback(url: string): boolean {
	return url.startsWith(DESKTOP_REDIRECT_URI);
}

/** 連携の解除。トークンを失効させ(失敗しても)端末内から消す */
export async function disconnect(): Promise<{ revoked: boolean }> {
	clearPending();
	const result = await monologTokens.disconnect();
	monologState.connection = 'disconnected';
	return result;
}
