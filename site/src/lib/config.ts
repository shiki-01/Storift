import { env } from '$env/dynamic/public';

/** サイトとエディタの URL。未設定のときは Cloudflare Pages の既定ドメインを使う */
export const SITE_URL = (env.PUBLIC_SITE_URL || 'https://storift.shiki-01.com').replace(/\/$/, '');
export const APP_URL = (env.PUBLIC_APP_URL || 'https://app.storift.shiki-01.com').replace(
	/\/$/,
	''
);

export const SITE_NAME = 'Storift';
export const SITE_TAGLINE = '小説を書くための、ひとつの場所。';
export const SITE_DESCRIPTION =
	'Storift は、執筆・プロット・キャラクター・設定資料・進捗をひとつにまとめた小説執筆アプリ。ブラウザで動き、オフラインでも書けます。';

export const NAV = [
	{ href: '/features', label: '機能' },
	{ href: '/guide', label: '使い方' },
	{ href: '/faq', label: 'Q&A' }
] as const;
