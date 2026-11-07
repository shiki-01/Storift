/** バイト数を MB で表す(例: 12.3)。進捗の「12.3 / 45.6 MB」用 */
export function formatMegabytes(bytes: number): string {
	return (bytes / (1024 * 1024)).toFixed(1);
}

/** 「12.3 / 45.6 MB」。全体のサイズが分からないときは「12.3 MB」 */
export function formatByteProgress(received: number, total: number | null): string {
	if (total && total > 0) return `${formatMegabytes(received)} / ${formatMegabytes(total)} MB`;
	return `${formatMegabytes(received)} MB`;
}
