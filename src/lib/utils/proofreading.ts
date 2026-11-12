/**
 * 文章校閲ユーティリティ
 */
import { findRuleMatches, type PackRuleSource } from '$lib/extensions/packProofread';

export interface ProofreadingIssue {
	type: 'typo' | 'redundancy' | 'style' | 'grammar' | 'suggestion';
	severity: 'error' | 'warning' | 'info';
	message: string;
	position: { start: number; end: number };
	suggestion?: string;
	original: string;
	/** 指摘のもとになった拡張(パック)の ID。本体の校閲なら無い */
	packId?: string;
}

/**
 * 文章をチェック。packRules に、有効なパックの辞書(表記ゆれ)を渡すと、本体の校閲に合わせて指摘する
 */
export function proofread(
	text: string,
	packRules: readonly PackRuleSource[] = []
): ProofreadingIssue[] {
	const issues: ProofreadingIssue[] = [];

	// 各種チェックを実行
	issues.push(...checkTypos(text));
	issues.push(...checkRedundancy(text));
	issues.push(...checkStyle(text));
	issues.push(...checkGrammar(text));
	issues.push(...checkPackRules(text, packRules));

	// 位置でソート
	issues.sort((a, b) => a.position.start - b.position.start);

	return issues;
}

/**
 * パックの辞書(固定の文字列の対応)による表記ゆれのチェック
 */
function checkPackRules(text: string, packRules: readonly PackRuleSource[]): ProofreadingIssue[] {
	if (packRules.length === 0) return [];
	return findRuleMatches(text, packRules).map((m) => ({
		type: 'style' as const,
		severity: 'info' as const,
		message: m.message,
		position: { start: m.start, end: m.end },
		suggestion: m.suggestion,
		original: m.original,
		packId: m.packId
	}));
}

/**
 * よくある誤字・脱字をチェック
 */
function checkTypos(text: string): ProofreadingIssue[] {
	const issues: ProofreadingIssue[] = [];

	const typoPatterns: Array<{
		pattern: RegExp;
		message: string;
		suggestion: string;
	}> = [
		{
			pattern: /永遠と(?=続|語|話|喋|歩|走)/g,
			message: '「延々と」の誤用です',
			suggestion: '延々と'
		},
		{ pattern: /ふいんき/g, message: '「ふんいき(雰囲気)」の誤りです', suggestion: 'ふんいき' },
		{
			pattern: /シュミレーション/g,
			message: '「シミュレーション」の誤字です',
			suggestion: 'シミュレーション'
		},
		{
			pattern: /コミニュケーション/g,
			message: '「コミュニケーション」の誤字です',
			suggestion: 'コミュニケーション'
		}
	];

	for (const { pattern, message, suggestion } of typoPatterns) {
		pattern.lastIndex = 0;
		let match;
		while ((match = pattern.exec(text)) !== null) {
			issues.push({
				type: 'typo',
				severity: 'warning',
				message,
				position: { start: match.index, end: match.index + match[0].length },
				suggestion,
				original: match[0]
			});
		}
	}

	return issues;
}

/**
 * 冗長な表現をチェック
 */
function checkRedundancy(text: string): ProofreadingIssue[] {
	const issues: ProofreadingIssue[] = [];

	const redundancyPatterns: Array<{
		pattern: RegExp;
		message: string;
		suggestion: string;
	}> = [
		{ pattern: /することができる/g, message: '冗長な表現です', suggestion: 'できる' },
		{
			pattern: /(?:まさに|本当に|実に|非常に)(?:まさに|本当に|実に|非常に)/g,
			message: '強調語が重複しています',
			suggestion: ''
		}
	];

	for (const { pattern, message, suggestion } of redundancyPatterns) {
		pattern.lastIndex = 0;
		let match;
		while ((match = pattern.exec(text)) !== null) {
			issues.push({
				type: 'redundancy',
				severity: 'info',
				message,
				position: { start: match.index, end: match.index + match[0].length },
				suggestion,
				original: match[0]
			});
		}
	}

	return issues;
}

/**
 * 文体・スタイルをチェック
 */
function checkStyle(text: string): ProofreadingIssue[] {
	const issues: ProofreadingIssue[] = [];

	// 文を「。！？」区切りで取り出す(位置は元の文章の文字位置)
	const sentences: Array<{ text: string; start: number; end: number }> = [];
	const sentencePattern = /[^。！？\n]+[。！？]?/g;
	let sm;
	while ((sm = sentencePattern.exec(text)) !== null) {
		const trimmed = sm[0].trim();
		if (!trimmed) continue;
		const start = sm.index + sm[0].indexOf(trimmed);
		sentences.push({ text: trimmed, start, end: start + trimmed.length });
	}

	// 同じ語尾の連続(台詞の閉じ括弧は除いて比較する)
	const tail = (t: string) => t.replace(/[。！？」』）)\s]+$/g, '').slice(-2);
	for (let i = 0; i + 2 < sentences.length; i++) {
		const e0 = tail(sentences[i].text);
		if (
			e0.length === 2 &&
			e0 === tail(sentences[i + 1].text) &&
			e0 === tail(sentences[i + 2].text)
		) {
			issues.push({
				type: 'style',
				severity: 'info',
				message: `同じ語尾「${e0}」が3文続いています`,
				position: { start: sentences[i + 2].start, end: sentences[i + 2].end },
				original: sentences[i + 2].text
			});
		}
	}

	// 長すぎる文
	for (const sentence of sentences) {
		if (sentence.text.length > 100) {
			issues.push({
				type: 'style',
				severity: 'info',
				message: '文が長すぎます。分割を検討してください',
				position: { start: sentence.start, end: sentence.end },
				original: sentence.text
			});
		}
	}

	// ら抜き言葉
	const raPattern = /(?:見|食べ|考え|信じ|着|起き|受け|答え|教え|捨て)れる/g;
	let match;
	while ((match = raPattern.exec(text)) !== null) {
		issues.push({
			type: 'style',
			severity: 'info',
			message: 'ら抜き言葉の可能性があります',
			position: { start: match.index, end: match.index + match[0].length },
			suggestion: match[0].replace(/れる$/, 'られる'),
			original: match[0]
		});
	}

	return issues;
}

/**
 * 文法をチェック
 */
function checkGrammar(text: string): ProofreadingIssue[] {
	const issues: ProofreadingIssue[] = [];

	// 助詞の重複
	const particlePattern = /([をにへ])\1+/g;
	let match;
	while ((match = particlePattern.exec(text)) !== null) {
		issues.push({
			type: 'grammar',
			severity: 'warning',
			message: '助詞が重複しています',
			position: { start: match.index, end: match.index + match[0].length },
			original: match[0]
		});
	}

	// スペースの連続
	// 改行や行頭の字下げ(全角スペース)は対象外。文中の連続した半角スペース/タブだけ
	const spacePattern = /(?<=\S)[ \t]{2,}/g;
	while ((match = spacePattern.exec(text)) !== null) {
		issues.push({
			type: 'grammar',
			severity: 'warning',
			message: '不要なスペースが連続しています',
			position: { start: match.index, end: match.index + match[0].length },
			original: match[0],
			suggestion: ' '
		});
	}

	// カタカナ表記の揺れ
	const katakanaPairs = [
		['コンピュータ', 'コンピューター'],
		['サーバ', 'サーバー'],
		['ユーザ', 'ユーザー'],
		['エディタ', 'エディター']
	];

	for (const [short, long] of katakanaPairs) {
		// 「サーバ」は「サーバー」の一部なので、長音が続かない場合だけを短い表記として数える
		const shortPattern = new RegExp(`${short}(?!ー)`);
		if (shortPattern.test(text) && text.includes(long)) {
			const position = text.indexOf(long);
			issues.push({
				type: 'style',
				severity: 'info',
				message: `「${short}」と「${long}」の表記揺れがあります`,
				position: { start: position, end: position + long.length },
				original: long,
				suggestion: short
			});
		}
	}

	return issues;
}

/**
 * 校閲結果のサマリーを取得
 */
export function getProofreadingSummary(issues: ProofreadingIssue[]): {
	total: number;
	byType: Record<string, number>;
	bySeverity: Record<string, number>;
} {
	const byType: Record<string, number> = {};
	const bySeverity: Record<string, number> = {};

	for (const issue of issues) {
		byType[issue.type] = (byType[issue.type] || 0) + 1;
		bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
	}

	return {
		total: issues.length,
		byType,
		bySeverity
	};
}

/**
 * 校閲結果を適用してテキストを修正
 */
export function applyProofreadingSuggestion(text: string, issue: ProofreadingIssue): string {
	if (!issue.suggestion) {
		return text;
	}

	return (
		text.substring(0, issue.position.start) + issue.suggestion + text.substring(issue.position.end)
	);
}

/**
 * すべての修正候補を適用
 */
export function applyAllSuggestions(text: string, issues: ProofreadingIssue[]): string {
	let result = text;

	// 後ろから適用することで位置がずれないようにする
	const sortedIssues = [...issues]
		.filter((issue) => issue.suggestion)
		.sort((a, b) => b.position.start - a.position.start);

	// 範囲が重なる指摘(辞書の語が互いに含み合う場合など)は、後ろのものだけを適用して、本文を壊さない
	let appliedFrom = Infinity;
	for (const issue of sortedIssues) {
		if (issue.position.end > appliedFrom) continue;
		result = applyProofreadingSuggestion(result, issue);
		appliedFrom = issue.position.start;
	}

	return result;
}
