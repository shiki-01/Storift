/**
 * 変更履歴(CHANGELOG.md)を、更新情報のポップアップで表示できる形にする。
 * - 「## v0.11.0」の見出しごとに 1 つの版。版の見出しでない「##」(旧ルールの案内など)は読み飛ばす。
 * - 各版の「- **見出し**: 本文」を 1 項目とする。見出しの無い項目は本文だけ。
 * - 本文の **太字**・`コード`・[リンク](URL) は、HTML を使わずに表示できるよう、区切った断片にする。
 */

export type InlinePart =
	| { kind: 'text'; text: string }
	| { kind: 'strong'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'link'; text: string; href: string };

export interface ReleaseItem {
	/** 太字の見出し(無ければ空文字) */
	title: string;
	/** 見出しを除いた本文 */
	body: InlinePart[];
	/** 本文の最初の一文(一覧での要約) */
	summary: string;
}

export interface Release {
	version: string;
	items: ReleaseItem[];
}

const VERSION_HEADING = /^##\s+v?(\d+\.\d+\.\d+[^\s]*)\s*$/;
const REPO_URL = 'https://github.com/shiki-01/Storift';

/** 本文の **太字**・`コード`・[リンク](URL) を断片に分ける */
export function parseInline(text: string): InlinePart[] {
	const parts: InlinePart[] = [];
	const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) });
		if (match[1] !== undefined) parts.push({ kind: 'strong', text: match[1] });
		else if (match[2] !== undefined) parts.push({ kind: 'code', text: match[2] });
		else parts.push({ kind: 'link', text: match[3], href: resolveHref(match[4]) });
		last = index + match[0].length;
	}
	if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
	return parts;
}

/** 相対パス(docs/... など)は GitHub のリポジトリ上のファイルへ。http(s) 以外のスキームは使わない */
function resolveHref(href: string): string {
	if (/^https?:\/\//.test(href)) return href;
	if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return REPO_URL;
	return `${REPO_URL}/blob/main/${href.replace(/^\.?\//, '')}`;
}

/** 断片をつないだ素の文字列 */
export function plainText(parts: InlinePart[]): string {
	return parts.map((p) => p.text).join('');
}

/** 最初の一文(「。」まで)。長すぎるときは切り詰める */
function firstSentence(text: string, max = 90): string {
	const end = text.indexOf('。');
	const sentence = end >= 0 ? text.slice(0, end + 1) : text;
	return sentence.length > max ? `${sentence.slice(0, max)}…` : sentence;
}

function parseItem(raw: string): ReleaseItem {
	const heading = /^\*\*(.+?)\*\*\s*[:：]\s*/.exec(raw);
	const title = heading ? heading[1] : '';
	const body = parseInline(heading ? raw.slice(heading[0].length) : raw);
	return { title, body, summary: firstSentence(plainText(body)) };
}

/** CHANGELOG.md の本文を、新しい版から順の配列にする */
export function parseChangelog(markdown: string): Release[] {
	const releases: Release[] = [];
	let current: Release | null = null;
	let item: string | null = null;
	const flush = () => {
		if (current && item !== null) current.items.push(parseItem(item.trim()));
		item = null;
	};
	for (const line of markdown.split(/\r?\n/)) {
		if (line.startsWith('## ')) {
			flush();
			const version = VERSION_HEADING.exec(line)?.[1];
			current = version ? { version, items: [] } : null;
			if (current) releases.push(current);
			continue;
		}
		if (!current) continue;
		if (line.startsWith('- ')) {
			flush();
			item = line.slice(2);
		} else if (item !== null && /^\s+\S/.test(line)) {
			// 項目の続きの行
			item += ' ' + line.trim();
		} else if (line.trim() === '') {
			flush();
		}
	}
	flush();
	return releases;
}

/** "0.11.0" 形式の比較(a が新しければ正) */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

/** 前回見た版より新しい版(新しい順)。前回が分からなければ今の版だけ */
export function releasesSince(
	releases: Release[],
	current: string,
	lastSeen: string | null
): Release[] {
	const upTo = releases.filter((r) => compareVersions(r.version, current) <= 0);
	if (!lastSeen) return upTo.slice(0, 1);
	return upTo.filter((r) => compareVersions(r.version, lastSeen) > 0);
}

export const RELEASES_URL = `${REPO_URL}/releases`;
export const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
