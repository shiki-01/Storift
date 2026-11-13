import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Theme } from '$lib/stores/theme.svelte';
import {
	THEME_MIRROR_KEY,
	buildMirror,
	parseMirror,
	resolveBootSnapshot,
	resolveSystemDark,
	themeToCssVars,
	toSnapshot
} from './themeBoot';

function makeTheme(id: string, background: string, text: string): Theme {
	return {
		id,
		name: id,
		colors: {
			primary: '#111111',
			secondary: '#222222',
			background,
			surface: '#333333',
			text,
			textSecondary: '#444444',
			border: '#555555',
			accent: '#666666',
			success: '#777777',
			warning: '#888888',
			error: '#999999',
			info: '#aaaaaa'
		},
		editor: {
			background,
			text,
			selection: '#bbbbbb',
			lineHighlight: '#cccccc',
			cursor: '#dddddd'
		},
		fonts: { body: 'a', editor: 'b', heading: 'c' }
	};
}

const light = makeTheme('light', '#f6f4ef', '#2a2925');
const dark = makeTheme('dark', '#1b1a18', '#e7e3da');
const custom = makeTheme('custom-1', '#101820', '#eeeeee');

const mirrorOf = (auto: boolean, current: Theme, lastSystemDark = false) =>
	buildMirror({ auto, current, light, dark, lastSystemDark });

describe('resolveSystemDark', () => {
	it('dark / light が取れればそれに従う', () => {
		expect(resolveSystemDark(true, false, false)).toBe(true);
		expect(resolveSystemDark(false, true, true)).toBe(false);
	});

	it('どちらも一致しない(取得できない)ときは直前の判定を使い、ライトに確定しない', () => {
		expect(resolveSystemDark(false, false, true)).toBe(true);
		expect(resolveSystemDark(false, false, false)).toBe(false);
	});
});

describe('mirror', () => {
	it('テーマを CSS 変数と配色に変換する', () => {
		expect(themeToCssVars(dark)['--color-background']).toBe('#1b1a18');
		expect(toSnapshot(dark).scheme).toBe('dark');
		expect(toSnapshot(light).scheme).toBe('light');
	});

	it('保存して読み戻せる。壊れた値・版違いは null', () => {
		const m = mirrorOf(false, custom);
		expect(parseMirror(JSON.stringify(m))).toEqual(m);
		expect(parseMirror(null)).toBeNull();
		expect(parseMirror('{')).toBeNull();
		expect(parseMirror(JSON.stringify({ ...m, v: 2 }))).toBeNull();
		expect(parseMirror(JSON.stringify({ ...m, fixed: null }))).toBeNull();
	});

	it('固定テーマ(カスタム含む)はそのまま、追従中はシステムの明暗で選ぶ', () => {
		expect(resolveBootSnapshot(mirrorOf(false, custom), false, true).id).toBe('custom-1');
		expect(resolveBootSnapshot(mirrorOf(true, light), true, false).id).toBe('dark');
		expect(resolveBootSnapshot(mirrorOf(true, dark), false, true).id).toBe('light');
	});

	it('追従中に明暗が取得できないときは、直前の判定(ダーク)を保つ', () => {
		expect(resolveBootSnapshot(mirrorOf(true, dark, true), false, false).id).toBe('dark');
		expect(resolveBootSnapshot(mirrorOf(true, light, false), false, false).id).toBe('light');
	});
});

describe('app.html の起動前スクリプト', () => {
	const html = readFileSync('src/app.html', 'utf8');
	const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

	function run(raw: string | null, darkMatches: boolean, lightMatches: boolean) {
		const attrs: Record<string, string> = {};
		const props: Record<string, string> = {};
		const root = {
			style: {
				setProperty: (k: string, v: string) => (props[k] = v),
				colorScheme: ''
			},
			setAttribute: (k: string, v: string) => (attrs[k] = v)
		};
		runInNewContext(script, {
			localStorage: { getItem: (k: string) => (k === THEME_MIRROR_KEY ? raw : null) },
			matchMedia: (q: string) => ({
				matches: q.includes('dark') ? darkMatches : lightMatches
			}),
			document: { documentElement: root }
		});
		return { attrs, props, root };
	}

	it('スクリプトが存在し、ミラーが無ければ何も変えない', () => {
		expect(script).toContain(THEME_MIRROR_KEY);
		expect(run(null, true, false).attrs).toEqual({});
	});

	it('TypeScript 側の判断と同じテーマを適用する', () => {
		const cases: [boolean, Theme, boolean, boolean, boolean][] = [
			[false, custom, false, true, false],
			[true, light, true, false, false],
			[true, dark, false, true, false],
			[true, light, false, false, true],
			[true, dark, false, false, false]
		];
		for (const [auto, current, d, l, last] of cases) {
			const m = mirrorOf(auto, current, last);
			const expected = resolveBootSnapshot(m, d, l);
			const { attrs, props, root } = run(JSON.stringify(m), d, l);
			expect(attrs['data-theme']).toBe(expected.id);
			expect(attrs['data-scheme']).toBe(expected.scheme);
			expect(root.style.colorScheme).toBe(expected.scheme);
			expect(props).toEqual(expected.vars);
		}
	});
});
