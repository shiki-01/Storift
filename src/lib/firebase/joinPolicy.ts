import type { AccessMode, FirebaseConfig } from '$lib/types';
import { isSameFirebase } from './syncTarget';

/**
 * 参加フローの判断(純粋関数)。Firestore には触れない。
 */

// ---------- 参加の経路 ----------

export type JoinRoute =
	/** 主 Firebase と同じで、この端末がオーナー。通常の同期でプロジェクトを開ける(参加しない) */
	| { kind: 'owner-device' }
	/** 主 Firebase と同じだが旧ルール。共有に必要な新ルールが未適用なので止める */
	| { kind: 'legacy-rules' }
	/** 主 Firebase と同じだがアクセス状態が判定できていない。誤ってオーナー端末に参加しないよう止める */
	| { kind: 'unknown-access' }
	/** 主 Firebase と同じで、オーナーではない端末。主 Firebase のインスタンスをゲストとして使う(connectionId なし) */
	| { kind: 'primary-guest' }
	/** 主 Firebase とは別(または主 Firebase 未設定)。名前付きアプリでホストへ接続する */
	| { kind: 'connection' };

export function decideJoinRoute(
	primary: Pick<FirebaseConfig, 'apiKey' | 'projectId'> | undefined,
	invite: Pick<FirebaseConfig, 'apiKey' | 'projectId'>,
	accessMode: AccessMode | null
): JoinRoute {
	if (!primary || !isSameFirebase(primary, invite)) return { kind: 'connection' };
	switch (accessMode) {
		case 'owner':
			return { kind: 'owner-device' };
		case 'legacy':
			return { kind: 'legacy-rules' };
		case 'needs-owner':
			return { kind: 'primary-guest' };
		default:
			return { kind: 'unknown-access' };
	}
}

export const ROUTE_BLOCK_MESSAGES = {
	'owner-device': 'この Firebase のオーナー端末です。プロジェクトは通常の同期で開けます',
	'legacy-rules':
		'この Firebase には、共有機能に必要な新しいルールが適用されていません。ルールを更新してから、もう一度お試しください',
	'unknown-access':
		'この端末の Firebase へのアクセス状態を確認できませんでした。通信状態を確認して、もう一度お試しください'
} as const;

/** ローカルに同じ ID のプロジェクトがあるとき、参加(再利用)してよいか */
export type LocalConflict = 'own-project' | 'plain-project' | null;

export function checkLocalProject(
	existing:
		| { sharing?: { role: 'owner' | 'editor' | 'viewer'; pid: string }; localOnly?: boolean }
		| undefined
): LocalConflict {
	if (!existing) return null;
	if (existing.sharing) return existing.sharing.role === 'owner' ? 'own-project' : null;
	// 退出してローカル専用にしたコピーは再参加で再利用できる。通常のプロジェクトは混ぜない
	return existing.localOnly ? null : 'plain-project';
}

export const LOCAL_CONFLICT_MESSAGES = {
	'own-project': 'このプロジェクトは、この端末でオーナーとして共有しているものです。参加は不要です',
	'plain-project':
		'同じ ID の通常のプロジェクトがこの端末に既にあるため、参加できません(データを混ぜないための制限です)'
} as const;

// ---------- エラーの分類 ----------

export type JoinStage = 'signin' | 'member' | 'fetch';

export type JoinFailureCode =
	| 'denied'
	| 'legacy-rules'
	| 'offline'
	| 'auth-disabled'
	| 'unauthorized-domain'
	| 'signin-failed'
	| 'quota'
	| 'project-missing'
	| 'unknown';

export interface JoinFailure {
	code: JoinFailureCode;
	message: string;
}

/** 'permission-denied' / 'auth/operation-not-allowed' など。無ければ空文字 */
export function errorCodeOf(error: unknown): string {
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? (error as { code?: unknown }).code
			: undefined;
	if (typeof code !== 'string') return '';
	const lower = code.toLowerCase();
	// Firestore は 'permission-denied'、Auth は 'auth/...'。Firestore の 'firestore/xxx' 形式は接頭辞を外す
	return lower.startsWith('firestore/') ? lower.slice('firestore/'.length) : lower;
}

const OFFLINE_CODES = new Set([
	'unavailable',
	'deadline-exceeded',
	'auth/network-request-failed',
	'auth/timeout'
]);

/**
 * 参加中のエラーを、ユーザー向けの日本語メッセージに分類する。
 * permission-denied の原因は (秘密の不一致 / 無効な招待 / pid 不存在 / 旧ルール) のどれも区別できないので、
 * member 段階では legacyRules(呼び出し側が旧ルールを判別できたか)で文言を分ける。
 */
export function classifyJoinError(
	error: unknown,
	stage: JoinStage,
	options: { legacyRules?: boolean; passwordInvite?: boolean } = {}
): JoinFailure {
	const code = errorCodeOf(error);

	if (OFFLINE_CODES.has(code)) {
		return {
			code: 'offline',
			message:
				'ホストの Firebase に接続できませんでした。通信状態を確認して、もう一度お試しください'
		};
	}
	if (code === 'resource-exhausted') {
		return {
			code: 'quota',
			message:
				'ホストの Firebase の利用上限(無料枠)に達している可能性があります。しばらくしてからお試しください'
		};
	}

	if (stage === 'signin') {
		if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
			return {
				code: 'auth-disabled',
				message:
					'ホストの Firebase で匿名認証が有効になっていません。プロジェクトの持ち主に確認してください'
			};
		}
		if (code === 'auth/unauthorized-domain' || code === 'auth/requests-from-referer-blocked') {
			return {
				code: 'unauthorized-domain',
				message:
					'このアプリのドメインが、ホストの Firebase の承認済みドメインに登録されていません。プロジェクトの持ち主に確認してください'
			};
		}
		if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid') {
			return {
				code: 'signin-failed',
				message:
					'招待リンクの Firebase 設定が正しくありません。リンクを発行し直してもらってください'
			};
		}
		return { code: 'signin-failed', message: 'ホストの Firebase にサインインできませんでした' };
	}

	if (code === 'permission-denied' || code === 'unauthenticated') {
		if (stage === 'member') {
			if (options.legacyRules) {
				return {
					code: 'legacy-rules',
					message:
						'ホストの Firebase に、共有機能に必要な新しいルールが適用されていない可能性があります。プロジェクトの持ち主に確認してください'
				};
			}
			return {
				code: 'denied',
				message: options.passwordInvite
					? 'パスワードが違う、または招待が無効です(共有が停止された、秘密が再生成された可能性もあります)'
					: '招待が無効です(共有が停止された、リンクが再発行された、またはプロジェクトが存在しない可能性があります)'
			};
		}
		return {
			code: 'denied',
			message: 'このプロジェクトを読み取る権限がありません。招待が無効になった可能性があります'
		};
	}

	return {
		code: 'unknown',
		message: `参加に失敗しました${error instanceof Error && error.message ? `(${error.message})` : ''}`
	};
}

/** 同期中に権限エラーを検知したか(失効の判断に使う) */
export function isPermissionDeniedError(error: unknown): boolean {
	return errorCodeOf(error) === 'permission-denied';
}
