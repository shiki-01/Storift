/**
 * スクリプト拡張の端末内ストレージ。
 *
 * 拡張ごとの名前空間で、別の IndexedDB(`storift-extension-data`)に保存する。メインの DB(Dexie `storift`)・
 * パックの保存先(`storift-extensions`)とは別で、同期(Firestore)・バックアップ・書き出しには含まれない。
 * 拡張を削除したら消す(deleteExtensionData)。上限(SCRIPT_LIMITS)を超える書き込みは拒否する。
 */
import { createStore, del, get as idbGet, set as idbSet, type UseStore } from 'idb-keyval';
import { byteLength } from '../pack';
import { SCRIPT_LIMITS } from './limits';

export const SCRIPT_DATA_DB_NAME = 'storift-extension-data';
export const SCRIPT_DATA_STORE_NAME = 'data';

/** 保存先(拡張 ID → キーと値の対応。値は JSON 文字列)。テストでは差し替える */
export interface ScriptStorageBackend {
	read(id: string): Promise<Record<string, string> | undefined>;
	write(id: string, items: Record<string, string>): Promise<void>;
	remove(id: string): Promise<void>;
}

export class ScriptStorageError extends Error {
	constructor(
		message: string,
		readonly code: 'invalid' | 'quota'
	) {
		super(message);
		this.name = 'ScriptStorageError';
	}
}

let store: UseStore | null = null;
function getStore(): UseStore {
	store ??= createStore(SCRIPT_DATA_DB_NAME, SCRIPT_DATA_STORE_NAME);
	return store;
}

/** テスト用: 接続を作り直す */
export function resetScriptDataStore(): void {
	store = null;
}

export const idbBackend: ScriptStorageBackend = {
	read: (id) => idbGet<Record<string, string>>(id, getStore()),
	write: (id, items) => idbSet(id, items, getStore()),
	remove: (id) => del(id, getStore())
};

/** 拡張の端末内データをすべて消す(拡張を削除したとき) */
export async function deleteExtensionData(
	id: string,
	backend: ScriptStorageBackend = idbBackend
): Promise<void> {
	try {
		await backend.remove(id);
	} catch (error) {
		console.warn(`拡張機能 ${id} の端末内データを削除できませんでした:`, error);
	}
}

/** 使っているバイト数(キーと値の UTF-8 の長さの合計) */
export function usedBytes(items: Record<string, string>): number {
	let total = 0;
	for (const [key, value] of Object.entries(items)) total += byteLength(key) + byteLength(value);
	return total;
}

function checkKey(key: unknown): asserts key is string {
	if (
		typeof key !== 'string' ||
		key.length === 0 ||
		key.length > SCRIPT_LIMITS.storageKeyLength ||
		// eslint-disable-next-line no-control-regex
		/[\u0000-\u001f\u007f]/.test(key)
	) {
		throw new ScriptStorageError(
			`キーは 1 〜 ${SCRIPT_LIMITS.storageKeyLength} 文字の文字列で指定してください`,
			'invalid'
		);
	}
}

/**
 * 1 つの拡張のストレージ。読み書きは 1 つずつ順番に行う(同時の書き込みで上限を超えたり、値が失われたりしない)。
 * 値は JSON で表せるものだけ。JSON 文字列にして保存する
 */
export class ScriptStorage {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly id: string,
		private readonly backend: ScriptStorageBackend = idbBackend
	) {}

	private run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.queue.then(task, task);
		this.queue = result.catch(() => undefined);
		return result;
	}

	private async load(): Promise<Record<string, string>> {
		const items = await this.backend.read(this.id);
		// 保存先が壊れていても、文字列の値だけを拾う
		const clean: Record<string, string> = Object.create(null);
		if (items && typeof items === 'object') {
			for (const [key, value] of Object.entries(items)) {
				if (typeof value === 'string') clean[key] = value;
			}
		}
		return clean;
	}

	async get(key: unknown): Promise<unknown> {
		checkKey(key);
		return this.run(async () => {
			const raw = (await this.load())[key];
			if (raw === undefined) return null;
			try {
				return JSON.parse(raw) as unknown;
			} catch {
				return null;
			}
		});
	}

	async set(key: unknown, value: unknown): Promise<void> {
		checkKey(key);
		let json: string | undefined;
		try {
			json = JSON.stringify(value);
		} catch {
			json = undefined;
		}
		if (json === undefined) {
			throw new ScriptStorageError('値は JSON で表せるものだけ保存できます', 'invalid');
		}
		if (byteLength(json) > SCRIPT_LIMITS.storageValueBytes) {
			throw new ScriptStorageError(
				`値は ${Math.round(SCRIPT_LIMITS.storageValueBytes / 1024)}KB までです`,
				'quota'
			);
		}
		return this.run(async () => {
			const items = await this.load();
			const isNew = !(key in items);
			if (isNew && Object.keys(items).length >= SCRIPT_LIMITS.storageKeys) {
				throw new ScriptStorageError(`キーは ${SCRIPT_LIMITS.storageKeys} 個までです`, 'quota');
			}
			const next = { ...items, [key]: json };
			if (usedBytes(next) > SCRIPT_LIMITS.storageTotalBytes) {
				throw new ScriptStorageError(
					`保存できる合計は ${Math.round(SCRIPT_LIMITS.storageTotalBytes / 1024)}KB までです`,
					'quota'
				);
			}
			await this.backend.write(this.id, next);
		});
	}

	async delete(key: unknown): Promise<void> {
		checkKey(key);
		return this.run(async () => {
			const items = await this.load();
			if (!(key in items)) return;
			delete items[key];
			await this.backend.write(this.id, { ...items });
		});
	}

	async list(prefix: unknown = ''): Promise<string[]> {
		if (typeof prefix !== 'string' || prefix.length > SCRIPT_LIMITS.storageKeyLength) {
			throw new ScriptStorageError('prefix は文字列で指定してください', 'invalid');
		}
		return this.run(async () =>
			Object.keys(await this.load())
				.filter((key) => key.startsWith(prefix))
				.sort()
		);
	}
}
