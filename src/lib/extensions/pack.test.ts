import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest';
import {
	BUNDLE_FORMAT,
	PACK_LIMITS,
	buildBundle,
	checkBundleShape,
	contributionKinds,
	contributionPaths,
	countContent,
	hasForbiddenChars,
	hexContrast,
	isSafeContentPath,
	serializeBundle,
	validateContributions,
	validatePackContent
} from './pack';

const theme = (patch: Record<string, unknown> = {}) => ({
	id: 'sample',
	name: 'サンプル',
	scheme: 'light',
	colors: {
		primary: '#33507a',
		secondary: '#6b5b7b',
		background: '#f6f4ef',
		surface: '#ece8df',
		text: '#2a2925',
		textSecondary: '#625d54',
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
	...patch
});

const contributions = {
	themes: ['t.json'],
	proofreadRules: ['r.json'],
	assistKeys: ['k.json'],
	exportPresets: ['e.json']
};

const goodFiles = () => ({
	't.json': theme(),
	'r.json': { id: 'r', name: '辞書', rules: [{ from: '出来る', to: 'できる' }] },
	'k.json': { id: 'k', name: 'キー', keys: [{ label: '「」', text: '「」', caretBack: 1 }] },
	'e.json': { id: 'e', name: 'プリセット', ruby: 'paren', bouten: 'strip', blankLines: 'collapse' }
});

function errorsOf(files: Record<string, unknown>, c: Record<string, string[]> = contributions) {
	const result = validatePackContent(c, files);
	return result.ok ? [] : result.errors;
}

describe('validatePackContent', () => {
	it('正しいコンテンツを受け付け、正規化する', () => {
		const result = validatePackContent(contributions, goodFiles());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.content.themes[0].colors.primary).toBe('#33507a');
		expect(result.content.assistKeys[0].keys[0]).toEqual({
			label: '「」',
			text: '「」',
			caretBack: 1
		});
		expect(countContent(result.content)).toEqual({
			themes: 1,
			proofreadRules: 1,
			assistKeys: 1,
			exportPresets: 1
		});
	});

	it('#rgb は #rrggbb に正規化する', () => {
		const t = theme();
		t.colors.border = '#ABC';
		const result = validatePackContent({ themes: ['t.json'] }, { 't.json': t });
		expect(result.ok && result.content.themes[0].colors.border).toBe('#aabbcc');
	});

	it('宣言していないファイル・無いファイルを拒否する', () => {
		expect(errorsOf({ ...goodFiles(), 'x.json': {} }).join()).toContain('x.json');
		const rest: Record<string, unknown> = goodFiles();
		delete rest['t.json'];
		expect(errorsOf(rest).join()).toContain('t.json: ファイルがありません');
	});

	describe('テーマ', () => {
		const one = (t: unknown) => errorsOf({ 't.json': t }, { themes: ['t.json'] });

		it('不正な色・足りない色を拒否する', () => {
			const bad = theme();
			bad.colors.primary = 'red';
			expect(one(bad).join()).toContain('colors.primary');
			const bad2 = theme();
			bad2.colors.border = 'url(javascript:alert(1))';
			expect(one(bad2).join()).toContain('colors.border');
			const missing = theme();
			delete (missing.colors as Record<string, unknown>).text;
			expect(one(missing).join()).toContain('colors.text');
		});

		it('フォントや未知のトークンは指定できない', () => {
			expect(one(theme({ fonts: { body: 'x' } })).join()).toContain('fonts');
			const extra = theme();
			(extra.colors as Record<string, unknown>).evil = '#000000';
			expect(one(extra).join()).toContain('colors.evil');
		});

		it('scheme と背景の明暗が食い違うと拒否する', () => {
			expect(one(theme({ scheme: 'dark' })).join()).toContain('scheme');
		});

		it('コントラスト比が足りないと拒否する', () => {
			const low = theme();
			low.colors.text = '#cccccc';
			expect(one(low).join()).toContain('コントラスト比');
			const lowEditor = theme();
			lowEditor.editor.text = '#f0f0e8';
			expect(one(lowEditor).join()).toContain('原稿の文字色');
			const lowAccent = theme();
			lowAccent.colors.accent = '#f4f2ed';
			expect(one(lowAccent).join()).toContain('accent');
		});

		it('ダークのテーマも通る', () => {
			const dark = theme({
				scheme: 'dark',
				colors: {
					...theme().colors,
					background: '#1b1a18',
					surface: '#24231f',
					text: '#e7e3da',
					textSecondary: '#9a958a',
					border: '#34322d',
					primary: '#9db3d1',
					accent: '#d98a6e'
				},
				editor: { ...theme().editor, background: '#201f1c', text: '#e7e3da', selection: '#3a4558' }
			});
			expect(one(dark)).toEqual([]);
		});

		it('アプリ同梱のテーマと同じ基準(WCAG)で計算する', () => {
			expect(hexContrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
		});
	});

	describe('校正の辞書', () => {
		const one = (rules: unknown, extra: Record<string, unknown> = {}) =>
			errorsOf(
				{ 'r.json': { id: 'r', name: '辞書', rules, ...extra } },
				{ proofreadRules: ['r.json'] }
			);

		it('正規表現・未知の項目・同一の from を拒否する', () => {
			expect(one([{ pattern: '(a+)+$', to: 'b' }]).join()).toContain('正規表現は使えません');
			expect(one([{ from: 'a', to: 'b', flags: 'g' }]).join()).toContain('flags');
			expect(
				one([
					{ from: 'a', to: 'b' },
					{ from: 'a', to: 'c' }
				]).join()
			).toContain('重複');
			expect(one([{ from: 'a', to: 'a' }]).join()).toContain('同じ');
		});

		it('長さ・個数・制御文字の上限', () => {
			expect(
				one([{ from: 'あ'.repeat(PACK_LIMITS.ruleWordLength + 1), to: 'い' }]).join()
			).toContain('from');
			expect(one([{ from: 'a\nb', to: 'c' }]).join()).toContain('from');
			expect(one([{ from: 'a', to: 'b‮' }]).join()).toContain('to');
			expect(one([{ from: ' a', to: 'b' }]).join()).toContain('from');
			const many = Array.from({ length: PACK_LIMITS.rulesPerFile + 1 }, (_, i) => ({
				from: `語${i}`,
				to: 'x'
			}));
			expect(one(many).join()).toContain('件までです');
			expect(one([])).not.toEqual([]);
		});

		it('to が空(削除の提案)は許す', () => {
			expect(one([{ from: 'えーと', to: '' }])).toEqual([]);
		});

		it('パック全体の規則の数に上限がある', () => {
			const makeSet = (id: string, offset: number) => ({
				id,
				name: id,
				rules: Array.from({ length: 400 }, (_, i) => ({ from: `語${offset + i}`, to: 'x' }))
			});
			const files = {
				'a.json': makeSet('a', 0),
				'b.json': makeSet('b', 400),
				'c.json': makeSet('c', 800)
			};
			expect(errorsOf(files, { proofreadRules: ['a.json', 'b.json', 'c.json'] }).join()).toContain(
				'合計'
			);
		});
	});

	describe('入力補助キー', () => {
		const one = (keys: unknown) =>
			errorsOf({ 'k.json': { id: 'k', name: 'キー', keys } }, { assistKeys: ['k.json'] });

		it('制御文字・長すぎる文字列・不正な caretBack を拒否する', () => {
			expect(one([{ text: 'a\u0000b' }]).join()).toContain('text');
			expect(one([{ text: 'a\nb' }]).join()).toContain('text');
			expect(one([{ text: '‮abc' }]).join()).toContain('text');
			expect(one([{ text: 'あ'.repeat(PACK_LIMITS.keyTextLength + 1) }]).join()).toContain('text');
			expect(one([{ text: 'ab', label: 'x'.repeat(9) }]).join()).toContain('label');
			expect(one([{ text: 'ab', caretBack: 3 }]).join()).toContain('caretBack');
			expect(one([{ text: 'ab', caretBack: -1 }]).join()).toContain('caretBack');
			expect(one([{ text: 'ab', caretBack: 0.5 }]).join()).toContain('caretBack');
			expect(one([{ text: 'ab', onclick: 'x' }]).join()).toContain('onclick');
		});

		it('label を省くと text を表示に使う', () => {
			const result = validatePackContent(
				{ assistKeys: ['k.json'] },
				{ 'k.json': { id: 'k', name: 'キー', keys: [{ text: '※' }] } }
			);
			expect(result.ok && result.content.assistKeys[0].keys[0]).toEqual({
				label: '※',
				text: '※',
				caretBack: 0
			});
		});
	});

	describe('書き出しのプリセット', () => {
		const one = (patch: Record<string, unknown>) =>
			errorsOf({ 'e.json': { id: 'e', name: 'P', ...patch } }, { exportPresets: ['e.json'] });
		it('列挙された値だけを受け付ける', () => {
			expect(one({})).toEqual([]);
			expect(one({ ruby: 'html' }).join()).toContain('ruby');
			expect(one({ bouten: 'x' }).join()).toContain('bouten');
			expect(one({ blankLines: 'x' }).join()).toContain('blankLines');
		});
	});

	it('サイズの上限(1 ファイル・パック全体)', () => {
		const big = {
			id: 'r',
			name: 'big',
			rules: [{ from: 'a', to: 'b', message: 'x' }],
			note: 'x'.repeat(PACK_LIMITS.fileBytes)
		};
		expect(errorsOf({ 'r.json': big }, { proofreadRules: ['r.json'] }).join()).toContain('KB');
		// 255KB 近い 5 つのファイルで、合計の上限を超える
		const filler = (id: string) => ({
			id,
			name: id,
			rules: [{ from: 'a', to: 'b' }],
			pad: 'x'.repeat(PACK_LIMITS.fileBytes - 200)
		});
		const files: Record<string, unknown> = {};
		const paths: string[] = [];
		for (let i = 0; i < 5; i++) {
			files[`f${i}.json`] = filler(`f${i}`);
			paths.push(`f${i}.json`);
		}
		const joined = errorsOf(files, { proofreadRules: paths }).join();
		expect(joined).toContain('合計');
	});

	it('同じ種類の中で id が重複すると拒否する', () => {
		const files = {
			'a.json': { id: 'same', name: 'A', keys: [{ text: 'a' }] },
			'b.json': { id: 'same', name: 'B', keys: [{ text: 'b' }] }
		};
		expect(errorsOf(files, { assistKeys: ['a.json', 'b.json'] }).join()).toContain('重複');
	});
});

describe('contributions の宣言', () => {
	const run = (value: unknown) => {
		const errors: string[] = [];
		validateContributions(value, errors);
		return errors;
	};

	it('安全なパスだけを受け付ける', () => {
		expect(run({ themes: ['themes/a.json', 'b.json'] })).toEqual([]);
		for (const bad of [
			'../x.json',
			'a/../x.json',
			'/etc/x.json',
			'..\\x.json',
			'a\\b.json',
			'.hidden.json',
			'a.txt',
			'manifest.json',
			'a/b/c/d.json',
			'A.json',
			'a b.json',
			'a/./b.json',
			'a%2e%2e/b.json',
			'a.json/',
			''
		]) {
			expect(isSafeContentPath(bad), bad).toBe(false);
			expect(run({ themes: [bad] }).length, bad).toBeGreaterThan(0);
		}
	});

	it('空・未知の種類・重複・個数の上限を拒否する', () => {
		expect(run({}).join()).toContain('1 つ以上');
		expect(run({ scripts: ['a.json'] }).join()).toContain('scripts');
		expect(run({ themes: [] }).join()).toContain('themes');
		expect(run({ themes: ['a.json'], assistKeys: ['a.json'] }).join()).toContain('重複');
		const many = Array.from({ length: PACK_LIMITS.filesPerKind + 1 }, (_, i) => `f${i}.json`);
		expect(run({ themes: many }).join()).toContain('までです');
		expect(run([]).join()).toContain('オブジェクト');
	});

	it('パスと種類の一覧', () => {
		expect(contributionPaths(contributions)).toEqual(['t.json', 'r.json', 'k.json', 'e.json']);
		expect(contributionKinds({ assistKeys: ['k.json'] })).toEqual(['assistKeys']);
		expect(contributionKinds(undefined)).toEqual([]);
	});
});

describe('hasForbiddenChars', () => {
	it('制御文字・書字方向の制御・ゼロ幅文字を検出する', () => {
		for (const c of ['\u0000', '\n', '\t', '\u007f', '\u0085', '​', '‮', '⁦', '﻿']) {
			expect(hasForbiddenChars(`a${c}b`), JSON.stringify(c)).toBe(true);
		}
		expect(hasForbiddenChars('「会話」……！？〜※')).toBe(false);
	});
});

describe('パックのマニフェスト', () => {
	const pack = (patch: Record<string, unknown> = {}) => ({
		id: 'my-pack',
		name: 'P',
		description: 'd',
		version: '1.0.0',
		author: 'a',
		kind: 'pack',
		apiVersion: 1,
		platforms: ['web'],
		icon: 'puzzle',
		license: 'MIT',
		updatedAt: '2026-11-12',
		permissions: { storage: true },
		privacy: { sends: [], stores: ['端末内'], onDisable: '止まる' },
		contributions: { themes: ['t.json'] },
		...patch
	});
	const errorsOf = (patch: Record<string, unknown>) => {
		const r = validateManifest(pack(patch));
		return r.ok ? [] : r.errors;
	};

	it('正しいパックを受け付ける', () => {
		expect(errorsOf({})).toEqual([]);
	});

	it('パックは通信・イベント・読み取りの権限を持てない', () => {
		expect(errorsOf({ permissions: { network: ['example.com'] } }).join()).toContain('network');
		expect(errorsOf({ permissions: { events: ['session:start'] } }).join()).toContain('events');
		expect(errorsOf({ permissions: { read: ['project:title'] } }).join()).toContain('read');
		expect(errorsOf({ permissions: { network: [] } })).toEqual([]);
	});

	it('パックは外部へ情報を送れない', () => {
		const sends = [{ to: 'x.example.com', items: ['a'], when: 'いつか' }];
		expect(errorsOf({ privacy: { sends, stores: [], onDisable: 'x' } }).join()).toContain(
			'privacy.sends'
		);
	});

	it('contributions・license・updatedAt が必須', () => {
		expect(errorsOf({ contributions: undefined }).join()).toContain('contributions');
		expect(errorsOf({ license: undefined }).join()).toContain('license');
		expect(errorsOf({ updatedAt: undefined }).join()).toContain('updatedAt');
		expect(errorsOf({ updatedAt: '2026-02-30' }).join()).toContain('updatedAt');
	});

	it('パック以外は contributions を持てない', () => {
		expect(
			errorsOf({ kind: 'official', id: 'my-ext', contributions: { themes: ['t.json'] } }).join()
		).toContain('contributions');
	});

	it('公式と紛らわしい ID を拒否する', () => {
		for (const id of ['monolog', 'discord', 'official-tools', 'submit']) {
			expect(errorsOf({ id }).join(), id).toContain('予約');
		}
		expect(errorsOf({ id: 'official' })).toEqual([]);
	});
});

describe('バンドル', () => {
	it('同じ入力から同じバイト列になり、ファイルはパスの昇順', () => {
		const a = buildBundle({ id: 'x' }, { 'b.json': { v: 1 }, 'a.json': { v: 2 } });
		const b = buildBundle({ id: 'x' }, { 'a.json': { v: 2 }, 'b.json': { v: 1 } });
		expect(serializeBundle(a)).toBe(serializeBundle(b));
		expect(Object.keys(a.files)).toEqual(['a.json', 'b.json']);
		expect(a.format).toBe(BUNDLE_FORMAT);
		expect(serializeBundle(a).endsWith('\n')).toBe(true);
	});

	it('外側の形を検証する', () => {
		expect(checkBundleShape(null).ok).toBe(false);
		expect(checkBundleShape({ format: 'x', bundleVersion: 1, manifest: {}, files: {} }).ok).toBe(
			false
		);
		expect(
			checkBundleShape({ format: BUNDLE_FORMAT, bundleVersion: 2, manifest: {}, files: {} }).ok
		).toBe(false);
		expect(
			checkBundleShape({ format: BUNDLE_FORMAT, bundleVersion: 1, manifest: {}, files: {}, x: 1 })
				.ok
		).toBe(false);
		expect(
			checkBundleShape({ format: BUNDLE_FORMAT, bundleVersion: 1, manifest: {}, files: {} }).ok
		).toBe(true);
	});
});
