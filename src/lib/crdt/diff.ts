import type * as Y from 'yjs';

/** 文字列の最小差分。index / deleteCount は UTF-16 コードユニット(Y.Text・JS 文字列と同じ) */
export interface TextDiff {
	index: number;
	deleteCount: number;
	insert: string;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * old → new の差分を 1 つの置換として返す(共通接頭辞・接尾辞を除いた中央部)。
 * サロゲートペアの途中で分割しない: 接頭辞が上位サロゲートで終わるなら 1 つ戻し、
 * 接尾辞が下位サロゲートで始まるなら 1 つ縮める。同一文字列は deleteCount 0・insert '' を返す。
 */
export function diffText(oldText: string, newText: string): TextDiff {
	const minLength = Math.min(oldText.length, newText.length);

	let prefix = 0;
	while (prefix < minLength && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
	if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) prefix--;

	let suffix = 0;
	const maxSuffix = minLength - prefix;
	while (
		suffix < maxSuffix &&
		oldText.charCodeAt(oldText.length - 1 - suffix) ===
			newText.charCodeAt(newText.length - 1 - suffix)
	) {
		suffix++;
	}
	if (suffix > 0 && isLowSurrogate(oldText.charCodeAt(oldText.length - suffix))) suffix--;

	return {
		index: prefix,
		deleteCount: oldText.length - prefix - suffix,
		insert: newText.slice(prefix, newText.length - suffix)
	};
}

/** 1 回の挿入の最大長。巨大な貼り付けが 1 つの更新(= Firestore の 1 文書)に収まらなくなるのを避ける */
export const MAX_INSERT_CHUNK = 50_000;

/** 文字列を、サロゲートペアの途中で切らずに max コードユニット以下に分ける */
export function chunkText(text: string, max: number = MAX_INSERT_CHUNK): string[] {
	if (text.length <= max) return [text];
	const chunks: string[] = [];
	let start = 0;
	while (start < text.length) {
		let end = Math.min(start + max, text.length);
		if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end--;
		chunks.push(text.slice(start, end));
		start = end;
	}
	return chunks;
}

/**
 * ytext の内容を oldText から newText へ変える差分を適用する(oldText は現在の ytext.toString() であること)。
 * 巨大な挿入は複数のトランザクションに分ける。変更があったら true。
 */
export function applyDiffToYText(
	ytext: Y.Text,
	oldText: string,
	newText: string,
	origin: unknown
): boolean {
	const diff = diffText(oldText, newText);
	if (diff.deleteCount === 0 && diff.insert === '') return false;
	const doc = ytext.doc;
	if (!doc) throw new Error('Y.Text が文書に属していません');

	const chunks = diff.insert === '' ? [] : chunkText(diff.insert);
	doc.transact(() => {
		if (diff.deleteCount > 0) ytext.delete(diff.index, diff.deleteCount);
		if (chunks.length > 0) ytext.insert(diff.index, chunks[0]);
	}, origin);
	let offset = chunks[0]?.length ?? 0;
	for (const chunk of chunks.slice(1)) {
		const at = diff.index + offset;
		doc.transact(() => ytext.insert(at, chunk), origin);
		offset += chunk.length;
	}
	return true;
}
