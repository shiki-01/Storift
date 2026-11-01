import { describe, it, expect } from 'vitest';
import {
	contrastRatio,
	deriveTheme,
	isDarkColor,
	isHexColor,
	mixHex,
	normalizeHex,
	parseThemeFile,
	serializeTheme,
	DEFAULT_THEME_FONTS
} from './themeTools';
import type { Theme } from '$lib/stores/theme.svelte';

const sample: Theme = {
	id: 'custom-sample',
	name: 'テスト',
	colors: {
		primary: '#33507a',
		secondary: '#6b5b7b',
		background: '#f6f4ef',
		surface: '#ece8df',
		text: '#2a2925',
		textSecondary: '#78736a',
		border: '#dfdad0',
		accent: '#b4543a',
		success: '#557a4c',
		warning: '#b0812c',
		error: '#a83c3c',
		info: '#33507a'
	},
	editor: {
		background: '#fbfaf6',
		text: '#2a2925',
		selection: '#d6dfeb',
		lineHighlight: '#f1eee6',
		cursor: '#33507a'
	},
	fonts: { body: 'sans-serif', editor: 'serif', heading: 'sans-serif' }
};

describe('isHexColor / normalizeHex', () => {
	it('accepts #rgb and #rrggbb only', () => {
		expect(isHexColor('#fff')).toBe(true);
		expect(isHexColor('#FFAA00')).toBe(true);
		expect(isHexColor('fff')).toBe(false);
		expect(isHexColor('#ffff')).toBe(false);
		expect(isHexColor('red')).toBe(false);
		expect(isHexColor(123)).toBe(false);
	});

	it('expands #rgb and lowercases', () => {
		expect(normalizeHex('#ABC')).toBe('#aabbcc');
		expect(normalizeHex('#33507A')).toBe('#33507a');
	});

	it('throws on invalid input', () => {
		expect(() => normalizeHex('#12')).toThrow();
	});
});

describe('mixHex', () => {
	it('returns endpoints at t=0 and t=1', () => {
		expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
		expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
	});

	it('mixes channels linearly', () => {
		expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
	});

	it('clamps t outside 0..1', () => {
		expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000');
		expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff');
	});
});

describe('contrastRatio', () => {
	it('gives 21 for black on white and 1 for identical colors', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
	});

	it('is symmetric', () => {
		expect(contrastRatio('#2a2925', '#f6f4ef')).toBeCloseTo(
			contrastRatio('#f6f4ef', '#2a2925'),
			10
		);
	});

	it('gives about 4.5 for #767676 on white', () => {
		expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
	});
});

describe('isDarkColor', () => {
	it('detects dark and light backgrounds', () => {
		expect(isDarkColor('#1b1a18')).toBe(true);
		expect(isDarkColor('#000000')).toBe(true);
		expect(isDarkColor('#f6f4ef')).toBe(false);
		expect(isDarkColor('#ffffff')).toBe(false);
	});
});

describe('deriveTheme', () => {
	const lightBase = {
		name: 'light',
		background: '#f6f4ef',
		text: '#2a2925',
		primary: '#33507a',
		accent: '#b4543a'
	};

	it('returns every colors and editor key as a valid hex color', () => {
		const derived = deriveTheme(lightBase);
		const colorKeys = Object.keys(sample.colors);
		const editorKeys = Object.keys(sample.editor);
		expect(Object.keys(derived.colors).sort()).toEqual(colorKeys.sort());
		expect(Object.keys(derived.editor).sort()).toEqual(editorKeys.sort());
		for (const value of [...Object.values(derived.colors), ...Object.values(derived.editor)]) {
			expect(isHexColor(value)).toBe(true);
		}
	});

	it('keeps the four base colors as they are', () => {
		const derived = deriveTheme(lightBase);
		expect(derived.colors.background).toBe('#f6f4ef');
		expect(derived.colors.text).toBe('#2a2925');
		expect(derived.colors.primary).toBe('#33507a');
		expect(derived.colors.accent).toBe('#b4543a');
		expect(derived.editor.text).toBe('#2a2925');
		expect(derived.editor.cursor).toBe('#33507a');
	});

	it('uses light status colors for a light background', () => {
		const derived = deriveTheme(lightBase);
		expect(derived.colors.success).toBe('#557a4c');
		expect(derived.colors.error).toBe('#a83c3c');
	});

	it('detects darkness from the background when dark is omitted', () => {
		const derived = deriveTheme({
			name: 'dark',
			background: '#1b1a18',
			text: '#e7e3da',
			primary: '#9db3d1',
			accent: '#d98a6e'
		});
		expect(derived.colors.error).toBe('#e08a82');
	});

	it('follows the explicit dark flag', () => {
		const derived = deriveTheme({ ...lightBase, dark: true });
		expect(derived.colors.error).toBe('#e08a82');
	});

	it('keeps secondary text readable (4.5 or more)', () => {
		const derived = deriveTheme(lightBase);
		expect(
			contrastRatio(derived.colors.textSecondary, derived.colors.background)
		).toBeGreaterThanOrEqual(4.5);
	});
});

describe('serializeTheme / parseThemeFile', () => {
	it('writes the format header', () => {
		const data = JSON.parse(serializeTheme(sample));
		expect(data.format).toBe('storift-theme');
		expect(data.version).toBe(1);
		expect(data.theme.name).toBe('テスト');
	});

	it('round-trips colors and name, and assigns a new custom id', () => {
		const parsed = parseThemeFile(serializeTheme(sample));
		expect(parsed.id).toMatch(/^custom-/);
		expect(parsed.id).not.toBe(sample.id);
		expect(parsed.name).toBe(sample.name);
		expect(parsed.colors).toEqual(sample.colors);
		expect(parsed.editor).toEqual(sample.editor);
		expect(parsed.fonts).toEqual(sample.fonts);
	});

	it('expands #rgb values and lowercases them', () => {
		const text = serializeTheme({
			...sample,
			colors: { ...sample.colors, primary: '#ABC' }
		});
		expect(parseThemeFile(text).colors.primary).toBe('#aabbcc');
	});

	it('uses the default fonts when fonts are missing', () => {
		const data = JSON.parse(serializeTheme(sample));
		delete data.theme.fonts;
		expect(parseThemeFile(JSON.stringify(data)).fonts).toEqual(DEFAULT_THEME_FONTS);
	});

	it('rejects invalid JSON', () => {
		expect(() => parseThemeFile('{not json')).toThrow();
	});

	it('rejects a file that is not a Storift theme', () => {
		expect(() => parseThemeFile(JSON.stringify({ theme: sample }))).toThrow();
		expect(() => parseThemeFile(JSON.stringify(sample))).toThrow();
	});

	it('rejects an unsupported version', () => {
		const data = JSON.parse(serializeTheme(sample));
		data.version = 2;
		expect(() => parseThemeFile(JSON.stringify(data))).toThrow();
	});

	it('rejects a missing color key', () => {
		const data = JSON.parse(serializeTheme(sample));
		delete data.theme.colors.primary;
		expect(() => parseThemeFile(JSON.stringify(data))).toThrow(/colors\.primary/);
	});

	it('rejects a missing editor section', () => {
		const data = JSON.parse(serializeTheme(sample));
		delete data.theme.editor;
		expect(() => parseThemeFile(JSON.stringify(data))).toThrow();
	});

	it('rejects a color that is not hex', () => {
		const data = JSON.parse(serializeTheme(sample));
		data.theme.colors.accent = 'rgb(1,2,3)';
		expect(() => parseThemeFile(JSON.stringify(data))).toThrow(/colors\.accent/);
	});

	it('rejects a missing or empty name', () => {
		const data = JSON.parse(serializeTheme(sample));
		data.theme.name = '  ';
		expect(() => parseThemeFile(JSON.stringify(data))).toThrow();
	});
});
