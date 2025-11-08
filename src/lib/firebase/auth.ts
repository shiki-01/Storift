import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
import { getAuthInstance } from './config';

export async function signInAnonymousUser(): Promise<User> {
	const auth = getAuthInstance();
	const result = await signInAnonymously(auth);
	return result.user;
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
	const auth = getAuthInstance();
	return onAuthStateChanged(auth, callback);
}

export function getCurrentUser(): User | null {
	const auth = getAuthInstance();
	return auth.currentUser;
}
