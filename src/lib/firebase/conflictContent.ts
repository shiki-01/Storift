/**
 * 競合の内容比較(純粋なロジック)。同期サービスの競合判定と、競合ダイアログの表示が共有する。
 */

/** 内容ではなく同期の管理用のキー。内容の比較・差分の表示から除く */
export const META_KEYS: ReadonlySet<string> = new Set(['updatedAt', '_version', 'syncedAt']);

type Entity = object;

const entries = (e: Entity) =>
	Object.entries(e)
		.filter(([key]) => !META_KEYS.has(key))
		.sort(([x], [y]) => x.localeCompare(y));

/** メタ項目(META_KEYS)を除いて、内容が異なるか */
export function contentDiffers(a: Entity, b: Entity): boolean {
	return JSON.stringify(entries(a)) !== JSON.stringify(entries(b));
}

/** メタ項目を除いて、値が異なるキー(双方のキーの和集合。キー順) */
export function differingKeys(a: Entity, b: Entity): string[] {
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	return [...keys]
		.filter((key) => !META_KEYS.has(key))
		.filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
		.sort((x, y) => x.localeCompare(y));
}

/** 手動の並び順(order)を持つ項目。並べ替えだけの違いは、内容の競合として扱わない */
const ORDERED_TYPES: ReadonlySet<string> = new Set(['characters', 'worldbuilding', 'plots']);

/** メタ項目を除いた違いが order だけか(人物・設定資料・プロットの並べ替えだけが食い違った場合) */
export function differsOnlyInOrder(type: string, a: Entity, b: Entity): boolean {
	if (!ORDERED_TYPES.has(type)) return false;
	const keys = differingKeys(a, b);
	return keys.length > 0 && keys.every((key) => key === 'order');
}

export type ConflictDecisionReason =
	| 'newest-wins'
	| 'same-content'
	| 'order-only'
	| 'policy-local'
	| 'policy-remote';

export type ConflictDecision =
	| { kind: 'auto'; action: 'apply-remote' | 'push-local'; reason: ConflictDecisionReason }
	| { kind: 'manual' };

/**
 * 競合(双方が base 以降に更新)をどう扱うか決める。
 * - プロジェクト・CRDT 化したシーン(newestWins): 常に新しい方
 * - 内容がメタ項目を除いて同一: 新しい updatedAt の方(自動書き込みで updatedAt だけが動いた場合。履歴退避は不要)
 * - 人物・設定資料・プロットで、違いがメタ項目と order(並べ替え)だけ: 新しい updatedAt の方
 *   (並べ替えは内容の編集ではないので、ダイアログを出さない)
 * - 競合ポリシーが local / remote: その方針
 * - それ以外: 手動(ダイアログ)
 */
export function decideConflict(
	type: string,
	local: Entity & { updatedAt: number },
	remote: Entity & { updatedAt: number },
	policy: string,
	newestWins = false
): ConflictDecision {
	const newest = remote.updatedAt > local.updatedAt ? 'apply-remote' : 'push-local';
	if (type === 'projects' || newestWins) {
		return { kind: 'auto', action: newest, reason: 'newest-wins' };
	}
	if (!contentDiffers(local, remote)) {
		return { kind: 'auto', action: newest, reason: 'same-content' };
	}
	if (differsOnlyInOrder(type, local, remote)) {
		return { kind: 'auto', action: newest, reason: 'order-only' };
	}
	if (policy === 'local') return { kind: 'auto', action: 'push-local', reason: 'policy-local' };
	if (policy === 'remote') return { kind: 'auto', action: 'apply-remote', reason: 'policy-remote' };
	return { kind: 'manual' };
}
