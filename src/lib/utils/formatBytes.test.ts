import { describe, expect, it } from 'vitest';
import { formatByteProgress, formatMegabytes } from './formatBytes';

describe('formatBytes', () => {
	it('MB を小数 1 桁で表す', () => {
		expect(formatMegabytes(0)).toBe('0.0');
		expect(formatMegabytes(12.3 * 1024 * 1024)).toBe('12.3');
	});

	it('全体のサイズがあれば「受信 / 全体 MB」にする', () => {
		const mb = 1024 * 1024;
		expect(formatByteProgress(12.3 * mb, 45.6 * mb)).toBe('12.3 / 45.6 MB');
	});

	it('全体のサイズが分からなければ受信分だけにする', () => {
		expect(formatByteProgress(1024 * 1024, null)).toBe('1.0 MB');
		expect(formatByteProgress(1024 * 1024, 0)).toBe('1.0 MB');
	});
});
