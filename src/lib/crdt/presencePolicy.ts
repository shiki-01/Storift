/**
 * 在席表示(presence)の純粋なロジック。
 * shared/{pid}/presence/{uid} に { name, color, sceneId, updatedAt } を書き、他のメンバーが購読して表示する。
 * 他者のカーソル/選択範囲の表示は含まない(段階 4)。
 */

/** この時間(ms)より古い在席情報は、離席・切断とみなして表示しない */
export const PRESENCE_TTL_MS = 90_000;
/** 在席情報を書き直す間隔(タブが見えている間) */
export const PRESENCE_INTERVAL_MS = 30_000;

export interface PresenceData {
	name: string;
	color: string;
	/** 開いているシーン。シーンを開いていないときは null */
	sceneId: string | null;
	updatedAt: number;
}

export interface PresenceEntry extends PresenceData {
	uid: string;
}

/** uid から決まる色(同じ uid はどの端末でも同じ色になる) */
export function presenceColor(uid: string): string {
	let hash = 2166136261;
	for (let i = 0; i < uid.length; i++) {
		hash ^= uid.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	const hue = (hash >>> 0) % 360;
	return `hsl(${hue}, 65%, 45%)`;
}

/** 表示名の既定値。オーナーは「オーナー」、ゲストは「ゲスト-<uid の先頭 4 文字>」 */
export function defaultDisplayName(role: 'owner' | 'editor' | 'viewer', uid: string): string {
	return role === 'owner' ? 'オーナー' : `ゲスト-${uid.slice(0, 4)}`;
}

/** 設定の表示名(空白だけなら未設定)があればそれ、無ければ既定値 */
export function resolveDisplayName(
	custom: string | undefined,
	role: 'owner' | 'editor' | 'viewer',
	uid: string
): string {
	return custom?.trim() || defaultDisplayName(role, uid);
}

/** 表示する在席: 自分を除き、updatedAt が TTL 以内のものだけ(名前順) */
export function activePresence(
	entries: PresenceEntry[],
	selfUid: string,
	now: number,
	ttl: number = PRESENCE_TTL_MS
): PresenceEntry[] {
	return entries
		.filter((e) => e.uid !== selfUid && now - e.updatedAt <= ttl)
		.sort((a, b) => a.name.localeCompare(b.name, 'ja') || a.uid.localeCompare(b.uid));
}

/** 在席チップの文言: 「他 N 人が閲覧中: 名前, …」。0 人なら null */
export function presenceLabel(others: PresenceEntry[], maxNames = 3): string | null {
	if (others.length === 0) return null;
	const names = others.slice(0, maxNames).map((e) => e.name);
	const rest = others.length - names.length;
	return `他 ${others.length} 人が閲覧中: ${names.join(', ')}${rest > 0 ? ` ほか${rest}人` : ''}`;
}

/** Firestore の文書データを在席情報にする。形が違えば null */
export function parsePresence(uid: string, data: Record<string, unknown>): PresenceEntry | null {
	const { name, color, sceneId, updatedAt } = data;
	if (typeof name !== 'string' || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
		return null;
	}
	return {
		uid,
		name,
		color: typeof color === 'string' ? color : presenceColor(uid),
		sceneId: typeof sceneId === 'string' ? sceneId : null,
		updatedAt
	};
}
