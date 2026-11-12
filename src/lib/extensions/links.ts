/** 拡張の説明ページ(紹介サイト)の URL。「この拡張が扱う情報」はプライバシーポリシーの一部 */
export const SITE_ORIGIN = 'https://storift.shiki-01.com';

export function extensionPageUrl(id: string): string {
	return `${SITE_ORIGIN}/extensions/${id}`;
}
