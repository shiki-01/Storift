/**
 * 非同期処理の制御用ユーティリティ(排他・タイムアウト・並列数の制限)
 */

/**
 * 単純な非同期ミューテックス。runExclusive に渡した処理は、呼び出し順に1つずつ実行される。
 * 処理が失敗しても次の処理は実行される(ロックは必ず解放される)。
 */
export class Mutex {
	private tail: Promise<void> = Promise.resolve();
	private waiting = 0;

	/** 実行中または待機中の処理があるか */
	get isLocked(): boolean {
		return this.waiting > 0;
	}

	runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		this.waiting++;
		const result = this.tail.then(fn);
		this.tail = result.then(
			() => {
				this.waiting--;
			},
			() => {
				this.waiting--;
			}
		);
		return result;
	}
}

/** withTimeout が超過時に投げるエラー(Firestore の deadline-exceeded と同じコードを持つ) */
export class TimeoutError extends Error {
	readonly code = 'deadline-exceeded';
	constructor(label: string, ms: number) {
		super(`${label}が${Math.round(ms / 1000)}秒以内に完了しませんでした`);
		this.name = 'TimeoutError';
	}
}

/**
 * promise が ms 以内に決着しなければ TimeoutError で reject する。
 * 元の処理自体は中断されない(onTimeout で打ち切りフラグを立てるなど、呼び出し側で対処する)。
 */
export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
	onTimeout?: () => void
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			onTimeout?.();
			reject(new TimeoutError(label, ms));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

/**
 * 並列数を limit に制限して fn を適用する。1件の失敗で他を止めず、結果は入力順の settled で返す。
 */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
	const results = new Array<PromiseSettledResult<R>>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			try {
				results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
			} catch (reason) {
				results[index] = { status: 'rejected', reason };
			}
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
	return results;
}
