/**
 * デバウンス関数: 連続した呼び出しを遅延させ、最後の呼び出しのみ実行する
 */
export function debounce<A extends unknown[]>(
	func: (...args: A) => unknown,
	wait: number
): (...args: A) => void {
	let timeout: NodeJS.Timeout | null = null;

	return function (...args: A) {
		if (timeout) {
			clearTimeout(timeout);
		}

		timeout = setTimeout(() => {
			func(...args);
			timeout = null;
		}, wait);
	};
}

/**
 * デバウンス関数（Promise版）: 連続した呼び出しを遅延させ、最後の呼び出しのみ実行する。
 * 待機中の呼び出しはすべて同一の Promise を共有し、実行の完了（またはエラー）で全員が解決される。
 */
export function debounceAsync<A extends unknown[], R>(
	func: (...args: A) => Promise<R>,
	wait: number
): (...args: A) => Promise<R> {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	let shared: Promise<R> | null = null;
	let settle: { resolve: (value: R) => void; reject: (reason: unknown) => void } | null = null;

	return function (...args: A): Promise<R> {
		if (timeout) {
			clearTimeout(timeout);
		}

		if (!shared) {
			shared = new Promise<R>((resolve, reject) => {
				settle = { resolve, reject };
			});
		}
		const current = shared;

		timeout = setTimeout(() => {
			// 実行中に届いた呼び出しは次のバッチとして扱う
			const handlers = settle!;
			timeout = null;
			shared = null;
			settle = null;
			// func が同期的に throw した場合も reject にする
			Promise.resolve()
				.then(() => func(...args))
				.then(handlers.resolve, handlers.reject);
		}, wait);

		return current;
	};
}
