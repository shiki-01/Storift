// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

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

type Rgba = { width: number; height: number; data: Buffer };

/** 8bit RGBA・非インターレースの PNG をデコードする(フィルタ 0〜4 に対応) */
function decodePng(buf: Buffer, label: string): Rgba {
	expect(buf.subarray(0, 8).toString('hex'), `${label} は PNG ではありません`).toBe(
		'89504e470d0a1a0a'
	);
	let width = 0;
	let height = 0;
	const idat: Buffer[] = [];
	for (let o = 8; o < buf.length; ) {
		const len = buf.readUInt32BE(o);
		const type = buf.subarray(o + 4, o + 8).toString('ascii');
		const body = buf.subarray(o + 8, o + 8 + len);
		if (type === 'IHDR') {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			expect([body[8], body[9], body[12]], `${label}: 8bit RGBA・非インターレースのみ対応`).toEqual(
				[8, 6, 0]
			);
		} else if (type === 'IDAT') idat.push(body);
		o += 12 + len;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * 4;
	const data = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let i = 0; i < stride; i++) {
			const a = i >= 4 ? data[y * stride + i - 4] : 0;
			const b = y > 0 ? data[(y - 1) * stride + i] : 0;
			const c = i >= 4 && y > 0 ? data[(y - 1) * stride + i - 4] : 0;
			let add = 0;
			if (filter === 1) add = a;
			else if (filter === 2) add = b;
			else if (filter === 3) add = (a + b) >> 1;
			else if (filter === 4) {
				const pa = Math.abs(b - c);
				const pb = Math.abs(a - c);
				const pc = Math.abs(a + b - 2 * c);
				add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			data[y * stride + i] = (line[i] + add) & 255;
		}
	}
	return { width, height, data };
}

const alphaAt = (img: Rgba, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
const cornerAlphas = (img: Rgba) => {
	const { width: w, height: h } = img;
	return [
		alphaAt(img, 0, 0),
		alphaAt(img, w - 1, 0),
		alphaAt(img, 0, h - 1),
		alphaAt(img, w - 1, h - 1)
	];
};

/** ICO(PNG 埋め込み)の各画像を取り出す */
function readIco(rel: string): Map<number, Rgba> {
	const buf = read(rel);
	expect(buf.readUInt16LE(2)).toBe(1);
	const images = new Map<number, Rgba>();
	for (let i = 0; i < buf.readUInt16LE(4); i++) {
		const o = 6 + i * 16;
		const size = buf.readUInt8(o) || 256;
		const bytes = buf.readUInt32LE(o + 8);
		const offset = buf.readUInt32LE(o + 12);
		images.set(size, decodePng(buf.subarray(offset, offset + bytes), `${rel} の ${size}px`));
	}
	return images;
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

	it('icon.png(Windows / Linux 用)は RGBA で、四隅が透明・中心が不透明', () => {
		const img = decodePng(read('src-tauri/icons/icon.png'), 'icon.png');
		expect(cornerAlphas(img)).toEqual([0, 0, 0, 0]);
		expect(alphaAt(img, img.width / 2, img.height / 2)).toBe(255);
	});

	it('macOS 用の原画は、外周が透明・四隅が透明・中心が不透明', () => {
		const img = decodePng(read('scripts/app-icon-macos.png'), 'app-icon-macos.png');
		expect([img.width, img.height]).toEqual([1024, 1024]);
		expect(cornerAlphas(img)).toEqual([0, 0, 0, 0]);
		expect(alphaAt(img, 512, 512)).toBe(255);
		// タイルは 824px(余白 100px)。影はタイルの下へ最大でも 50px 弱までなので、外周 48px は完全に透明
		const band = 48;
		for (let y = 0; y < img.height; y++) {
			for (let x = 0; x < img.width; x++) {
				if (x >= band && x < img.width - band && y >= band && y < img.height - band) continue;
				if (alphaAt(img, x, y) !== 0)
					throw new Error(`外周 ${band}px が透明ではありません (${x}, ${y})`);
			}
		}
		// タイルの辺の中央は不透明、余白の内側(影の外)は透明
		expect(alphaAt(img, 512, 101)).toBe(255);
		expect(alphaAt(img, 101, 512)).toBe(255);
		expect(alphaAt(img, 512, 60)).toBe(0);
		// 影は下側にだけ濃く出る
		expect(alphaAt(img, 512, 930)).toBeGreaterThan(alphaAt(img, 512, 90));
	});

	it('Windows 用の原画は、余白が片側 40px 以内で、四隅が透明', () => {
		const img = decodePng(read('scripts/app-icon-windows.png'), 'app-icon-windows.png');
		expect(cornerAlphas(img)).toEqual([0, 0, 0, 0]);
		expect(alphaAt(img, 512, 40)).toBe(255);
		expect(alphaAt(img, 512, 39)).toBeLessThan(255);
		expect(alphaAt(img, 512, 983)).toBe(255);
	});

	it('icon.ico に 16/32/48/256 が入り、各画像の四隅が透明・中心が不透明', () => {
		const images = readIco('src-tauri/icons/icon.ico');
		expect([...images.keys()]).toEqual(expect.arrayContaining([16, 32, 48, 256]));
		for (const [size, img] of images) {
			expect([img.width, img.height], `${size}px`).toEqual([size, size]);
			expect(cornerAlphas(img), `${size}px の四隅`).toEqual([0, 0, 0, 0]);
			expect(alphaAt(img, size / 2, size / 2), `${size}px の中心`).toBe(255);
			// 透明な角の画素に色が残っていない
			expect([...img.data.subarray(0, 4)], `${size}px の左上`).toEqual([0, 0, 0, 0]);
		}
	});

	it('icon.icns は icns 形式で、512@2x 相当(1024px)を含む', () => {
		const buf = read('src-tauri/icons/icon.icns');
		expect(buf.subarray(0, 4).toString('ascii')).toBe('icns');
		expect(buf.readUInt32BE(4)).toBe(buf.length);
		const types: string[] = [];
		for (let o = 8; o < buf.length; ) {
			types.push(buf.subarray(o, o + 4).toString('ascii'));
			o += buf.readUInt32BE(o + 4);
		}
		// ic10 は 1024px(512@2x)、ic09 は 512px
		expect(types).toEqual(expect.arrayContaining(['ic10', 'ic09']));
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
		'static/brand/app-icon-macos.svg',
		'static/brand/app-icon-windows.svg',
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
