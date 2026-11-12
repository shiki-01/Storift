import type * as Y from 'yjs';

/**
 * 執筆文字数の集計(共同編集のシーン用)。
 * 自分の編集(origin がリモート・復元以外)だけを数え、他者の変更は数えない。
 * 既存の記録(保存ごとの「増えた分のみ」)に合わせ、take() は純増分が正のときだけその値を返してリセットする。
 */

/** 数えない origin(リモートから届いた変更、保存済みの状態の読み込み、検索置換・復元などプログラムによる書き換え) */
const NON_LOCAL_ORIGINS = new Set<unknown>(['remote', 'restore', 'program']);

export interface LocalGrowthTracker {
	/** これまでの純増分(負・0 のときは 0)を返し、集計をリセットする */
	take(): number;
	/** リセットせずに現在の純増分を返す */
	peek(): number;
	dispose(): void;
}

export function trackLocalGrowth(ytext: Y.Text): LocalGrowthTracker {
	let net = 0;
	const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
		if (NON_LOCAL_ORIGINS.has(transaction.origin)) return;
		for (const op of event.delta) {
			if (typeof op.insert === 'string') net += op.insert.length;
			else if (typeof op.delete === 'number') net -= op.delete;
		}
	};
	ytext.observe(observer);
	return {
		peek: () => Math.max(0, net),
		take() {
			const value = Math.max(0, net);
			net = 0;
			return value;
		},
		dispose: () => ytext.unobserve(observer)
	};
}
