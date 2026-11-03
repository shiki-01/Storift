/**
 * サイト(紹介ページ)との連携。Web 版だけで使う。
 *
 * サイトとアプリは別オリジン(storift.example / app.storift.example)なので、
 * 親ドメインの Cookie を共有して次の 2 つを受け渡す。
 * - storift_used: エディタで作品を作ったことがある(1)
 * - storift_autoopen: サイトを開いたときに自動でエディタへ移動する(1) / しない(0)。未設定なら、サイトが尋ねる
 * サイト側の同名の定義は site/src/lib/editorLink.ts にある。
 */
const USED = 'storift_used';
const AUTO_OPEN = 'storift_autoopen';
const YEAR = 60 * 60 * 24 * 365;

function cookieDomain(): string {
	const host = location.hostname;
	// localhost や IP アドレスでは Domain を付けない
	if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) return '';
	return `; Domain=${host.replace(/^app\./, '')}`;
}

function write(name: string, value: string): void {
	try {
		const secure = location.protocol === 'https:' ? '; Secure' : '';
		document.cookie = `${name}=${value}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}${cookieDomain()}`;
	} catch {
		// Cookie が使えなくても動作には影響しない
	}
}

function read(name: string): string | null {
	try {
		const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
		return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
	} catch {
		return null;
	}
}

/** 作品を作ったことがあると、サイトに伝える */
export function markEditorUsed(): void {
	if (read(USED) !== '1') write(USED, '1');
}

/** サイトを開いたときに自動でエディタへ移動するか */
export function getAutoOpen(): boolean {
	return read(AUTO_OPEN) === '1';
}

export function setAutoOpen(value: boolean): void {
	write(AUTO_OPEN, value ? '1' : '0');
}
