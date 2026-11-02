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
 * デバウンス関数（Promise版）: 連続した呼び出しを遅延させ、最後の呼び出しのみ実行する
 */
export function debounceAsync<A extends unknown[], R>(
	func: (...args: A) => Promise<R>,
	wait: number
): (...args: A) => Promise<R> {
	let timeout: NodeJS.Timeout | null = null;
	let resolve: ((value: R) => void) | null = null;

	return function (...args: A): Promise<R> {
		return new Promise((res) => {
			if (timeout) {
				clearTimeout(timeout);
			}

			resolve = res;

			timeout = setTimeout(async () => {
				const result = await func(...args);
				if (resolve) {
					resolve(result);
				}
				timeout = null;
				resolve = null;
			}, wait);
		});
	};
}
