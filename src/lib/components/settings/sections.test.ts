import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SECTION_ID,
	LEGACY_SECTION_HASHES,
	SETTINGS_SECTIONS,
	resolveSection,
	sectionHash,
	visibleSections
} from './sections';

describe('設定のセクション定義', () => {
	it('ID が重複しない', () => {
		const ids = SETTINGS_SECTIONS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('先頭のセクションが既定のセクション', () => {
		expect(SETTINGS_SECTIONS[0].id).toBe(DEFAULT_SECTION_ID);
		expect(visibleSections(false)[0].id).toBe(DEFAULT_SECTION_ID);
	});

	it('Web 版ではデスクトップ専用のセクションを除く', () => {
		expect(visibleSections(false).map((s) => s.id)).not.toContain('ai');
		expect(visibleSections(true).map((s) => s.id)).toContain('ai');
		expect(visibleSections(false).every((s) => !s.desktopOnly)).toBe(true);
	});

	it('旧 hash の行き先は、実在するセクション', () => {
		const ids = new Set(SETTINGS_SECTIONS.map((s) => s.id as string));
		for (const target of Object.values(LEGACY_SECTION_HASHES)) expect(ids.has(target)).toBe(true);
	});

	it('旧 hash が現行の ID と衝突しない', () => {
		const ids = new Set(SETTINGS_SECTIONS.map((s) => s.id as string));
		for (const key of Object.keys(LEGACY_SECTION_HASHES)) expect(ids.has(key)).toBe(false);
	});
});

describe('resolveSection', () => {
	it('hash からセクションを引く(# の有無どちらも)', () => {
		expect(resolveSection('#sync', false).id).toBe('sync');
		expect(resolveSection('sharing', false).id).toBe('sharing');
		expect(resolveSection('#about', true).id).toBe('about');
	});

	it('hash が無い、または未知なら先頭のセクション', () => {
		expect(resolveSection('', false).id).toBe('appearance');
		expect(resolveSection('#', false).id).toBe('appearance');
		expect(resolveSection('#unknown', true).id).toBe('appearance');
		expect(resolveSection('#%E0%A4%A', true).id).toBe('appearance');
	});

	it('旧 hash(#claude など)は新しい ID に読み替える', () => {
		expect(resolveSection('#claude', true).id).toBe('ai');
		expect(resolveSection('#theme', false).id).toBe('appearance');
		expect(resolveSection('#shortcuts', false).id).toBe('editor');
		expect(resolveSection('#backup', false).id).toBe('data');
	});

	it('Web 版ではデスクトップ専用セクションの hash でも先頭になる', () => {
		expect(resolveSection('#ai', false).id).toBe('appearance');
		expect(resolveSection('#claude', false).id).toBe('appearance');
	});

	it('sectionHash は resolveSection で同じセクションに戻る', () => {
		for (const s of visibleSections(true)) {
			expect(resolveSection(sectionHash(s.id), true).id).toBe(s.id);
		}
	});
});
