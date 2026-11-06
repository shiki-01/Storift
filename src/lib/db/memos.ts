import { db } from './schema';
import type { Memo } from '$lib/types';
import { legacyProjectId, parseLegacyMemos } from '$lib/utils/memos';

export type MemoInput = Pick<Memo, 'projectId' | 'text' | 'tags'> &
	Partial<Pick<Memo, 'sceneId' | 'anchor' | 'done'>>;

/** Svelte のリアクティブなプロキシを IndexedDB へ渡せないため、プレーンな値にする */
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

/**
 * 旧 localStorage のメモ(storift:memos:<作品ID>)を取り込み、取り込んだキーを消す。
 * bulkPut なので途中で失敗しても、次回に同じ ID で取り込み直せる。
 */
async function importLegacy(): Promise<void> {
	if (typeof localStorage === 'undefined') return;
	const keys: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && legacyProjectId(key)) keys.push(key);
	}
	for (const key of keys) {
		const projectId = legacyProjectId(key);
		const raw = localStorage.getItem(key);
		if (!projectId || raw === null) continue;
		try {
			const memos = parseLegacyMemos(raw, projectId);
			if (memos.length) await db.memos.bulkPut(memos);
			localStorage.removeItem(key);
		} catch (error) {
			console.error('Failed to import legacy memos:', error);
		}
	}
}

export const memosDB = {
	/** 作品のメモ(新しい順)。旧形式が残っていれば先に取り込む */
	async getByProject(projectId: string): Promise<Memo[]> {
		await importLegacy();
		const memos = await db.memos.where('projectId').equals(projectId).toArray();
		return memos.sort((a, b) => b.createdAt - a.createdAt);
	},

	/** 全作品のメモ(AI 用のワークスペースを書き出すときに使う) */
	async getAll(): Promise<Memo[]> {
		await importLegacy();
		return db.memos.toArray();
	},

	async create(input: MemoInput): Promise<Memo> {
		const now = Date.now();
		const memo: Memo = plain({
			id: crypto.randomUUID(),
			done: false,
			...input,
			createdAt: now,
			updatedAt: now
		});
		await db.memos.add(memo);
		return memo;
	},

	async update(
		id: string,
		changes: Partial<Omit<Memo, 'id' | 'projectId' | 'createdAt'>>
	): Promise<void> {
		await db.memos.update(id, plain({ ...changes, updatedAt: Date.now() }));
	},

	async delete(id: string): Promise<void> {
		await db.memos.delete(id);
	}
};
