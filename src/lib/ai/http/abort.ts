/** 中断とタイムアウトをまとめて扱う */
import { AiAbortError, AiHttpError } from './errors';

export interface LinkedTimeout {
	/** fetch に渡す signal(利用者の中断とタイムアウトのどちらでも中断される) */
	signal: AbortSignal;
	timedOut(): boolean;
	/** タイマーを止める(必ず呼ぶ) */
	dispose(): void;
}

/** 親の signal が中断されるか、ms が経ったら中断される signal を作る */
export function linkTimeout(parent: AbortSignal, ms: number): LinkedTimeout {
	const controller = new AbortController();
	let fired = false;
	const onParent = () => controller.abort(parent.reason);
	if (parent.aborted) controller.abort(parent.reason);
	else parent.addEventListener('abort', onParent, { once: true });
	const timer = setTimeout(() => {
		fired = true;
		controller.abort(new Error('timeout'));
	}, ms);
	return {
		signal: controller.signal,
		timedOut: () => fired,
		dispose: () => {
			clearTimeout(timer);
			parent.removeEventListener('abort', onParent);
		}
	};
}

/**
 * fetch や読み取りで投げられた例外を、中断・タイムアウト・通信エラーに仕分ける。
 * 分類済みのエラー(AiHttpError など)はそのまま返す。
 */
export function translateFetchError(
	error: unknown,
	parent: AbortSignal,
	timeout: LinkedTimeout,
	label: string,
	ms: number,
	redactText: (s: string) => string = (s) => s
): Error {
	if (parent.aborted) return new AiAbortError();
	if (timeout.timedOut())
		return new AiHttpError(
			'timeout',
			`${label}からの応答が${Math.round(ms / 1000)}秒以内に完了しませんでした(タイムアウト)。`
		);
	if (error instanceof AiHttpError || error instanceof AiAbortError) return error;
	const detail = redactText(error instanceof Error ? error.message : String(error));
	return new AiHttpError(
		'network',
		`${label}に接続できませんでした。ネットワークと Base URL を確認してください。(${detail})`
	);
}
