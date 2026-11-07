import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import IconBadge from './IconBadge.svelte';

afterEach(() => cleanup());

// 幅と高さは同じ値(--size)で固定される。楕円にならないことは E2E(plot.spec.mjs)で実寸を測っている
describe('IconBadge', () => {
	it('円と四角で形を切り替え、一辺の長さを CSS 変数で渡す', () => {
		const { container } = render(IconBadge, { size: 44, shape: 'square', icon: 'book-2' });
		const el = container.firstElementChild as HTMLElement;
		expect(el.dataset.shape).toBe('square');
		expect(el.style.getPropertyValue('--size')).toBe('44px');
		cleanup();
		const circle = render(IconBadge, { text: '田中太郎' }).container
			.firstElementChild as HTMLElement;
		expect(circle.dataset.shape).toBe('circle');
		expect(circle.style.getPropertyValue('--size')).toBe('40px');
	});

	it('文字は先頭の 2 文字だけ、装飾なら読み上げから外す', () => {
		const { container } = render(IconBadge, { text: '田中太郎' });
		expect(container.textContent).toBe('田中');
		expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
	});

	it('label があれば画像として名前を持つ', () => {
		render(IconBadge, { text: 'A', label: '主人公' });
		expect(screen.getByRole('img', { name: '主人公' })).toBeTruthy();
	});
});
