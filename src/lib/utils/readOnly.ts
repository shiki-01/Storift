import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { projectsStore } from '$lib/stores/projects.svelte';
import { isReadOnlySharing, isRevokedSharing } from '$lib/firebase/syncTarget';
import type { ContextMenuItem } from '$lib/utils/contextMenu';
import type { Project } from '$lib/types';

/**
 * 読み取り専用のプロジェクト(閲覧権限で参加したもの、またはアクセス権が無効になったもの)。
 * UI の編集の入口(本文・章/シーン・人物・プロット・世界観)をこれで無効化する。
 * 同期層にも安全網がある(読み取り専用は何も送信せず、取得ではリモートが勝つ)ので、
 * UI で止め損ねても共有側とは食い違わない。$derived / テンプレート内で使うとリアクティブに追従する。
 */
function projectOf(projectId: string): Project | undefined {
	const current = currentProjectStore.project;
	if (current?.id === projectId) return current;
	return projectsStore.projects.find((p) => p.id === projectId);
}

export function isReadOnlyProject(projectId: string | null | undefined): boolean {
	if (!projectId) return false;
	return isReadOnlySharing(projectOf(projectId)?.sharing);
}

export type ReadOnlyReason = 'viewer' | 'revoked' | null;

export function readOnlyReason(projectId: string | null | undefined): ReadOnlyReason {
	if (!projectId) return null;
	const sharing = projectOf(projectId)?.sharing;
	if (!isReadOnlySharing(sharing)) return null;
	return isRevokedSharing(sharing) ? 'revoked' : 'viewer';
}

// 読み取り専用でも使える右クリックメニューの項目(コピー・選択・開く・書き出しなど、内容を変えないもの)
const READ_ONLY_MENU_LABELS = new Set([
	'開く',
	'編集',
	'コピー',
	'すべて選択',
	'エクスポート',
	'印刷プレビュー',
	'関係性を表示'
]);

/** 右クリックメニューから、内容を変える項目を取り除く(区切り線は前後が重ならないよう整える) */
export function filterReadOnlyMenu(items: ContextMenuItem[]): ContextMenuItem[] {
	const kept = items.filter((item) => item.divider || READ_ONLY_MENU_LABELS.has(item.label));
	const out: ContextMenuItem[] = [];
	for (const item of kept) {
		if (item.divider && (out.length === 0 || out[out.length - 1].divider)) continue;
		out.push(item);
	}
	while (out.length > 0 && out[out.length - 1].divider) out.pop();
	return out;
}
