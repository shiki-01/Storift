import { toast } from '$lib/stores/toast.svelte';
import { confirmDialog } from '$lib/stores/confirm.svelte';

interface DeleteWithUndoOptions {
	/** 確認ダイアログに表示する対象名（例: 「プロット『第一章』」） */
	targetLabel: string;
	/** 実際の削除処理（DB 削除・同期キュー登録・一覧再読み込み） */
	remove: () => Promise<void>;
	/** 取り消し処理（DB へ元のレコードを戻す・同期キュー登録・一覧再読み込み） */
	restore: () => Promise<void>;
}

/**
 * 確認ダイアログ → 削除 → 「元に戻す」付きトースト、までを行う。
 * 削除が行われたら true を返す。
 */
export async function deleteWithUndo(options: DeleteWithUndoOptions): Promise<boolean> {
	const ok = await confirmDialog({
		title: '削除の確認',
		message: `${options.targetLabel}を削除しますか?`,
		confirmText: '削除',
		danger: true
	});
	if (!ok) return false;

	try {
		await options.remove();
	} catch (error) {
		console.error('Failed to delete:', error);
		toast.error(`${options.targetLabel}の削除に失敗しました`);
		return false;
	}

	toast.success(`${options.targetLabel}を削除しました`, {
		action: {
			label: '元に戻す',
			onclick: async () => {
				try {
					await options.restore();
					toast.success('削除を取り消しました');
				} catch (error) {
					console.error('Failed to restore:', error);
					toast.error('取り消しに失敗しました');
				}
			}
		}
	});
	return true;
}
