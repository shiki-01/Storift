/**
 * エラーレポートの生成・共有
 * 外部の送信先は持たず、コピー・メール作成・ファイル保存でユーザー自身が共有できる形にする
 */

import { getErrorLogs } from './errorHandler';

export interface ErrorReportInput {
	status: number;
	message: string;
	/** クエリやハッシュを含まないパス */
	path: string;
	/** 開発者向けの詳細（スタックなど） */
	detail?: unknown;
}

const MAILTO_BODY_LIMIT = 1500;

export function buildErrorReport(input: ErrorReportInput): string {
	const lines = [
		'Storift エラーレポート',
		`日時: ${new Date().toISOString()}`,
		`ステータス: ${input.status}`,
		`メッセージ: ${input.message}`,
		`パス: ${input.path}`,
		`ブラウザ: ${typeof navigator !== 'undefined' ? navigator.userAgent : '不明'}`
	];

	if (input.detail !== undefined) {
		lines.push('', '詳細:', safeStringify(input.detail));
	}

	const logs = getErrorLogs().slice(0, 5);
	if (logs.length > 0) {
		lines.push('', '直近のエラーログ:');
		for (const log of logs) {
			lines.push(
				`- ${new Date(log.timestamp).toISOString()} [${log.type}] ${log.message}`,
				...(log.stack ? [`  ${log.stack.split('\n').slice(0, 3).join('\n  ')}`] : [])
			);
		}
	}

	return lines.join('\n');
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

export async function copyErrorReport(report: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(report);
		return true;
	} catch {
		return false;
	}
}

export function downloadErrorReport(report: string): void {
	const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `storift-error-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
	a.click();
	URL.revokeObjectURL(url);
}

/** 宛先は空のまま、メールアプリで件名と本文を入れた状態で開く（本文は長すぎると開けないため切り詰める） */
export function buildMailtoUrl(report: string): string {
	const body =
		report.length > MAILTO_BODY_LIMIT
			? `${report.slice(0, MAILTO_BODY_LIMIT)}\n…（長いため省略。ファイル保存した全文を添付してください）`
			: report;
	return `mailto:?subject=${encodeURIComponent('Storift エラーレポート')}&body=${encodeURIComponent(body)}`;
}
