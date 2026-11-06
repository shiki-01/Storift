import { settingsDB } from '$lib/db';
import { authStore } from '$lib/stores/auth.svelte';
import { getFirestoreInstanceSafe, isFirebaseInitialized } from '$lib/firebase/config';
import { detectAccessMode, runDiagnosticProbes, type DiagnosticItem } from '$lib/firebase/owner';
import {
	decodeSettingsCode,
	encodeSettingsCode,
	SETTINGS_CODE_ERROR_MESSAGES
} from '$lib/firebase/settingsCode';
import { applyAccessMode } from '$lib/services/sync.service';
import type { AccessMode, FirebaseConfig } from '$lib/types';

/**
 * アクセスモード(owner / legacy / needs-owner / unknown)の判定と永続化。
 * 判定は起動をブロックしないバックグラウンド処理で、結果は IndexedDB の設定にキャッシュする。
 */

/**
 * キャッシュ済みのモードを authStore に反映し、バックグラウンドで判定を始める。
 * サインイン完了後、initializeSync より前に呼ぶ(needs-owner のキャッシュがあれば同期を始めないため)。
 * 判定の完了は待たない。
 */
export async function initAccessMode(): Promise<void> {
	try {
		const settings = await settingsDB.get();
		if (authStore.accessMode === null && settings.accessMode) {
			authStore.accessMode = settings.accessMode;
		}
		applyAccessMode(authStore.accessMode);
	} catch (error) {
		console.warn('Failed to load cached access mode:', error);
	}
	void refreshAccessMode();
}

let inflight: Promise<AccessMode> | null = null;
let rerun = false;
let lastResult: AccessMode = 'unknown';

/**
 * アクセスモードを判定して反映する。実行中に再度呼ばれたら、実行中の判定の後にもう一度判定する。
 * 戻り値は今回の判定結果('unknown' のときは authStore のキャッシュ値を維持している)。
 */
export function refreshAccessMode(): Promise<AccessMode> {
	if (inflight) {
		rerun = true;
		return inflight;
	}
	const current: Promise<AccessMode> = (async () => {
		do {
			rerun = false;
			lastResult = await detectOnce();
		} while (rerun);
		return lastResult;
	})().finally(() => {
		if (inflight === current) inflight = null;
	});
	inflight = current;
	return current;
}

async function detectOnce(): Promise<AccessMode> {
	try {
		const db = getFirestoreInstanceSafe();
		const user = authStore.user;
		if (!db || !user) return 'unknown';

		const settings = await settingsDB.get();
		const result = await detectAccessMode(db, user.uid, settings.ownerKey);

		if (result.mode === 'unknown') {
			// ネットワークエラー等: キャッシュ値を維持する(無ければ unknown として扱う)
			if (authStore.accessMode === null) authStore.accessMode = 'unknown';
			return 'unknown';
		}

		const changes: { accessMode?: AccessMode; ownerKey?: string } = {};
		if (settings.accessMode !== result.mode) changes.accessMode = result.mode;
		if (result.ownerKey && result.ownerKey !== settings.ownerKey)
			changes.ownerKey = result.ownerKey;
		if (Object.keys(changes).length > 0) await settingsDB.update(changes);

		authStore.accessMode = result.mode;
		applyAccessMode(result.mode);
		return result.mode;
	} catch (error) {
		console.warn('Access mode detection failed:', error);
		return 'unknown';
	}
}

/** 保存済みの設定コード(オーナー鍵と Firebase 設定がそろっているときのみ) */
export async function getSettingsCode(): Promise<string | null> {
	const settings = await settingsDB.get();
	if (!settings.firebase || !settings.ownerKey) return null;
	return encodeSettingsCode(settings.firebase, settings.ownerKey);
}

const sameConfig = (a: FirebaseConfig | undefined, b: FirebaseConfig) =>
	!!a &&
	a.apiKey === b.apiKey &&
	a.authDomain === b.authDomain &&
	a.projectId === b.projectId &&
	a.storageBucket === b.storageBucket &&
	a.messagingSenderId === b.messagingSenderId &&
	a.appId === b.appId;

export type ApplySettingsCodeResult =
	| { ok: true; reloading: boolean }
	| { ok: false; message: string };

/**
 * 設定コードを適用する(設定画面の needs-owner 入力欄から)。
 * 設定値とオーナー鍵を保存して判定し直す。Firebase 設定が今の接続と違う場合は、
 * 接続をやり直すためにページを再読み込みする。
 */
export async function applySettingsCode(text: string): Promise<ApplySettingsCodeResult> {
	const decoded = decodeSettingsCode(text);
	if (!decoded.ok) return { ok: false, message: SETTINGS_CODE_ERROR_MESSAGES[decoded.error] };

	const previous = await settingsDB.get();
	const sameFirebase = sameConfig(previous.firebase, decoded.config);

	if (!sameFirebase || !isFirebaseInitialized()) {
		await settingsDB.update({
			firebase: decoded.config,
			ownerKey: decoded.ownerKey,
			accessMode: undefined,
			setupCompleted: true
		});
		if (typeof window !== 'undefined') window.location.reload();
		return { ok: true, reloading: true };
	}

	await settingsDB.update({ ownerKey: decoded.ownerKey });
	const mode = await refreshAccessMode();
	if (mode === 'owner') return { ok: true, reloading: false };

	// 登録できなかった: 保存した鍵を元に戻す
	await settingsDB.update({ ownerKey: previous.ownerKey });
	return {
		ok: false,
		message:
			mode === 'unknown'
				? 'サーバーに接続できませんでした。通信状態を確認してもう一度お試しください'
				: '設定コードが正しくないか、古くなっています。オーナー端末で最新の設定コードを確認してください'
	};
}

/** 診断(Firestore 到達性・匿名認証・ルール版・オーナー登録)。読み取りのみで、登録はしない */
export async function runAccessDiagnostics(): Promise<DiagnosticItem[]> {
	if (!isFirebaseInitialized()) {
		return [
			{
				id: 'reachability',
				label: 'Firestore への到達',
				status: 'unknown',
				detail: 'Firebase が設定されていません'
			}
		];
	}
	const db = getFirestoreInstanceSafe();
	if (!db) return [];
	return runDiagnosticProbes(db, authStore.user?.uid ?? null);
}
