// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel));
const readText = (rel: string) => read(rel).toString('utf8');

/** PNG の IHDR から実寸を読む */
function pngSize(rel: string): { width: number; height: number } {
	const buf = read(rel);
	expect(buf.subarray(0, 8).toString('hex'), `${rel} は PNG ではありません`).toBe(
		'89504e470d0a1a0a'
	);
	expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 閉じ忘れ・入れ子の誤りだけを見る簡易な整形式チェック(素材の SVG は単純な構造) */
function assertWellFormed(rel: string) {
	const xml = readText(rel);
	const stack: string[] = [];
	for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
		const [, closing, name, , selfClosing] = m;
		if (selfClosing) continue;
		if (closing) expect(stack.pop(), `${rel}: </${name}> が対応していません`).toBe(name);
		else stack.push(name);
	}
	expect(stack, `${rel}: 閉じられていないタグ`).toEqual([]);
	expect(xml.trimStart().startsWith('<svg')).toBe(true);
}

describe('manifest のアイコン', () => {
	const manifest = JSON.parse(readText('static/manifest.webmanifest')) as {
		icons: { src: string; sizes: string; type: string; purpose?: string }[];
		shortcuts?: { icons?: { src: string; sizes: string }[] }[];
	};
	const entries = [...manifest.icons, ...(manifest.shortcuts ?? []).flatMap((s) => s.icons ?? [])];

	it('参照する全アイコンが存在し、実寸が sizes の宣言と一致する', () => {
		expect(entries.length).toBeGreaterThan(0);
		for (const icon of entries) {
			const rel = path.join('static', icon.src);
			expect(existsSync(path.join(ROOT, rel)), `${icon.src} がありません`).toBe(true);
			const [w, h] = icon.sizes.split('x').map(Number);
			expect(pngSize(rel)).toEqual({ width: w, height: h });
			// ファイル名の数字とも一致する(icon-192.png / maskable-512.png)
			const n = /-(\d+)\.png$/.exec(icon.src)?.[1];
			if (n) expect(Number(n)).toBe(w);
		}
	});

	it('maskable は purpose=maskable の別エントリになっている', () => {
		const maskable = manifest.icons.filter((i) => i.src.includes('maskable'));
		expect(maskable.length).toBeGreaterThanOrEqual(2);
		for (const i of maskable) expect(i.purpose).toBe('maskable');
		for (const i of manifest.icons.filter((i) => !i.src.includes('maskable'))) {
			expect(i.purpose).toBe('any');
		}
	});

	it('apple-touch-icon は 180px', () => {
		expect(pngSize('static/favicon/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
	});
});

describe('favicon.ico', () => {
	for (const rel of ['static/favicon.ico', 'site/static/favicon.ico']) {
		it(`${rel} に 16/32/48 が入っている`, () => {
			const buf = read(rel);
			expect(buf.readUInt16LE(0)).toBe(0);
			expect(buf.readUInt16LE(2)).toBe(1);
			const count = buf.readUInt16LE(4);
			const sizes = Array.from({ length: count }, (_, i) => buf.readUInt8(6 + i * 16));
			expect(sizes).toEqual(expect.arrayContaining([16, 32, 48]));
		});
	}
});

describe('Tauri のアイコン', () => {
	const conf = JSON.parse(readText('src-tauri/tauri.conf.json')) as {
		bundle: { icon: string[] };
	};

	it('bundle.icon が列挙するファイルが全て存在する', () => {
		for (const icon of conf.bundle.icon) {
			expect(existsSync(path.join(ROOT, 'src-tauri', icon)), `${icon} がありません`).toBe(true);
		}
	});

	it('icon.png は正方形(512 または 1024)', () => {
		const { width, height } = pngSize('src-tauri/icons/icon.png');
		expect(width).toBe(height);
		expect([512, 1024]).toContain(width);
	});

	it('モバイル向けの生成物が混ざっていない', () => {
		expect(existsSync(path.join(ROOT, 'src-tauri/icons/android'))).toBe(false);
		expect(existsSync(path.join(ROOT, 'src-tauri/icons/ios'))).toBe(false);
	});
});

describe('HTML の参照先', () => {
	const cases: [string, string][] = [
		['src/app.html', 'static'],
		['site/src/app.html', 'site/static']
	];
	for (const [html, staticDir] of cases) {
		it(`${html} の <link> が実在のファイルを指す`, () => {
			const src = readText(html);
			const hrefs = [
				...src.matchAll(/<link\b[^>]*\brel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g)
			]
				.map((m) => /href="([^"]+)"/.exec(m[0])?.[1])
				.filter((h): h is string => !!h);
			expect(hrefs.length).toBeGreaterThanOrEqual(2);
			for (const href of hrefs) {
				const rel = href.replace('%sveltekit.assets%', '').replace(/^\//, '');
				expect(existsSync(path.join(ROOT, staticDir, rel)), `${href} がありません`).toBe(true);
			}
		});

		it(`${html} の theme-color が色の指定になっている`, () => {
			const metas = [...readText(html).matchAll(/<meta\s+name="theme-color"[^>]*>/g)];
			expect(metas.length).toBeGreaterThan(0);
			for (const m of metas) expect(m[0]).toMatch(/content="#[0-9a-fA-F]{6}"/);
		});
	}

	it('サイトの OG 画像が 1200x630 で、Seo.svelte の参照と一致する', () => {
		expect(pngSize('site/static/og.png')).toEqual({ width: 1200, height: 630 });
		expect(readText('site/src/lib/Seo.svelte')).toContain('/og.png');
	});
});

describe('ブランド素材の SVG', () => {
	const brand = [
		'static/brand/storift-logo.svg',
		'static/brand/storift-logo-light.svg',
		'static/brand/storift-mark.svg',
		'static/brand/storift-mark-light.svg',
		'static/brand/storift-wordmark.svg',
		'static/brand/storift-wordmark-light.svg',
		'static/brand/app-icon.svg',
		'static/brand/app-icon-rounded.svg',
		'static/brand/app-icon-maskable.svg',
		'static/favicon.svg',
		'site/static/favicon.svg'
	];

	it('全て整形式の XML', () => {
		for (const rel of brand) assertWellFormed(rel);
	});

	// 原本の末尾 3 つがシンボル(羽根 2 つ + 火花 1 つ)
	const original = readText('static/brand/storift-logo.svg');
	const originalPaths = [...original.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
	const symbol = originalPaths.slice(-3);
	const wordmark = originalPaths.slice(0, -3);

	it('原本は 10 パス(文字 7 + 羽根 2 + 火花 1)', () => {
		expect(originalPaths).toHaveLength(10);
	});

	it('シンボルを使う素材は原本と同じ path を含む', () => {
		const withSymbol = brand.filter((r) => !r.includes('wordmark'));
		for (const rel of withSymbol) {
			const svg = readText(rel);
			for (const d of symbol) expect(svg, `${rel} にシンボルの path がありません`).toContain(d);
		}
	});

	it('ワードマークは文字の path だけを含む', () => {
		const svg = readText('static/brand/storift-wordmark.svg');
		for (const d of wordmark) expect(svg).toContain(d);
		for (const d of symbol) expect(svg).not.toContain(d);
	});

	it('Logo.svelte のシンボルが原本と同じ path を使っている', () => {
		for (const rel of ['src/lib/components/ui/Logo.svelte', 'site/src/lib/Logo.svelte']) {
			const src = readText(rel);
			for (const d of originalPaths) expect(src, `${rel} が原本と食い違っています`).toContain(d);
		}
	});
});
