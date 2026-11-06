import type { FirebaseConfig } from './settings';

/**
 * ゲスト接続。招待されたプロジェクトのホストの Firebase への接続情報(端末ごと。主 Firebase には同期しない)。
 * id は (ホストの Firebase, pid) から決まる安定した値(connectionIdOf)で、再参加で同じ接続を使い回す。
 */
export interface Connection {
	id: string;
	firebaseConfig: FirebaseConfig;
	pid: string;
	role: 'viewer' | 'editor';
	/** 招待リンクのプロジェクト名ヒント(任意) */
	name?: string;
	/** revoked: アクセス権が無効になった(同期しない)。再参加で active に戻る */
	status: 'active' | 'revoked';
	createdAt: number;
	lastSyncAt?: number;
}
