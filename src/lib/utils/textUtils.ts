export function countCharacters(text: string, p0: boolean = false): number {
	return text.length;
}

export function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * テキスト内の行数をカウントします
 * @param text - カウント対象のテキスト
 * @returns 行数
 */
export function countLines(text: string): number {
  if (text === '') {
    return 0;
  }
  // 改行文字で分割して行数を取得
  // 最後が改行で終わる場合も考慮
  const lines = text.split('\n');
  return lines.length;
}

export function countParagraphs(text: string): number {
	return text.split(/\n+/).filter((p) => p.trim().length > 0).length;
}

export function searchAndReplace(
	text: string,
	search: string,
	replace: string,
	caseSensitive = false
): string {
	if (!caseSensitive) {
		const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
		return text.replace(regex, replace);
	}
	return text.split(search).join(replace);
}

export function highlightText(text: string, query: string): string {
	if (!query) return text;
	const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
	return text.replace(regex, '<mark>$1</mark>');
}
