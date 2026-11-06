import {
	collection,
	deleteDoc,
	doc,
	onSnapshot,
	setDoc,
	type Firestore,
	type Unsubscribe
} from 'firebase/firestore';
import { parsePresence, type PresenceData, type PresenceEntry } from '$lib/crdt/presencePolicy';

/**
 * 在席情報の Firestore 操作(shared/{pid}/presence/{uid})。
 * Firestore インスタンスを引数に取るので、オーナー・ゲスト接続のどちらにも使える。
 */

const presenceDoc = (db: Firestore, pid: string, uid: string) =>
	doc(db, `shared/${pid}/presence/${uid}`);

export async function writePresence(
	db: Firestore,
	pid: string,
	uid: string,
	data: PresenceData
): Promise<void> {
	await setDoc(presenceDoc(db, pid, uid), data);
}

export async function deletePresence(db: Firestore, pid: string, uid: string): Promise<void> {
	await deleteDoc(presenceDoc(db, pid, uid));
}

export function listenPresence(
	db: Firestore,
	pid: string,
	onChange: (entries: PresenceEntry[]) => void,
	onError: (error: unknown) => void
): Unsubscribe {
	return onSnapshot(
		collection(db, `shared/${pid}/presence`),
		(snapshot) => {
			const entries: PresenceEntry[] = [];
			for (const d of snapshot.docs) {
				const entry = parsePresence(d.id, d.data());
				if (entry) entries.push(entry);
			}
			onChange(entries);
		},
		onError
	);
}
