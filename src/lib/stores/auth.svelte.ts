import type { User } from 'firebase/auth';

let authUser = $state<User | null>(null);
let isInitialized = $state(false);

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
	}
};
