import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import ProgressBar from './ProgressBar.svelte';

afterEach(() => cleanup());

describe('ProgressBar', () => {
	it('割合に応じた aria 属性と幅、文字を出す', () => {
		render(ProgressBar, { value: 0.42, label: 'ダウンロード中', detail: '12.3 / 45.6 MB' });
		const bar = screen.getByRole('progressbar', { name: 'ダウンロード中' });
		expect(bar.getAttribute('aria-valuemin')).toBe('0');
		expect(bar.getAttribute('aria-valuemax')).toBe('100');
		expect(bar.getAttribute('aria-valuenow')).toBe('42');
		expect((bar.firstElementChild as HTMLElement).style.width).toBe('42%');
		expect(screen.getByText('42% ・ 12.3 / 45.6 MB')).toBeTruthy();
	});

	it('範囲外の値は 0〜100% に収める', () => {
		render(ProgressBar, { value: 3 });
		expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
		cleanup();
		render(ProgressBar, { value: -1 });
		expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
	});

	it('null は不確定表示(aria-valuenow なし、割合の文字なし)', () => {
		render(ProgressBar, { value: null, label: '準備中', detail: '1.0 MB' });
		const bar = screen.getByRole('progressbar');
		expect(bar.hasAttribute('aria-valuenow')).toBe(false);
		expect(bar.classList.contains('indeterminate')).toBe(true);
		expect(screen.queryByText(/%/)).toBeNull();
		expect(screen.getByText('1.0 MB')).toBeTruthy();
	});

	it('showText=false なら文字を出さない', () => {
		render(ProgressBar, { value: 0.5, showText: false });
		expect(screen.queryByTestId('progress-bar-text')).toBeNull();
	});
});
