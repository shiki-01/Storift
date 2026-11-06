import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth, type User } from 'firebase/auth';
import {
	CACHE_SIZE_UNLIMITED,
	getFirestore,
	initializeFirestore,
	persistentLocalCache,
	type Firestore
} from 'firebase/firestore';
import type { Connection, FirebaseConfig } from '$lib/types';
import { registerConnectionDb, unregisterConnectionDb } from './sync';
import { connectEmulatorsIfConfigured } from './emulator';
import { connectionAppName } from './syncTarget';

/**
 * ゲスト接続の Firebase アプリ(ホストの Firebase)。主 Firebase とは別の名前付きアプリ(`storift-conn-<hash>`)で、
 * ホストごとに 1 つ。認証は匿名認証で、認証状態は IndexedDB に永続化されるため、オフライン起動でも維持される。
 * サインインは起動をブロックしない(利用側が必要なときに awaitConnectionReady で待つ)。
 */

export interface HostHandle {
	app: FirebaseApp;
	db: Firestore;
	auth: Auth;
	/** サインインの完了(失敗時は次の呼び出しで再試行できるよう null に戻す) */
	ready: Promise<User> | null;
}

const hosts = new Map<string, HostHandle>();
// connectionId → アプリ名
const connectionHosts = new Map<string, string>();

/** ホストの Firebase アプリを開く(同じホストなら同じアプリを返す) */
export function openHost(config: FirebaseConfig): HostHandle {
	const name = connectionAppName(config);
	const existingHandle = hosts.get(name);
	if (existingHandle) return existingHandle;

	const app = getApps().find((a) => a.name === name) ?? initializeApp(config, name);
	const auth = getAuth(app);
	let firestore: Firestore;
	try {
		firestore = initializeFirestore(app, {
			localCache: persistentLocalCache({ cacheSizeBytes: CACHE_SIZE_UNLIMITED })
		});
		// E2E 用: VITE_FIREBASE_EMULATOR が設定されているときだけエミュレータにつなぐ
		connectEmulatorsIfConfigured(auth, firestore);
	} catch {
		// 既に初期化済み(ホットリロードなど)
		firestore = getFirestore(app);
	}
	const handle: HostHandle = { app, db: firestore, auth, ready: null };
	hosts.set(name, handle);
	return handle;
}

/** 匿名でサインインする(認証状態の復元を待ち、既にサインイン済みならそのユーザーを返す)。同時呼び出しは 1 回にまとめる */
export function ensureSignedIn(handle: HostHandle): Promise<User> {
	if (!handle.ready) {
		const attempt = (async () => {
			await handle.auth.authStateReady();
			if (handle.auth.currentUser) return handle.auth.currentUser;
			return (await signInAnonymously(handle.auth)).user;
		})();
		handle.ready = attempt;
		attempt.catch(() => {
			if (handle.ready === attempt) handle.ready = null;
		});
	}
	return handle.ready;
}

/** 接続を登録する(Firestore を sync に登録し、サインインをバックグラウンドで始める。待たない) */
export function registerConnection(connection: Connection): HostHandle {
	const handle = openHost(connection.firebaseConfig);
	connectionHosts.set(connection.id, connectionAppName(connection.firebaseConfig));
	registerConnectionDb(connection.id, handle.db);
	ensureSignedIn(handle).catch((error) => {
		console.warn(`Guest connection sign-in failed (${connection.id}):`, error);
	});
	return handle;
}

export function unregisterConnection(connectionId: string): void {
	connectionHosts.delete(connectionId);
	unregisterConnectionDb(connectionId);
}

export function isConnectionRegistered(connectionId: string): boolean {
	return connectionHosts.has(connectionId);
}

export function hasRegisteredConnections(): boolean {
	return connectionHosts.size > 0;
}

function handleOf(connectionId: string): HostHandle | undefined {
	const name = connectionHosts.get(connectionId);
	return name ? hosts.get(name) : undefined;
}

/** その接続のサインイン完了を待つ。未登録・サインイン失敗(オフラインで新規サインインできない等)は例外 */
export async function awaitConnectionReady(connectionId: string): Promise<User> {
	const handle = handleOf(connectionId);
	if (!handle) throw new Error('ゲスト接続が登録されていません');
	return ensureSignedIn(handle);
}

/** サインイン済みのユーザーと、その接続の Firestore(退出など、接続に対する直接の操作用) */
export async function getConnectionSession(
	connectionId: string
): Promise<{ db: Firestore; uid: string }> {
	const handle = handleOf(connectionId);
	if (!handle) throw new Error('ゲスト接続が登録されていません');
	const user = await ensureSignedIn(handle);
	return { db: handle.db, uid: user.uid };
}
