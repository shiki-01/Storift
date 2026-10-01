import type { ConflictData } from '$lib/firebase/conflict';

export interface ConflictEntry {
	type: string;
	id: string;
	/** 一覧表示用の名前（タイトル・名前など） */
	label: string;
	conflictData: ConflictData<any>;
}

/**
 * 手動解決待ちの競合（UI 用のリアクティブな写し）
 * 実体は sync.service の pendingConflicts で、変更のたびにここへ反映される
 */
class ConflictStore {
	items = $state<ConflictEntry[]>([]);
	isOpen = $state(false);

	get count() {
		return this.items.length;
	}

	open() {
		if (this.items.length > 0) this.isOpen = true;
	}

	close() {
		this.isOpen = false;
	}
}

export const conflictStore = new ConflictStore();
