/**
 * エディタ(アプリ)との連携。親ドメインの Cookie で受け渡す。
 * 同名の定義はアプリ側の src/lib/utils/siteLink.ts にある。
 * - storift_used: エディタで作品を作ったことがある(1)
 * - storift_autoopen: サイトを開いたときに自動でエディタへ移動する(1) / しない(0)。未設定なら尋ねる
 */
const USED = 'storift_used';
const AUTO_OPEN = 'storift_autoopen';
const YEAR = 60 * 60 * 24 * 365;

function cookieDomain(): string {
	const host = location.hostname;
	if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) return '';
	return `; Domain=${host.replace(/^app\./, '')}`;
}

function read(name: string): string | null {
	try {
		const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
		return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
	} catch {
		return null;
	}
}

/** エディタで作品を作ったことがあるか */
export function hasUsedEditor(): boolean {
	return read(USED) === '1';
}

/** 'on': 自動で移動 / 'off': 移動しない / null: まだ尋ねていない */
export function getAutoOpen(): 'on' | 'off' | null {
	const v = read(AUTO_OPEN);
	return v === '1' ? 'on' : v === '0' ? 'off' : null;
}

export function setAutoOpen(on: boolean): void {
	try {
		const secure = location.protocol === 'https:' ? '; Secure' : '';
		document.cookie = `${AUTO_OPEN}=${on ? '1' : '0'}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}${cookieDomain()}`;
	} catch {
		// 保存できなくても動作には影響しない
	}
}
