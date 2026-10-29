import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import {
	initializeFirestore,
	type Firestore,
	persistentLocalCache,
	CACHE_SIZE_UNLIMITED
} from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import type { FirebaseConfig } from '$lib/types';

let app: FirebaseApp | null = null;
let firestore: Firestore | null = null;
let auth: Auth | null = null;

function sameConfig(a: Partial<FirebaseConfig>, b: FirebaseConfig): boolean {
	return (Object.keys(b) as (keyof FirebaseConfig)[]).every((key) => a[key] === b[key]);
}

/**
 * Firebase を初期化する。同じ設定で初期化済みなら何もしない。
 * 別の設定で初期化済みのとき(セットアップ画面で入力を直して再テストした場合など)は作り直す
 */
export async function initializeFirebase(config: FirebaseConfig): Promise<void> {
	try {
		const existing = getApps()[0];
		if (existing) {
			if (sameConfig(existing.options as Partial<FirebaseConfig>, config) && firestore && auth) {
				return;
			}
			await deleteApp(existing);
			app = null;
			firestore = null;
			auth = null;
		}

		app = initializeApp(config);
		auth = getAuth(app);

		// オフライン永続化を有効化
		firestore = initializeFirestore(app, {
			localCache: persistentLocalCache({
				cacheSizeBytes: CACHE_SIZE_UNLIMITED
			})
		});

		console.log('✅ Firebase initialized successfully');
	} catch (error) {
		console.error('❌ Firebase initialization error:', error);
		throw error;
	}
}

export function getFirebaseApp(): FirebaseApp {
	if (!app) {
		throw new Error('Firebase not initialized. Call initializeFirebase first.');
	}
	return app;
}

export function getFirestoreInstance(): Firestore {
	if (!firestore) {
		throw new Error('Firestore not initialized. Call initializeFirebase first.');
	}
	return firestore;
}

export function getAuthInstance(): Auth {
	if (!auth) {
		throw new Error('Auth not initialized. Call initializeFirebase first.');
	}
	return auth;
}

export function isFirebaseInitialized(): boolean {
	return app !== null && firestore !== null && auth !== null;
}

// 安全なゲッター（nullを返す）
export function getAuthInstanceSafe(): Auth | null {
	return auth;
}

export function getFirestoreInstanceSafe(): Firestore | null {
	return firestore;
}
