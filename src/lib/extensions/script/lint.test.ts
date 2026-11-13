import { describe, expect, it } from 'vitest';
import { lintScript, scanSource } from './lint';

const errors = (code: string, network: string[] = []) => lintScript(code, network).errors;

describe('lintScript', () => {
	it('eval / new Function / Function() / importScripts / WebAssembly / 動的 import / import・export 文を拒否する', () => {
		for (const code of [
			'eval("1")',
			'  eval ("1")',
			'const f = new Function("return 1")',
			'Function("return 1")()',
			'importScripts("a.js")',
			'WebAssembly.instantiate(x)',
			'const m = await import("https://x.example.com/a.js")',
			'import x from "./a.js";',
			'export const a = 1;'
		])
			expect(errors(code).length, code).toBeGreaterThan(0);
	});

	it('エラーに行番号が入る', () => {
		expect(errors('const a = 1;\n\neval(a);')[0]).toContain('3 行目');
	});

	it('コメント・文字列・テンプレート・正規表現の中の語は許可する', () => {
		for (const code of [
			'// eval("x") importScripts',
			'/* new Function("x") */ const a = 1;',
			'const s = "<script>eval(1)</script>";',
			'const s = \'import("x")\';',
			'const t = `<script src="x"></script> eval`;',
			'const t = `a ${1 + 2} importScripts`;',
			'const r = /eval\\(/.test("x");',
			'const x = 4 / 2; const y = x / 2; // eval(',
			'const o = { evaluate: 1, myeval: 2, importance: 3 };'
		])
			expect(errors(code), code).toEqual([]);
	});

	it('テンプレートの ${ } の中の呼び出しは見る', () => {
		expect(errors('const t = `a ${eval("1")} b`;').length).toBeGreaterThan(0);
	});

	it('通信の API は、permissions.network を宣言していないと拒否する', () => {
		expect(errors('fetch("https://a.example.com")').join()).toContain('permissions.network');
		expect(errors('new XMLHttpRequest()').length).toBeGreaterThan(0);
		expect(errors('fetch("https://a.example.com")', ['a.example.com'])).toEqual([]);
		expect(errors('const fetchAll = 1;')).toEqual([]);
	});

	it('宣言していないホストの URL・http は警告にする', () => {
		const r = lintScript('x("https://evil.example.net/a"); y("http://a.example.com");', [
			'a.example.com'
		]);
		expect(r.errors).toEqual([]);
		expect(r.warnings.join()).toContain('evil.example.net');
		expect(r.warnings.join()).toContain('http://');
	});

	it('大きさ・空・書字方向の制御文字を拒否する', () => {
		expect(errors('x'.repeat(201 * 1024)).join()).toContain('大きすぎ');
		expect(errors('  ').join()).toContain('空');
		expect(errors('const a = "‮";').join()).toContain('制御文字');
	});

	it('圧縮・難読化が疑われるものは警告にする(エラーにしない)', () => {
		const long = lintScript(`const a = "${'x'.repeat(1500)}";`);
		expect(long.errors).toEqual([]);
		expect(long.warnings.join()).toContain('極端に長い');
		const short = Array.from({ length: 200 }, (_, i) => `a${i % 2 ? 'b' : ''}=c;d=e;`).join('\n');
		const ids = lintScript(short);
		expect(ids.errors).toEqual([]);
		expect(ids.warnings.join()).toContain('1 文字の変数名');
		expect(lintScript('const _0x1a2b = 1;').warnings.join()).toContain('_0x');
		expect(lintScript('const readable = 1;\nconsole.log(readable);').warnings).toEqual([]);
	});
});

describe('scanSource', () => {
	it('文字列を集め、コード側からは中身を消す', () => {
		const { code, strings } = scanSource('a("x"); // c\nb(`y${z}`)');
		expect(strings.map((s) => s.text)).toEqual(['x', 'y', '']);
		expect(code).not.toContain('x"');
		expect(code).toContain('z');
		expect(code.split('\n')).toHaveLength(2);
	});
});
