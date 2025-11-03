import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
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

export function initializeFirebase(config: FirebaseConfig): void {
	try {
		// 既に初期化されている場合はスキップ
		if (getApps().length > 0) {
			console.log('⚠️ Firebase already initialized');
			return;
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
