/**
 * HTTP 系プロバイダのエラー。利用者に見せる日本語のメッセージに分類する。
 * API キーはメッセージに含めない(サーバーの返した本文からも伏せる)。
 */

export type AiErrorKind =
	| 'auth'
	| 'not-found'
	| 'rate-limit'
	| 'bad-request'
	| 'server'
	| 'redirect'
	| 'network'
	| 'timeout'
	| 'invalid-response'
	| 'config';

export class AiHttpError extends Error {
	constructor(
		readonly kind: AiErrorKind,
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'AiHttpError';
	}
}

/** 利用者が中断した(エラーとして見せない) */
export class AiAbortError extends Error {
	constructor() {
		super('中断しました');
		this.name = 'AiAbortError';
	}
}

const BODY_LIMIT = 200;

/** メッセージから API キーらしい文字列を伏せる(渡されたキー本体と、sk-… などの一般的な形) */
export function redact(text: string, secrets: readonly (string | undefined)[] = []): string {
	let out = text;
	for (const s of secrets) {
		if (s && s.length >= 4) out = out.split(s).join('***');
	}
	return out
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
		.replace(/\b(sk|gsk|key|AIza)[-_A-Za-z0-9]{16,}/g, '***');
}

/** エラー応答の本文から、サーバーが書いた理由だけを取り出す({"error": {"message": …}} など) */
export function extractServerMessage(body: string): string {
	const text = body.trim();
	if (!text) return '';
	try {
		const json = JSON.parse(text) as unknown;
		const rec = json as Record<string, unknown> | null;
		const err = rec?.error;
		const message =
			typeof err === 'string'
				? err
				: typeof (err as Record<string, unknown> | undefined)?.message === 'string'
					? ((err as Record<string, unknown>).message as string)
					: typeof rec?.message === 'string'
						? (rec.message as string)
						: '';
		if (message) return message;
	} catch {
		// JSON でなければ本文をそのまま使う
	}
	// HTML のエラーページなどは見せない
	if (/^\s*</.test(text)) return '';
	return text;
}

/**
 * HTTP のエラー応答を分類する。
 * @param label 画面に出すサービス名(例: OpenAI 互換 API)
 * @param secrets 伏せたい文字列(API キー)
 */
export function classifyHttpError(
	status: number,
	body: string,
	label: string,
	secrets: readonly (string | undefined)[] = []
): AiHttpError {
	let detail = redact(extractServerMessage(body), secrets).replace(/\s+/g, ' ').trim();
	if (detail.length > BODY_LIMIT) detail = detail.slice(0, BODY_LIMIT) + '…';
	const tail = detail ? `(${detail})` : '';

	if (status === 401 || status === 403)
		return new AiHttpError(
			'auth',
			`${label}の認証に失敗しました(${status})。API キーが正しいか、利用が許可されているかを確認してください。${tail}`,
			status
		);
	if (status === 404)
		return new AiHttpError(
			'not-found',
			`${label}が見つかりません(404)。Base URL とモデル名を確認してください。${tail}`,
			status
		);
	if (status === 429)
		return new AiHttpError(
			'rate-limit',
			`${label}のレート制限に達しました(429)。しばらく待ってから送り直してください。残高や利用枠も確認してください。${tail}`,
			status
		);
	if (status === 400 || status === 422)
		return new AiHttpError(
			'bad-request',
			`${label}がリクエストを受け付けませんでした(${status})。モデルがツール呼び出しに対応しているか確認してください。${tail}`,
			status
		);
	if (status >= 500)
		return new AiHttpError(
			'server',
			`${label}側でエラーが起きました(${status})。時間をおいて送り直してください。${tail}`,
			status
		);
	if (status >= 300 && status < 400)
		return new AiHttpError(
			'redirect',
			`${label}がリダイレクト(${status})を返しました。Base URL を確認してください。`,
			status
		);
	return new AiHttpError('bad-request', `${label}がエラー(${status})を返しました。${tail}`, status);
}
