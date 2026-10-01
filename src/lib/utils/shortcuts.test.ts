import { describe, it, expect } from 'vitest';
import { matchesShortcut } from './shortcuts';

const ev = (init: Partial<Parameters<typeof matchesShortcut>[0]>) => ({
	key: '',
	code: '',
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...init
});

describe('matchesShortcut', () => {
	it('Ctrl+S に一致する', () => {
		expect(matchesShortcut(ev({ key: 's', ctrlKey: true }), 'Ctrl+S')).toBe(true);
	});
	it('Meta でも Ctrl 扱いになる', () => {
		expect(matchesShortcut(ev({ key: 's', metaKey: true }), 'Ctrl+S')).toBe(true);
	});
	it('修飾キーが余分なら一致しない', () => {
		expect(matchesShortcut(ev({ key: 's', ctrlKey: true, shiftKey: true }), 'Ctrl+S')).toBe(false);
	});
	it('Shift 併用で大文字になっても一致する', () => {
		expect(matchesShortcut(ev({ key: 'C', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+C')).toBe(
			true
		);
	});
	it('Alt 併用で key が変わっても code で一致する', () => {
		expect(
			matchesShortcut(ev({ key: 'ñ', code: 'KeyN', ctrlKey: true, altKey: true }), 'Ctrl+Alt+N')
		).toBe(true);
	});
	it('未設定は一致しない', () => {
		expect(matchesShortcut(ev({ key: 's', ctrlKey: true }), undefined)).toBe(false);
	});
});
