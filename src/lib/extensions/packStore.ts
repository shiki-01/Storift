/**
 * インストール済みパックの保存先。
 *
 * メインの DB(Dexie `storift`)とは別の IndexedDB(`storift-extensions`)に保存する。
 * 同期(Firestore)・バックアップ・書き出しは、メインの DB の表だけを対象にしているので、
 * ここには一切含まれない(packStore.test.ts と、バックアップ・同期の対象に含まれないことのテストで担保)。
 */
import { createStore, del, entries, set, type UseStore } from 'idb-keyval';
import type { ExtensionManifest } from './manifest';

export const PACK_DB_NAME = 'storift-extensions';
export const PACK_STORE_NAME = 'packs';

/** 保存するパック 1 つ分 */
export interface InstalledPackRecord {
	id: string;
	manifest: ExtensionManifest;
	/** コンテンツ(パス → 解析済みの JSON)。読み込むたびに検証し直す */
	files: Record<string, unknown>;
	/** 入れた方法。registry はレジストリ(コミュニティ)、file は「ファイルから追加」(未審査) */
	origin: 'community' | 'personal-file';
	/** バンドル(JSON 文字列)の SHA-256。レジストリから入れたときだけ */
	sha256?: string;
	/** バンドルのバイト数 */
	size: number;
	installedAt: number;
}

let store: UseStore | null = null;

function getStore(): UseStore {
	store ??= createStore(PACK_DB_NAME, PACK_STORE_NAME);
	return store;
}

/** テスト用: 接続を作り直す */
export function resetPackStore(): void {
	store = null;
}

export async function listInstalledPacks(): Promise<InstalledPackRecord[]> {
	const all = await entries<string, InstalledPackRecord>(getStore());
	return all.map(([, record]) => record).sort((a, b) => a.installedAt - b.installedAt);
}

export async function saveInstalledPack(record: InstalledPackRecord): Promise<void> {
	await set(record.id, record, getStore());
}

export async function deleteInstalledPack(id: string): Promise<void> {
	await del(id, getStore());
}

/**
 * ブラウザに、保存先を勝手に消さないよう頼む(navigator.storage.persist)。
 * 断られても、対応していなくても、続行する(結果は返すだけ)
 */
export async function requestPersistence(): Promise<boolean> {
	try {
		if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
		if (await navigator.storage.persisted?.()) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}
