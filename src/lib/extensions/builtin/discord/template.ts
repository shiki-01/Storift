/**
 * 表示文字のテンプレート({page} などのプレースホルダー)の評価。DOM・状態に依存しない純関数。
 *
 * - 使えるプレースホルダー: {page}(画面のラベル)、{project}(作品名)、{chars}(セッションの増減文字数)、{total}(作品の総文字数)
 * - 知らないプレースホルダー({foo} など)は、そのまま残す
 * - 値が空のプレースホルダーは、それを含む区間ごと省く。「『{project}』を執筆中」で作品名が空なら、
 *   「『』を執筆中」ではなく「執筆中」になる(前後の括弧・直後の助詞や単位(を・の・字 など)も一緒に省く)
 * - 空白を整理し、前後に残った区切り(- ・ / など)を取り、128 文字(Discord の上限)に切り詰める
 */

export const PLACEHOLDERS = ['page', 'project', 'chars', 'total'] as const;
export type PlaceholderName = (typeof PLACEHOLDERS)[number];
export type TemplateVars = Partial<Record<PlaceholderName, string>>;

/** Discord の details / state の上限(文字数) */
export const MAX_PRESENCE_TEXT = 128;
/** テンプレート自体の上限(設定で入力できる長さ) */
export const MAX_TEMPLATE_LENGTH = 200;

// [開き括弧][空白]{名前}[単位][空白][閉じ括弧][助詞]
const PLACEHOLDER_PATTERN = new RegExp(
	'(?:([「『（(【\\[［〈《“"])[ \\t　]*)?' +
		`\\{(${PLACEHOLDERS.join('|')})\\}` +
		'([ \\t　]?(?:文字|字))?' +
		'(?:[ \\t　]*([」』）)】\\]］〉》”"]))?' +
		'([をのでがはにとも])?',
	'g'
);

// 前後に残った区切り
const EDGE_SEPARATORS = /^[\s\-–—・|/:：、,，]+|[\s\-–—・|/:：、,，]+$/g;

/** 文字数を上限に切り詰める(サロゲートペアの途中で切らない) */
export function truncateText(text: string, max = MAX_PRESENCE_TEXT): string {
	const chars = [...text];
	return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

/** テンプレートを評価する。結果が空になることもある(呼び出し側で省く) */
export function renderTemplate(
	template: string,
	vars: TemplateVars,
	max = MAX_PRESENCE_TEXT
): string {
	const replaced = template.replace(
		PLACEHOLDER_PATTERN,
		(
			_all,
			open: string | undefined,
			name: PlaceholderName,
			unit: string | undefined,
			close: string | undefined,
			particle: string | undefined
		) => {
			const value = vars[name]?.trim();
			// 値が空: 括弧・単位・助詞も含めて、区間ごと省く
			if (!value) return '';
			return `${open ?? ''}${value}${unit ?? ''}${close ?? ''}${particle ?? ''}`;
		}
	);
	const tidy = replaced
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/[ \u3000]{2,}/g, ' ')
		.replace(EDGE_SEPARATORS, '');
	return truncateText(tidy, max);
}

/** テンプレートが、そのプレースホルダーを使っているか(使わない情報は取得しない) */
export function usesPlaceholder(template: string, name: PlaceholderName): boolean {
	return template.includes(`{${name}}`);
}
