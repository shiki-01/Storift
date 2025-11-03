/**
 * 文章校閲ユーティリティ
 */

export interface ProofreadingIssue {
	type: 'typo' | 'redundancy' | 'style' | 'grammar' | 'suggestion';
	severity: 'error' | 'warning' | 'info';
	message: string;
	position: { start: number; end: number };
	suggestion?: string;
	original: string;
}

/**
 * 文章をチェック
 */
export function proofread(text: string): ProofreadingIssue[] {
	const issues: ProofreadingIssue[] = [];

	// 各種チェックを実行
	issues.push(...checkTypos(text));
	issues.push(...checkRedundancy(text));
	issues.push(...checkStyle(text));
	issues.push(...checkGrammar(text));

	// 位置でソート
	issues.sort((a, b) => a.position.start - b.position.start);

	return issues;
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
		{ pattern: /以外/g, message: '「意外」の誤字の可能性があります', suggestion: '意外' },
		{ pattern: /意外と/g, message: '「案外」の方が自然かもしれません', suggestion: '案外' },
		{ pattern: /雰囲気/g, message: '「ふんいき」は「ふいんき」と誤読されやすいです', suggestion: '雰囲気' },
		{ pattern: /延々と/g, message: '「永遠と」の誤用ではありませんか？', suggestion: '延々と' },
		{ pattern: /永遠と/g, message: '「延々と」の誤用です', suggestion: '延々と' },
		{ pattern: /シュミレーション/g, message: '「シミュレーション」の誤字です', suggestion: 'シミュレーション' },
		{ pattern: /コミニュケーション/g, message: '「コミュニケーション」の誤字です', suggestion: 'コミュニケーション' }
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
		{ pattern: /という(?:こと|もの)/g, message: '冗長な表現の可能性があります', suggestion: '' },
		{ pattern: /(?:まさに|本当に|実に|非常に)(?:まさに|本当に|実に|非常に)/g, message: '強調語が重複しています', suggestion: '' },
		{ pattern: /だと思います(?:が|けど|けれど)/g, message: '「思う」の後に逆接は不自然です', suggestion: '' },
		{ pattern: /(?:私は|僕は|俺は).+(?:私は|僕は|俺は)/g, message: '一人称が重複しています', suggestion: '' }
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

	// 同じ語尾の連続
	const sentences = text.split(/[。！？]/);
	for (let i = 0; i < sentences.length - 2; i++) {
		const endings = sentences.slice(i, i + 3).map((s) => {
			const trimmed = s.trim();
			return trimmed.slice(-2);
		});

		if (endings[0] === endings[1] && endings[1] === endings[2]) {
			const position = sentences.slice(0, i + 2).join('。').length;
			issues.push({
				type: 'style',
				severity: 'info',
				message: '同じ語尾が3回連続しています',
				position: { start: position, end: position + sentences[i + 2].length },
				original: sentences[i + 2]
			});
		}
	}

	// 長すぎる文
	for (const sentence of sentences) {
		if (sentence.length > 100) {
			const position = text.indexOf(sentence);
			issues.push({
				type: 'style',
				severity: 'info',
				message: '文が長すぎます。分割を検討してください',
				position: { start: position, end: position + sentence.length },
				original: sentence
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
	const particlePattern = /([をにがはへとより])\1+/g;
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
	const spacePattern = /\s{2,}/g;
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
		if (text.includes(short) && text.includes(long)) {
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
export function applyProofreadingSuggestion(
	text: string,
	issue: ProofreadingIssue
): string {
	if (!issue.suggestion) {
		return text;
	}

	return (
		text.substring(0, issue.position.start) +
		issue.suggestion +
		text.substring(issue.position.end)
	);
}

/**
 * すべての修正候補を適用
 */
export function applyAllSuggestions(
	text: string,
	issues: ProofreadingIssue[]
): string {
	let result = text;
	
	// 後ろから適用することで位置がずれないようにする
	const sortedIssues = [...issues]
		.filter((issue) => issue.suggestion)
		.sort((a, b) => b.position.start - a.position.start);

	for (const issue of sortedIssues) {
		result = applyProofreadingSuggestion(result, issue);
	}

	return result;
}
