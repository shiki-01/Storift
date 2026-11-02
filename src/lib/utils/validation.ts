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

export function isValidFirebaseConfig(config: unknown): boolean {
	if (typeof config !== 'object' || config === null) return false;
	const c = config as Record<string, unknown>;
	return (
		typeof c.apiKey === 'string' &&
		typeof c.authDomain === 'string' &&
		typeof c.projectId === 'string' &&
		typeof c.storageBucket === 'string' &&
		typeof c.messagingSenderId === 'string' &&
		typeof c.appId === 'string'
	);
}
