import { describe, it, expect } from 'vitest';
import {
	DEFAULT_SHORTCUTS,
	eventToShortcut,
	findConflicts,
	matchesShortcut,
	migrateShortcuts,
	normalizeAutoSaveMs,
	normalizeShortcut
} from './shortcuts';

const key = (
	k: string,
	mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}
) => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	altKey: false,
	...mods
});

describe('eventToShortcut', () => {
	it('修飾キー付きのキーを正規化する', () => {
		expect(eventToShortcut(key('s', { ctrlKey: true }))).toBe('Ctrl+S');
		expect(eventToShortcut(key('F', { metaKey: true, shiftKey: true }))).toBe('Ctrl+Shift+F');
		expect(eventToShortcut(key('n', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+N');
	});

	it('修飾キーだけ、修飾キーなしの単独キーは対象外', () => {
		expect(eventToShortcut(key('Control', { ctrlKey: true }))).toBeNull();
		expect(eventToShortcut(key('a'))).toBeNull();
		expect(eventToShortcut(key('a', { shiftKey: true }))).toBeNull();
	});
});

describe('normalizeShortcut / matchesShortcut', () => {
	it('表記ゆれを揃える', () => {
		expect(normalizeShortcut('cmd+shift+f')).toBe('Ctrl+Shift+F');
		expect(normalizeShortcut('Shift+Ctrl+f')).toBe('Ctrl+Shift+F');
	});

	it('イベントが割り当てと一致するか判定する', () => {
		expect(matchesShortcut(key('s', { metaKey: true }), 'Ctrl+S')).toBe(true);
		expect(matchesShortcut(key('s', { ctrlKey: true, shiftKey: true }), 'Ctrl+S')).toBe(false);
	});
});

describe('findConflicts', () => {
	it('重複した割り当てを検出する', () => {
		const conflicts = findConflicts({ ...DEFAULT_SHORTCUTS, replace: 'ctrl+s' });
		expect(conflicts).toEqual([['save', 'replace']]);
	});

	it('既定値には重複がない', () => {
		expect(findConflicts(DEFAULT_SHORTCUTS)).toEqual([]);
	});
});

describe('migrateShortcuts', () => {
	it('旧既定値(Ctrl+F / Ctrl+H)は新しい既定値へ移す', () => {
		const migrated = migrateShortcuts({ find: 'Ctrl+F', replace: 'Ctrl+H' });
		expect(migrated.find).toBe('Ctrl+Shift+F');
		expect(migrated.replace).toBe('Ctrl+Shift+H');
	});

	it('ユーザーが変更した値は保つ', () => {
		expect(migrateShortcuts({ find: 'Ctrl+Alt+F' }).find).toBe('Ctrl+Alt+F');
	});

	it('未保存なら既定値', () => {
		expect(migrateShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS);
	});
});

describe('normalizeAutoSaveMs', () => {
	it('秒表記(旧データ)をミリ秒に直し、範囲に収める', () => {
		expect(normalizeAutoSaveMs(30)).toBe(30000);
		expect(normalizeAutoSaveMs(30000)).toBe(30000);
		expect(normalizeAutoSaveMs(1)).toBe(5000);
		expect(normalizeAutoSaveMs(999999)).toBe(300000);
		expect(normalizeAutoSaveMs(undefined)).toBe(30000);
	});
});
