export function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUrl(url: string): boolean {
	try {
		new URL(url);
		return true;
	} catch {
		return false;
	}
}

export function isValidFirebaseConfig(config: any): boolean {
	return (
		typeof config === 'object' &&
		typeof config.apiKey === 'string' &&
		typeof config.authDomain === 'string' &&
		typeof config.projectId === 'string' &&
		typeof config.storageBucket === 'string' &&
		typeof config.messagingSenderId === 'string' &&
		typeof config.appId === 'string'
	);
}
