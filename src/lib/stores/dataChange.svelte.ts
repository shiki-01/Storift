import type { EntityKind } from '$lib/desktop/entities';

/**
 * 画面の外(Claude の編集など)でデータベースの項目が書き換わったことを、開いている画面へ知らせる。
 * 各画面は revision(kind) を $effect で読み、変わったら読み込み直す。
 */
const revisions = $state<Record<string, number>>({});

export const dataChange = {
	/** その種類の項目が書き換わるたびに増える数 */
	revision(kind: EntityKind): number {
		return revisions[kind] ?? 0;
	},
	notify(...kinds: EntityKind[]) {
		for (const kind of kinds) revisions[kind] = (revisions[kind] ?? 0) + 1;
	}
};
