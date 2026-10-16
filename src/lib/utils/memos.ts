/**
 * 執筆中のネタ帳(メモ)。端末ごとに localStorage へ保存する(同期対象外)。
 */
export interface Memo {
	id: string;
	text: string;
	createdAt: number;
}

const key = (projectId: string) => `storift:memos:${projectId}`;

export function loadMemos(projectId: string, storage: Storage | undefined = safeStorage()): Memo[] {
	try {
		const raw = storage?.getItem(key(projectId));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isMemo) : [];
	} catch {
		return [];
	}
}

export function saveMemos(
	projectId: string,
	memos: Memo[],
	storage: Storage | undefined = safeStorage()
): void {
	try {
		storage?.setItem(key(projectId), JSON.stringify(memos));
	} catch {
		// 容量超過などは無視(メモは補助機能)
	}
}

export function addMemo(memos: Memo[], text: string, now = Date.now()): Memo[] {
	const trimmed = text.trim();
	if (!trimmed) return memos;
	return [{ id: `${now}-${memos.length}`, text: trimmed, createdAt: now }, ...memos];
}

export function removeMemo(memos: Memo[], id: string): Memo[] {
	return memos.filter((m) => m.id !== id);
}

function isMemo(value: unknown): value is Memo {
	const m = value as Memo;
	return !!m && typeof m.id === 'string' && typeof m.text === 'string';
}

function safeStorage(): Storage | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		return undefined;
	}
}
