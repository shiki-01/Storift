/** PKCE (RFC 7636) と state の生成。S256 のみ */

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return base64Url(bytes);
}

/** code_verifier: 43 文字(32 バイトの乱数を base64url)。使える文字は A-Za-z0-9-._~ のうち英数字と -_ */
export function generateCodeVerifier(): string {
	return randomBase64Url(32);
}

/** state: 推測できない乱数(1024 文字以下) */
export function generateState(): string {
	return randomBase64Url(32);
}

/** code_challenge = BASE64URL(SHA-256(code_verifier))。43 文字 */
export async function codeChallengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64Url(new Uint8Array(digest));
}
