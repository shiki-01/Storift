import { activePresence, type PresenceEntry } from '$lib/crdt/presencePolicy';

let entries = $state<PresenceEntry[]>([]);
let selfUid = $state('');
// 期限切れの判定に使う現在時刻(定期的に更新される)
let now = $state(Date.now());

/** 共有プロジェクトを開いている他のメンバーの在席状況(エディタを開いている間だけ購読される) */
export const presenceStore = {
	get entries() {
		return entries;
	},
	set entries(value: PresenceEntry[]) {
		entries = value;
	},
	get selfUid() {
		return selfUid;
	},
	set selfUid(value: string) {
		selfUid = value;
	},
	tick() {
		now = Date.now();
	},
	/** 自分を除き、90 秒以内に更新された他者 */
	get others(): PresenceEntry[] {
		return activePresence(entries, selfUid, now);
	},
	reset() {
		entries = [];
		selfUid = '';
	}
};
