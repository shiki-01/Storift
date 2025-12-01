/**
 * ルビ（ふりがな）・傍点ユーティリティ
 * 
 * ルビ記法:
 * - ｜親文字《ルビ文字》 または 親文字《ルビ文字》
 * - 例：｜紅蓮の炎《ヘルフレイム》
 * 
 * 傍点記法:
 * - 《《テキスト》》（二重山カッコ）
 * - 例：これは《《重要》》です
 */

export interface RubyText {
	base: string;
	ruby: string;
}

export interface RubySegment {
	text: string;
	ruby?: string;
	bouten?: boolean; // 傍点フラグ
}

/**
 * ルビ・傍点記法をパース
 * 対応形式:
 * - 漢字《かんじ》
 * - ｜漢字《かんじ》（全角縦棒）
 * - |漢字《かんじ》（半角縦棒）
 * - 《《傍点テキスト》》（二重山カッコで傍点）
 */
export function parseRuby(text: string): RubySegment[] {
	const segments: RubySegment[] = [];
	const remaining = text;

	// 傍点とルビのパターン
	// 傍点: 《《テキスト》》
	// ルビ: ｜または|で始まる場合は任意の文字列、そうでなければ漢字のみ
	const combinedPattern = /《《([^》]+)》》|[｜|]([^《》\n]+)《([^》]+)》|([一-龯々]+)《([^》]+)》/g;

	let lastIndex = 0;
	let match;

	while ((match = combinedPattern.exec(remaining)) !== null) {
		// マッチ前のテキスト
		if (match.index > lastIndex) {
			segments.push({
				text: remaining.substring(lastIndex, match.index)
			});
		}

		if (match[1] !== undefined) {
			// 傍点: 《《テキスト》》
			segments.push({
				text: match[1],
				bouten: true
			});
		} else if (match[2] !== undefined && match[3] !== undefined) {
			// ルビ（｜または|付き）: ｜親文字《ルビ》
			segments.push({
				text: match[2],
				ruby: match[3]
			});
		} else if (match[4] !== undefined && match[5] !== undefined) {
			// ルビ（漢字のみ）: 漢字《かんじ》
			segments.push({
				text: match[4],
				ruby: match[5]
			});
		}

		lastIndex = match.index + match[0].length;
	}

	// 残りのテキスト
	if (lastIndex < remaining.length) {
		segments.push({
			text: remaining.substring(lastIndex)
		});
	}

	return segments;
}

/**
 * ルビ・傍点をHTMLに変換
 */
export function rubyToHtml(text: string): string {
	const segments = parseRuby(text);
	return segments
		.map((segment) => {
			if (segment.bouten) {
				// 傍点: 各文字にドットを付ける
				return `<span class="bouten">${segment.text}</span>`;
			}
			if (segment.ruby) {
				return `<ruby>${segment.text}<rt>${segment.ruby}</rt></ruby>`;
			}
			return segment.text;
		})
		.join('');
}

/**
 * ルビ・傍点を削除してプレーンテキストに変換
 */
export function removeRuby(text: string): string {
	return text
		.replace(/《《([^》]+)》》/g, '$1') // 傍点を削除
		.replace(/[｜|]([^《》\n]+)《[^》]+》/g, '$1') // ｜付きルビを削除
		.replace(/([一-龯々]+)《[^》]+》/g, '$1'); // 漢字ルビを削除
}

/**
 * ルビ記法を標準化（すべて《》形式に変換）
 */
export function normalizeRuby(text: string): string {
	// 傍点はそのまま保持
	// ルビの｜を削除（漢字のみの場合は不要なため）
	return text.replace(/[｜|]([一-龯々]+)《/g, '$1《');
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
