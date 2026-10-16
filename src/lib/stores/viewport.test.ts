import { describe, it, expect } from 'vitest';
import { computeKeyboardHeight } from './viewport.svelte';

describe('computeKeyboardHeight', () => {
	it('アドレスバーの伸縮程度ではキーボードとみなさない', () => {
		expect(computeKeyboardHeight(800, 760, 0)).toBe(0);
	});

	it('十分な差があればキーボードの高さを返す', () => {
		expect(computeKeyboardHeight(800, 480, 0)).toBe(320);
	});

	it('visualViewport がスクロールしている場合は offsetTop を差し引く', () => {
		expect(computeKeyboardHeight(800, 480, 100)).toBe(220);
	});
});
