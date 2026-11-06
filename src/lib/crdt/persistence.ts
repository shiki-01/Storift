import { db } from '$lib/db/schema';
import type { CrdtDocRow } from '$lib/types';

/**
 * crdtDocs テーブルの読み書き。doc.ts はこのインターフェースだけに依存する(テストでは差し替える)。
 */
export interface CrdtPersistence {
	load(sceneId: string): Promise<CrdtDocRow | undefined>;
	save(row: CrdtDocRow): Promise<void>;
	remove(sceneId: string): Promise<void>;
	/** 未送信の更新が残っている行(オフラインで編集して閉じたシーンの再送に使う) */
	listWithPending(): Promise<CrdtDocRow[]>;
}

export const dexiePersistence: CrdtPersistence = {
	load: (sceneId) => db.crdtDocs.get(sceneId),
	async save(row) {
		await db.crdtDocs.put(row);
	},
	async remove(sceneId) {
		await db.crdtDocs.delete(sceneId);
	},
	async listWithPending() {
		return (await db.crdtDocs.toArray()).filter((r) => r.pending !== null);
	}
};

/**
 * 指定ターゲットで CRDT が有効なシーン ID の集合(reconcile が content を比較対象から外すために使う)。
 * targetKey が違う行は数えない(共有の停止・付け替えのあとに古い行が content を固定し続けないため)。
 */
export async function crdtSceneIdsIn(ids: string[], targetKey: string): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const rows = await db.crdtDocs.bulkGet(ids);
	const result = new Set<string>();
	for (const row of rows) if (row && row.targetKey === targetKey) result.add(row.sceneId);
	return result;
}
