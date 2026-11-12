/**
 * パックの校正の辞書(表記ゆれ)を、本文に当てはめる。
 *
 * 規則は固定の文字列(from)の出現を探すだけで、正規表現は使えない。ReDoS の余地が無く、
 * 規則の数・長さにも上限がある(pack.ts の PACK_LIMITS)。念のため、実行時間の打ち切りも持つ。
 */
import type { PackProofreadRule } from './pack';

/** 有効なパックの辞書 1 つ分 */
export interface PackRuleSource {
	packId: string;
	packName: string;
	/** 辞書の名前 */
	setName: string;
	rules: PackProofreadRule[];
}

export interface PackRuleMatch {
	start: number;
	end: number;
	original: string;
	suggestion: string;
	message: string;
	packId: string;
}

/** 検索にかけてよい時間(ミリ秒)。超えたら、それまでに見つけた分で打ち切る */
export const RULE_TIME_BUDGET_MS = 100;
/** 返す指摘の最大数 */
export const RULE_MATCH_LIMIT = 500;

export interface FindOptions {
	budgetMs?: number;
	limit?: number;
	now?: () => number;
}

/** 辞書の規則に当てはまる箇所を探す(位置の昇順) */
export function findRuleMatches(
	text: string,
	sources: readonly PackRuleSource[],
	options: FindOptions = {}
): PackRuleMatch[] {
	const budget = options.budgetMs ?? RULE_TIME_BUDGET_MS;
	const limit = options.limit ?? RULE_MATCH_LIMIT;
	const now = options.now ?? (() => performance.now());
	const startedAt = now();
	const matches: PackRuleMatch[] = [];

	outer: for (const source of sources) {
		for (const rule of source.rules) {
			if (now() - startedAt > budget) break outer;
			let from = 0;
			for (;;) {
				const index = text.indexOf(rule.from, from);
				if (index < 0) break;
				matches.push({
					start: index,
					end: index + rule.from.length,
					original: rule.from,
					suggestion: rule.to,
					message:
						rule.message ??
						(rule.to === ''
							? `「${rule.from}」は使わない表記です(${source.setName})`
							: `「${rule.from}」は「${rule.to}」と書きます(${source.setName})`),
					packId: source.packId
				});
				if (matches.length >= limit) break outer;
				from = index + rule.from.length;
			}
		}
	}
	return matches.sort((a, b) => a.start - b.start || b.end - a.end);
}
