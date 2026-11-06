import type { User } from 'firebase/auth';
import type { AccessMode } from '$lib/types';

/** 新ルール適用済みで、この端末がオーナー未登録のときの案内 */
export const NEEDS_OWNER_MESSAGE =
	'このFirebaseは新しいルールで保護されています。オーナー端末の設定コードを貼り付けてください';

let authUser = $state<User | null>(null);
let isInitialized = $state(false);
// null = まだ判定もキャッシュもない
let accessMode = $state<AccessMode | null>(null);

export const authStore = {
	get user() {
		return authUser;
	},
	set user(value: User | null) {
		authUser = value;
	},
	get isInitialized() {
		return isInitialized;
	},
	set isInitialized(value: boolean) {
		isInitialized = value;
	},
	get isAuthenticated() {
		return authUser !== null;
	},
	/** Firestore へのアクセスモード(判定前は null) */
	get accessMode() {
		return accessMode;
	},
	set accessMode(value: AccessMode | null) {
		accessMode = value;
	},
	/** アクセスモードに応じた案内メッセージ(案内が不要なら null) */
	get accessMessage() {
		return accessMode === 'needs-owner' ? NEEDS_OWNER_MESSAGE : null;
	}
};
