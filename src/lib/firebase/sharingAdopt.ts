import type { ProjectSharing } from '$lib/types/project';

/**
 * 最上位のポインタ文書の sharing を、ローカルのプロジェクトに取り込むかの判定(純粋関数)。
 *
 * sharing は共有の開始・停止などの専用の処理だけがリモートへ書く。通常のアップロードは sharing を送らないので、
 * updatedAt が同じでも sharing だけが食い違うことがある(他端末が共有を始めた/止めた)。
 * その食い違いを、通常の突き合わせとは別に、次の規則で解消する:
 * - この端末が共有の操作中(busy)のときは何もしない(操作中のローカルの状態を巻き戻さない)
 * - リモートに sharing がある: リモートを採用する
 * - リモートに無い: ローカルが active のときだけ取り除く(他端末で停止された)。
 *   migrating / error は残す(開始の途中でまだリモートに書けていない状態と区別できないため)
 * - ゲスト接続(connectionId あり)のプロジェクトは最上位に文書を持たないので対象外
 */
export function adoptSharing(
	local: ProjectSharing | undefined,
	remote: ProjectSharing | undefined,
	busy: boolean
): { adopt: boolean; sharing?: ProjectSharing } {
	if (busy || local?.connectionId || remote?.connectionId) return { adopt: false };
	if (remote) {
		return JSON.stringify(sortKeys(local)) === JSON.stringify(sortKeys(remote))
			? { adopt: false }
			: { adopt: true, sharing: remote };
	}
	if (local?.status === 'active') return { adopt: true, sharing: undefined };
	return { adopt: false };
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, v]) => v !== undefined)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, sortKeys(v)])
		);
	}
	return value;
}
