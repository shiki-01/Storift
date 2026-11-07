/**
 * AI の回答に出てくる資料への参照。
 *
 * AI には、資料に触れるとき `[[種別:id|表示名]]` で書かせる(プロンプトは REFERENCE_INSTRUCTIONS)。
 * 表示側ではこの記法を、押せるリンク(<button class="ref-link">)に変える。
 * 守られずに `(id: <uuid>)` が素の文章に出たときも、既知の id ならリンクにして id を隠す。
 */

export const REF_KINDS = ['character', 'plot', 'worldbuilding', 'scene', 'memo'] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** 画面上の呼び名(リンクのツールチップ用) */
export const REF_KIND_LABELS: Record<RefKind, string> = {
	character: '人物',
	plot: 'プロット',
	worldbuilding: '設定資料',
	scene: 'シーン',
	memo: 'メモ'
};

export const REFERENCE_INSTRUCTIONS =
	'ユーザーは worldbuilding・plot・characters などの内部名や ID を把握していません。' +
	'画面上の呼称(設定資料・プロット・人物・シーン・メモ)で書いてください。' +
	'資料に言及するときは、専用の参照記法 [[種別:id|表示名]] で書いてください。' +
	'種別は character(人物)・plot(プロット)・worldbuilding(設定資料)・scene(シーン)・memo(メモ)のいずれかです。' +
	'例: [[character:ID|日野 夕理]]。id や英語の内部名を、素の文章に出さないでください。';

/** 参照先の索引。id から種別と名前を引く */
export type RefLookup = (id: string) => { kind: RefKind; name: string } | undefined;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const NOTATION_RE = new RegExp(
	`\\[\\[(${REF_KINDS.join('|')}):([^\\]|\\s]+)\\|([^\\]]*)\\]\\]`,
	'g'
);
// 「名前」(id: uuid)・名前(sceneId: uuid) など。直前に「」『』があれば、その名前を表示名にする
const RAW_ID_RE = new RegExp(
	`(?:[「『]([^」』\\n]{1,60})[」』])?[ \\t]*[(（][ \\t]*(?:[A-Za-z]*[iI][dD])[ \\t]*[:：][ \\t]*(${UUID})[ \\t]*[)）]`,
	'g'
);

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function linkHtml(kind: RefKind, id: string, name: string, valid: boolean): string {
	const label = escapeHtml(name || REF_KIND_LABELS[kind]);
	if (!valid)
		return `<span class="ref-link missing" title="見つかりません(削除された可能性があります)">${label}</span>`;
	const title = escapeHtml(`${REF_KIND_LABELS[kind]}を開く`);
	return `<button type="button" class="ref-link" data-ref-kind="${kind}" data-ref-id="${escapeHtml(id)}" title="${title}">${label}</button>`;
}

function convert(text: string, lookup: RefLookup): string {
	const withNotation = text.replace(NOTATION_RE, (_m, kind: RefKind, id: string, name: string) => {
		const hit = lookup(id);
		// 種別を間違えていても、索引にあればそちらを正とする
		return hit
			? linkHtml(hit.kind, id, hit.name || name.trim(), true)
			: linkHtml(kind, id, name.trim(), false);
	});
	return withNotation.replace(RAW_ID_RE, (m, quoted: string | undefined, id: string) => {
		const hit = lookup(id);
		if (!hit) return m;
		const link = linkHtml(hit.kind, id, hit.name, true);
		// 「名前」が直前にあれば、それ自体をリンクにして id だけを隠す
		return quoted ? `「${linkHtml(hit.kind, id, quoted, true)}」` : link;
	});
}

/**
 * Markdown の本文にある参照記法・素の id を、リンクの HTML に置き換える(marked に渡す前に使う)。
 * コードブロック・インラインコードの中は変えない。
 */
export function linkifyRefs(text: string, lookup: RefLookup): string {
	if (!text.includes('[[') && !/id\s*[:：]/i.test(text)) return text;
	const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
	return parts.map((part, i) => (i % 2 === 1 ? part : convert(part, lookup))).join('');
}
