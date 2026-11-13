/**
 * ランタイムシェル(sandbox 付き iframe の srcdoc)の HTML と CSP を作る。
 *
 * CSP は <meta http-equiv="Content-Security-Policy"> を最初に置く。許すのは、nonce 付きのシェルのスクリプトと、
 * Blob から起動する Web Worker、マニフェストで宣言したホストへの接続(https)だけ。
 * 'unsafe-eval' と 'unsafe-inline' は付けないので、ワーカーの中でも eval / new Function / importScripts は使えない。
 * (Blob のワーカーは、作った文書の CSP を引き継ぐ。tests/e2e/scripts.spec.mjs で実際のブラウザで確かめている)
 */
import shellSource from './shell-source.js?raw';
import workerSource from './worker-source.js?raw';

/** ワーカーの先頭に連結する SDK */
export const WORKER_BOOTSTRAP: string = workerSource;
export const SHELL_SOURCE: string = shellSource;

/** 毎回新しい乱数の nonce(base64url。128 ビット) */
export function createNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/**
 * シェルの CSP。connect-src は、宣言したホストの https のみ(宣言が無ければ 'none')。
 * ホスト名は小文字の英数字・ハイフン・ピリオドだけを受け付ける(CSP への文字列の混入を防ぐ)
 */
export function buildCsp(nonce: string, hosts: readonly string[]): string {
	if (!/^[A-Za-z0-9_-]{16,}$/.test(nonce)) throw new Error('nonce が正しくありません');
	for (const host of hosts) {
		if (!HOST_PATTERN.test(host)) throw new Error(`通信先のホスト名が正しくありません: ${host}`);
	}
	const connect = hosts.length > 0 ? hosts.map((h) => `https://${h}`).join(' ') : "'none'";
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}'`,
		'worker-src blob:',
		`connect-src ${connect}`,
		"img-src 'none'",
		"style-src 'none'",
		"form-action 'none'",
		"base-uri 'none'"
	].join('; ');
}

/** iframe の srcdoc にする HTML。CSP の meta をいちばん先に置く */
export function buildShellHtml(nonce: string, hosts: readonly string[]): string {
	const csp = buildCsp(nonce, hosts);
	return (
		`<!doctype html><html><head>` +
		`<meta http-equiv="Content-Security-Policy" content="${csp}">` +
		`<meta charset="utf-8"></head><body>` +
		`<script nonce="${nonce}">${shellSource}</script></body></html>`
	);
}
