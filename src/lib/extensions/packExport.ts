/**
 * パックの書き出しのプリセットを、本文に当てはめる(ルビ・傍点・空行の記法の変換)。
 * 書き出す文字列だけを変え、保存されている原稿は書き換えない。
 *
 * 記法の認識は src/lib/utils/ruby.ts の parseRuby と同じ(傍点 《《語》》、ルビ ｜親《ルビ》 と 漢字《かんじ》)。
 */
import type { BlankLineMode, BoutenMode, RubyMode } from './pack';

export interface ExportNotation {
	ruby: RubyMode;
	bouten: BoutenMode;
	blankLines: BlankLineMode;
}

// parseRuby と同じ並び(傍点 → 縦棒付きのルビ → 漢字だけのルビ)。一度の走査で変換するので、変換結果は再変換されない
const NOTATION = /《《([^》]+)》》|[｜|]([^《》\n]+)《([^》]+)》|([一-龯々]+)《([^》]+)》/g;

function convertBlankLines(text: string, mode: BlankLineMode): string {
	if (mode === 'keep') return text;
	const lines = text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.filter((line) => line.trim() !== '');
	// collapse: 空行を除く / between-paragraphs: 文のある行の間に、空行をちょうど 1 つ入れる
	return lines.join(mode === 'collapse' ? '\n' : '\n\n');
}

/** 本文に、ルビ・傍点・空行の変換を当てはめる */
export function applyExportNotation(text: string, notation: ExportNotation): string {
	let out = text;
	if (notation.ruby !== 'keep' || notation.bouten !== 'keep') {
		out = text.replace(
			NOTATION,
			(
				whole: string,
				bouten?: string,
				pipeBase?: string,
				pipeRuby?: string,
				kanjiBase?: string,
				kanjiRuby?: string
			) => {
				if (bouten !== undefined) {
					if (notation.bouten === 'keep') return whole;
					if (notation.bouten === 'strip') return bouten;
					return `｜${bouten}《${'・'.repeat([...bouten].length)}》`;
				}
				if (notation.ruby === 'keep') return whole;
				const base = pipeBase ?? kanjiBase ?? '';
				const ruby = pipeRuby ?? kanjiRuby ?? '';
				if (notation.ruby === 'strip') return base;
				if (notation.ruby === 'paren') return `${base}(${ruby})`;
				return `|${base}《${ruby}》`;
			}
		);
	}
	return convertBlankLines(out, notation.blankLines);
}
