import { connectAuthEmulator, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore';

/**
 * Firebase Emulator への接続(E2E テスト用)。
 * ビルド時の環境変数 VITE_FIREBASE_EMULATOR が設定されているときだけ有効で、
 * 本番ビルドなど未設定のときは何もしない。形式は `<firestoreのhost:port>,<authのhost:port>`
 * (例: `127.0.0.1:8080,127.0.0.1:9099`)。
 */

export interface EmulatorEndpoints {
	firestore: { host: string; port: number };
	auth: { host: string; port: number };
}

function parseHostPort(text: string): { host: string; port: number } | null {
	const match = /^([^:\s]+):(\d{1,5})$/.exec(text.trim());
	if (!match) return null;
	const port = Number(match[2]);
	return port > 0 && port < 65536 ? { host: match[1], port } : null;
}

/** `<firestore>,<auth>` を読む。未設定・形式が違うときは null */
export function parseEmulatorEnv(value: string | undefined): EmulatorEndpoints | null {
	if (!value) return null;
	const [firestoreText, authText] = value.split(',');
	const firestore = parseHostPort(firestoreText ?? '');
	const auth = parseHostPort(authText ?? '');
	return firestore && auth ? { firestore, auth } : null;
}

/** 環境変数が設定されていれば、この Auth / Firestore をエミュレータにつなぐ。設定が無ければ何もしない */
export function connectEmulatorsIfConfigured(auth: Auth, firestore: Firestore): void {
	const endpoints = parseEmulatorEnv(import.meta.env.VITE_FIREBASE_EMULATOR);
	if (!endpoints) return;
	try {
		connectAuthEmulator(auth, `http://${endpoints.auth.host}:${endpoints.auth.port}`, {
			disableWarnings: true
		});
		connectFirestoreEmulator(firestore, endpoints.firestore.host, endpoints.firestore.port);
	} catch (error) {
		// 既に接続済み(ホットリロードなど)
		console.warn('Firebase emulator connection skipped:', error);
	}
}
