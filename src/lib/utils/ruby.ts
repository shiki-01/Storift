/**
 * ルビ（ふりがな）ユーティリティ
 */

export interface RubyText {
	base: string;
	ruby: string;
}

export interface RubySegment {
	text: string;
	ruby?: string;
}

/**
 * ルビ記法をパース
 * 対応形式:
 * - 漢字《かんじ》
 * - 漢字（かんじ）
 * - 漢字[かんじ]
 * - |漢字《かんじ》
 */
export function parseRuby(text: string): RubySegment[] {
	const segments: RubySegment[] = [];
	let currentIndex = 0;

	// ルビのパターン
	const patterns = [
		/\|?([^《（\[]+)《([^》]+)》/g, // 漢字《かんじ》または|漢字《かんじ》
		/\|?([^《（\[]+)（([^）]+)）/g, // 漢字（かんじ）
		/\|?([^《（\[]+)\[([^\]]+)\]/g // 漢字[かんじ]
	];

	let matches: Array<{ index: number; base: string; ruby: string; length: number }> = [];

	// すべてのパターンでマッチを検索
	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		let match;
		while ((match = pattern.exec(text)) !== null) {
			const base = match[1].replace(/^\|/, '');
			matches.push({
				index: match.index,
				base,
				ruby: match[2],
				length: match[0].length
			});
		}
	}

	// インデックスでソート
	matches.sort((a, b) => a.index - b.index);

	// 重複を除去（同じ位置のマッチは最初のものを使用）
	matches = matches.filter((match, index, array) => {
		if (index === 0) return true;
		return match.index !== array[index - 1].index;
	});

	// セグメントを構築
	for (const match of matches) {
		// マッチ前のテキスト
		if (match.index > currentIndex) {
			segments.push({
				text: text.substring(currentIndex, match.index)
			});
		}

		// ルビ付きテキスト
		segments.push({
			text: match.base,
			ruby: match.ruby
		});

		currentIndex = match.index + match.length;
	}

	// 残りのテキスト
	if (currentIndex < text.length) {
		segments.push({
			text: text.substring(currentIndex)
		});
	}

	return segments;
}

/**
 * ルビをHTMLに変換
 */
export function rubyToHtml(text: string): string {
	const segments = parseRuby(text);
	return segments
		.map((segment) => {
			if (segment.ruby) {
				return `<ruby>${segment.text}<rt>${segment.ruby}</rt></ruby>`;
			}
			return segment.text;
		})
		.join('');
}

/**
 * ルビを削除してプレーンテキストに変換
 */
export function removeRuby(text: string): string {
	return text
		.replace(/\|?([^《（\[]+)《[^》]+》/g, '$1')
		.replace(/\|?([^《（\[]+)（[^）]+）/g, '$1')
		.replace(/\|?([^《（\[]+)\[[^\]]+\]/g, '$1');
}

/**
 * ルビ記法を標準化（すべて《》形式に変換）
 */
export function normalizeRuby(text: string): string {
	return text
		.replace(/\|?([^《（\[]+)（([^）]+)）/g, '$1《$2》')
		.replace(/\|?([^《（\[]+)\[([^\]]+)\]/g, '$1《$2》')
		.replace(/\|([^《]+)《/g, '$1《'); // |を削除
}

/**
 * 自動ルビ挿入（簡易版）
 * 実際のアプリでは形態素解析ライブラリ（kuromoji.js等）を使用することを推奨
 */
export function autoRuby(text: string, dictionary: Map<string, string>): string {
	let result = text;

	// 辞書に基づいてルビを挿入
	for (const [kanji, reading] of dictionary.entries()) {
		const regex = new RegExp(kanji, 'g');
		result = result.replace(regex, `${kanji}《${reading}》`);
	}

	return result;
}

/**
 * よく使う漢字のルビ辞書（サンプル）
 */
export const commonRubyDictionary = new Map<string, string>([
	['私', 'わたし'],
	['貴方', 'あなた'],
	['彼', 'かれ'],
	['彼女', 'かのじょ'],
	['今日', 'きょう'],
	['明日', 'あした'],
	['昨日', 'きのう'],
	['時間', 'じかん'],
	['場所', 'ばしょ'],
	['人々', 'ひとびと'],
	['世界', 'せかい'],
	['未来', 'みらい'],
	['過去', 'かこ'],
	['現在', 'げんざい']
]);

/**
 * ルビの統計情報を取得
 */
export function getRubyStats(text: string): {
	totalRuby: number;
	uniqueKanji: Set<string>;
	averageRubyLength: number;
} {
	const segments = parseRuby(text);
	const rubySegments = segments.filter((s) => s.ruby);

	const uniqueKanji = new Set<string>();
	let totalRubyLength = 0;

	for (const segment of rubySegments) {
		uniqueKanji.add(segment.text);
		totalRubyLength += segment.ruby!.length;
	}

	return {
		totalRuby: rubySegments.length,
		uniqueKanji,
		averageRubyLength: rubySegments.length > 0 ? totalRubyLength / rubySegments.length : 0
	};
}
