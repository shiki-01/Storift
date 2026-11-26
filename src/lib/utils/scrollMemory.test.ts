import { beforeEach, describe, expect, it } from 'vitest';
import { persistScroll, recallScroll, rememberScroll, resetScrollMemory } from './scrollMemory';

describe('scrollMemory', () => {
	beforeEach(() => {
		sessionStorage.clear();
		resetScrollMemory();
	});

	it('キーごとに位置を覚える', () => {
		rememberScroll('a', 120.4);
		rememberScroll('b', 30);
		expect(recallScroll('a')).toBe(120);
		expect(recallScroll('b')).toBe(30);
		expect(recallScroll('c')).toBeUndefined();
	});

	it('sessionStorage に書き出した位置を読み直せる', () => {
		rememberScroll('a', 500);
		persistScroll();
		resetScrollMemory();
		expect(recallScroll('a')).toBe(500);
	});

	it('負の値は 0 にする', () => {
		rememberScroll('a', -10);
		expect(recallScroll('a')).toBe(0);
	});
});
