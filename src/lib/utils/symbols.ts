/**
 * 記号パレット(執筆画面のツールバーの「記号」)に並べる特殊記号。
 * 対になる括弧は、選択中の文字列を囲み、選択が無ければ括弧の内側にカーソルを置く。
 */

export interface SymbolItem {
	/** 入れる文字列(括弧は開き側) */
	text: string;
	/** 対になる閉じ側(括弧のときだけ) */
	close?: string;
	/** 読み上げ・ツールチップ用の名前 */
	name: string;
}

export interface SymbolGroup {
	id: string;
	label: string;
	items: SymbolItem[];
}

const pair = (open: string, close: string, name: string): SymbolItem => ({
	text: open,
	close,
	name
});
const one = (text: string, name: string): SymbolItem => ({ text, name });

export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
	{
		id: 'brackets',
		label: '括弧',
		items: [
			pair('「', '」', 'かぎ括弧'),
			pair('『', '』', '二重かぎ括弧'),
			pair('（', '）', '丸括弧'),
			pair('【', '】', '隅付き括弧'),
			pair('〈', '〉', '山括弧'),
			pair('《', '》', '二重山括弧'),
			pair('〔', '〕', '亀甲括弧'),
			pair('［', '］', '角括弧'),
			pair('“', '”', 'ダブルクォーテーション'),
			pair('〝', '〟', 'ちょんちょん括弧')
		]
	},
	{
		id: 'punctuation',
		label: '約物',
		items: [
			one('……', '三点リーダー(2 つ)'),
			one('――', 'ダッシュ(2 つ)'),
			one('…', '三点リーダー'),
			one('‥', '二点リーダー'),
			one('・', '中黒'),
			one('〜', '波ダッシュ'),
			one('！', '感嘆符'),
			one('？', '疑問符'),
			one('‼', '二重感嘆符'),
			one('⁉', '感嘆疑問符'),
			one('！？', '感嘆符と疑問符'),
			one('※', '米印'),
			one('〃', '同じく'),
			one('々', '繰り返し記号'),
			one('ゝ', '一の字点'),
			one('〆', 'しめ')
		]
	},
	{
		id: 'marks',
		label: '記号',
		items: [
			one('○', '丸'),
			one('●', '黒丸'),
			one('◎', '二重丸'),
			one('◇', 'ひし形'),
			one('◆', '黒ひし形'),
			one('□', '四角'),
			one('■', '黒四角'),
			one('△', '三角'),
			one('▲', '黒三角'),
			one('☆', '白星'),
			one('★', '黒星'),
			one('♪', '音符'),
			one('♡', 'ハート'),
			one('×', 'かける'),
			one('→', '右矢印'),
			one('←', '左矢印'),
			one('↑', '上矢印'),
			one('↓', '下矢印'),
			one('〒', '郵便記号'),
			one('♯', 'シャープ')
		]
	}
];

/** 記号を入れるときの文字列とカーソルの戻し量(selected は選択中の文字列) */
export function symbolInsertion(
	item: SymbolItem,
	selected = ''
): { text: string; caretBack: number } {
	if (!item.close) return { text: item.text, caretBack: 0 };
	return {
		text: `${item.text}${selected}${item.close}`,
		caretBack: selected ? 0 : item.close.length
	};
}
