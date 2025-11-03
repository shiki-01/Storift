import { describe, it, expect, beforeEach } from 'vitest';
import { countCharacters, countWords, countLines } from './textUtils';

describe('textUtils', () => {
	describe('countCharacters', () => {
		it('should count characters correctly', () => {
			expect(countCharacters('こんにちは')).toBe(5);
			expect(countCharacters('Hello World')).toBe(11);
			expect(countCharacters('')).toBe(0);
		});

		it('should handle line breaks', () => {
			expect(countCharacters('行1\n行2')).toBe(5);
		});

		it('should exclude spaces when specified', () => {
			expect(countCharacters('こんにちは 世界', true)).toBe(7);
			expect(countCharacters('こんにちは 世界', false)).toBe(8);
		});
	});

	describe('countWords', () => {
		it('should count Japanese words correctly', () => {
			expect(countWords('これは日本語の文章です')).toBeGreaterThan(0);
		});

		it('should count English words correctly', () => {
			expect(countWords('This is a test')).toBe(4);
		});

		it('should handle empty string', () => {
			expect(countWords('')).toBe(0);
		});

		it('should handle mixed content', () => {
			expect(countWords('Hello こんにちは World')).toBeGreaterThan(0);
		});
	});

	describe('countLines', () => {
		it('should count lines correctly', () => {
			expect(countLines('行1\n行2\n行3')).toBe(3);
			expect(countLines('単一行')).toBe(1);
			expect(countLines('')).toBe(0);
		});

		it('should handle different line breaks', () => {
			expect(countLines('行1\r\n行2\r\n行3')).toBe(3);
		});
	});
});
