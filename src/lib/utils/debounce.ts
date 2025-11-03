/**
 * デバウンス関数: 連続した呼び出しを遅延させ、最後の呼び出しのみ実行する
 */
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: NodeJS.Timeout | null = null;

	return function (...args: Parameters<T>) {
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
export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
	func: T,
	wait: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
	let timeout: NodeJS.Timeout | null = null;
	let resolve: ((value: any) => void) | null = null;

	return function (...args: Parameters<T>): Promise<ReturnType<T>> {
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
