// ロゴの原本(static/brand/storift-logo.svg)から、ブランド素材・アイコン類を作り直す。
// 使い方: bun run icons
//   1. static/brand/ に派生 SVG(シンボルのみ・ワードマーク・明色版・アプリアイコン)を書き出す
//   2. Playwright(Chromium)で SVG を厳密なサイズの PNG にして、PWA / サイト / favicon に出力する
//   3. macOS 用(余白つきの角丸)と Windows 用(余白の少ない角丸)の原画(scripts/*.png、1024px)を、
//      それぞれ別に `tauri icon` に通し、icon.icns は macOS 版、残りは Windows 版から src-tauri/icons に置く
//      (icon.ico だけは各サイズを SVG から直接描いて作る)
// 原本は編集しない。配色を変えるときはこのファイル先頭の定数だけを直す。
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(ROOT, ...p);

// 配色はアプリのテーマ(src/lib/stores/theme.svelte.ts の light / dark)に合わせる
const COLORS = {
	// 明るい背景用(ライトテーマの primary / accent)
	ink: '#33507a',
	spark: '#b4543a',
	// 暗い背景用(ダークテーマの primary / accent)
	inkLight: '#9db3d1',
	sparkLight: '#d98a6e',
	// アプリアイコン(紺の地に、紙色の羽根と朱の火花)
	iconTop: '#34507a',
	iconBottom: '#1f3050',
	iconFeather: '#f6f4ef',
	iconSpark: '#e9a383',
	// OG 画像(ライトテーマの背景と文字)
	paper: '#f6f4ef',
	text: '#2a2925',
	textSecondary: '#78736a'
};

// シンボル(羽根 + 火花)の外接矩形。原本の座標系での値
const SYMBOL = { x: 1.5, y: 0, w: 256.1, h: 232.1 };

// ---- 原本の分解 ------------------------------------------------------------
const original = readFileSync(at('static/brand/storift-logo.svg'), 'utf8');
const paths = [...original.matchAll(/<path\b[^>]*\sd="([^"]+)"[^>]*\sfill="([^"]+)"/g)].map(
	(m) => ({ d: m[1], fill: m[2].toUpperCase() })
);
const sparkPaths = paths.filter((p) => p.fill === '#B96247');
const inkPaths = paths.filter((p) => p.fill !== '#B96247');
if (sparkPaths.length !== 1 || inkPaths.length !== 9) {
	throw new Error(
		`原本の構成が想定と違います(火花 ${sparkPaths.length} / その他 ${inkPaths.length})`
	);
}
const wordPaths = inkPaths.slice(0, 7);
const featherPaths = inkPaths.slice(7);

const pathTags = (list, fill) => list.map((p) => `<path d="${p.d}" fill="${fill}"/>`).join('');
const symbolInner = (ink, spark) => pathTags(featherPaths, ink) + pathTags(sparkPaths, spark);
const wordInner = (ink) => pathTags(wordPaths, ink);
const NS = 'xmlns="http://www.w3.org/2000/svg"';

const MARK_PAD = 6;
const markViewBox = `${SYMBOL.x - MARK_PAD} ${SYMBOL.y - MARK_PAD} ${SYMBOL.w + MARK_PAD * 2} ${SYMBOL.h + MARK_PAD * 2}`;
const markSvg = (ink, spark) =>
	`<svg ${NS} viewBox="${markViewBox}" fill="none">${symbolInner(ink, spark)}</svg>\n`;
const wordSvg = (ink) =>
	`<svg ${NS} viewBox="415 12 750 210" fill="none">${wordInner(ink)}</svg>\n`;
const fullSvg = (ink, spark) =>
	`<svg ${NS} width="1161" height="236" viewBox="0 0 1161 236" fill="none">${wordInner(ink)}${symbolInner(ink, spark)}</svg>\n`;

/** 1024 角のキャンバスの中央に、シンボルを幅 widthRatio で置く */
function iconSvg({ rx = 0, widthRatio }) {
	const scale = (1024 * widthRatio) / SYMBOL.w;
	const tx = 512 - (SYMBOL.x + SYMBOL.w / 2) * scale;
	const ty = 512 - (SYMBOL.y + SYMBOL.h / 2) * scale;
	return (
		`<svg ${NS} width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">` +
		`<defs><linearGradient id="bg" x1="512" y1="0" x2="512" y2="1024" gradientUnits="userSpaceOnUse">` +
		`<stop stop-color="${COLORS.iconTop}"/><stop offset="1" stop-color="${COLORS.iconBottom}"/></linearGradient></defs>` +
		`<rect width="1024" height="1024" rx="${rx}" fill="url(#bg)"/>` +
		`<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">` +
		symbolInner(COLORS.iconFeather, COLORS.iconSpark) +
		`</g></svg>\n`
	);
}

/**
 * 連続曲線(squircle)の角丸の正方形のパス。Figma の corner smoothing と同じ作り方
 * (角ごとに、辺から始まる 3 次ベジェ → 円弧 → 辺へ戻る 3 次ベジェ)
 */
function squirclePath(x0, y0, size, r, smoothing = 0.6) {
	const rad = (deg) => (deg * Math.PI) / 180;
	const p = Math.min((1 + smoothing) * r, size / 2);
	const arcMeasure = 90 * (1 - smoothing);
	const arcLen = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2;
	const alpha = (90 - arcMeasure) / 2;
	const beta = 45 * smoothing;
	const c = r * Math.tan(rad(alpha / 2)) * Math.cos(rad(beta));
	const d = c * Math.tan(rad(beta));
	const b = (p - arcLen - c - d) / 3;
	const a = 2 * b;
	const W = size;
	// 右上の角(辺の始点 → 円弧の始点)。もう半分は対角線に対する鏡像
	const start = [W - p, 0];
	const c1 = [W - p + a, 0];
	const c2 = [W - p + a + b, 0];
	const arcStart = [W - p + a + b + c, d];
	const arcEnd = [arcStart[0] + arcLen, arcStart[1] + arcLen];
	const refl = ([x, y]) => [W - y, W - x];
	const end = refl(start);
	const corner = [start, c1, c2, arcStart, arcEnd, refl(c2), refl(c1), end];
	// 時計回りに 90 度ずつ回して 4 角ぶん
	const rot = ([x, y]) => [W - y, x];
	const f = (n) => +n.toFixed(3);
	let cur = corner;
	let out = '';
	for (let i = 0; i < 4; i++) {
		const [s, k1, k2, a1, a2, k3, k4, e] = cur.map(([x, y]) => [f(x + x0), f(y + y0)]);
		out += `${i === 0 ? 'M' : 'L'}${s}C${k1} ${k2} ${a1}A${r} ${r} 0 0 1 ${a2}C${k3} ${k4} ${e}`;
		cur = cur.map(rot);
	}
	return out.replace(/,/g, ' ') + 'Z';
}

/** タイル(角丸の正方形)を tile.size 角で中央に置き、シンボルをタイル幅の widthRatio で載せる */
function tileIconSvg({ margin, radius, widthRatio, shadow = false }) {
	const size = 1024 - margin * 2;
	const scale = (size * widthRatio) / SYMBOL.w;
	const tx = 512 - (SYMBOL.x + SYMBOL.w / 2) * scale;
	const ty = 512 - (SYMBOL.y + SYMBOL.h / 2) * scale;
	const shape = squirclePath(margin, margin, size, radius);
	return (
		`<svg ${NS} width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">` +
		`<defs><linearGradient id="bg" x1="0" y1="${margin}" x2="0" y2="${1024 - margin}" gradientUnits="userSpaceOnUse">` +
		`<stop stop-color="${COLORS.iconTop}"/><stop offset="1" stop-color="${COLORS.iconBottom}"/></linearGradient>` +
		(shadow
			? `<filter id="sh" x="0" y="0" width="1024" height="1024" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
				`<feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity="0.3"/></filter>`
			: '') +
		`</defs>` +
		`<path d="${shape}" fill="url(#bg)"${shadow ? ' filter="url(#sh)"' : ''}/>` +
		`<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">` +
		symbolInner(COLORS.iconFeather, COLORS.iconSpark) +
		`</g></svg>\n`
	);
}

// macOS(Big Sur 以降のアイコングリッド): 824 角の連続曲線の角丸(半径 186)を中央に置き、周囲 100px は透明。
// シンボルはタイル幅の 68%(全面塗りのときのキャンバス幅に対する割合と同じ)。控えめな影つき
const APP_ICON_MACOS = tileIconSvg({ margin: 100, radius: 186, widthRatio: 0.68, shadow: true });
// Windows / Linux: 余白は片側 40px。半径 208(タイル幅の約 22%)。小さいサイズで羽根が潰れにくいよう、やや大きめに置く
const APP_ICON_WINDOWS = tileIconSvg({ margin: 40, radius: 208, widthRatio: 0.72 });

// Windows の 32px 以下(ICO の小サイズ): 余白と角丸を抑え、シンボルを大きく置く
const APP_ICON_WINDOWS_SMALL = tileIconSvg({ margin: 24, radius: 200, widthRatio: 0.8 });

// 全面塗り(apple-touch-icon): シンボル幅 68%(セーフゾーン内)
const APP_ICON = iconSvg({ widthRatio: 0.68 });
// 角丸(PWA の purpose=any): 角丸の外は透明
const APP_ICON_ROUNDED = iconSvg({ rx: 224, widthRatio: 0.68 });
// マスカブル: 中心の直径 80% の円に収める(対角の半分 × 倍率 <= 0.4 × 1024)
const APP_ICON_MASKABLE = iconSvg({ widthRatio: 0.56 });
// 小さいサイズ(favicon.ico)用: 16px でも羽根が判別できるよう大きめに置く
const FAVICON_TILE = iconSvg({ rx: 224, widthRatio: 0.8 });

// タブ用のシンボルのみの favicon。OS の明暗で色を切り替える
const FAVICON_SVG =
	`<svg ${NS} viewBox="${markViewBox}" fill="none"><style>` +
	`.f{fill:${COLORS.ink}}.s{fill:${COLORS.spark}}` +
	`@media (prefers-color-scheme:dark){.f{fill:${COLORS.inkLight}}.s{fill:${COLORS.sparkLight}}}` +
	`</style>` +
	featherPaths.map((p) => `<path class="f" d="${p.d}"/>`).join('') +
	sparkPaths.map((p) => `<path class="s" d="${p.d}"/>`).join('') +
	`</svg>\n`;

// ---- 書き出し ---------------------------------------------------------------
const write = (rel, data) => {
	mkdirSync(path.dirname(at(rel)), { recursive: true });
	writeFileSync(at(rel), data);
};

write('static/brand/storift-logo-light.svg', fullSvg(COLORS.inkLight, COLORS.sparkLight));
write('static/brand/storift-mark.svg', markSvg(COLORS.ink, COLORS.spark));
write('static/brand/storift-mark-light.svg', markSvg(COLORS.inkLight, COLORS.sparkLight));
write('static/brand/storift-wordmark.svg', wordSvg(COLORS.ink));
write('static/brand/storift-wordmark-light.svg', wordSvg(COLORS.inkLight));
write('static/brand/app-icon.svg', APP_ICON);
write('static/brand/app-icon-rounded.svg', APP_ICON_ROUNDED);
write('static/brand/app-icon-maskable.svg', APP_ICON_MASKABLE);
write('static/brand/app-icon-macos.svg', APP_ICON_MACOS);
write('static/brand/app-icon-windows.svg', APP_ICON_WINDOWS);
write('static/favicon.svg', FAVICON_SVG);
write('site/static/favicon.svg', FAVICON_SVG);

// ---- ラスタライズ -----------------------------------------------------------
const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });
const page = await context.newPage();

/** SVG 文字列を size 角の PNG(透過)にする */
async function rasterize(svg, size) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
	);
	return page.screenshot({ type: 'png', omitBackground: true });
}

const png = (rel, buf) => write(rel, buf);

for (const size of [72, 96, 128, 144, 152, 192, 384, 512]) {
	png(`static/favicon/icon-${size}.png`, await rasterize(APP_ICON_ROUNDED, size));
}
for (const size of [192, 512]) {
	png(`static/favicon/maskable-${size}.png`, await rasterize(APP_ICON_MASKABLE, size));
}
png('static/favicon/apple-touch-icon.png', await rasterize(APP_ICON, 180));

/** PNG の配列から PNG-in-ICO を作る(size 256 は幅・高さのフィールドに 0 を書く) */
function buildIco(sizes, images) {
	const head = Buffer.alloc(6 + 16 * sizes.length);
	head.writeUInt16LE(0, 0);
	head.writeUInt16LE(1, 2);
	head.writeUInt16LE(sizes.length, 4);
	let offset = head.length;
	sizes.forEach((size, i) => {
		const o = 6 + i * 16;
		head.writeUInt8(size >= 256 ? 0 : size, o);
		head.writeUInt8(size >= 256 ? 0 : size, o + 1);
		head.writeUInt16LE(1, o + 4);
		head.writeUInt16LE(32, o + 6);
		head.writeUInt32LE(images[i].length, o + 8);
		head.writeUInt32LE(offset, o + 12);
		offset += images[i].length;
	});
	return Buffer.concat([head, ...images]);
}

// favicon.ico(PNG-in-ICO)
const icoSizes = [16, 32, 48];
const icoImages = [];
for (const size of icoSizes) icoImages.push(await rasterize(FAVICON_TILE, size));
write('static/favicon.ico', buildIco(icoSizes, icoImages));

// Windows のアイコン(icon.ico): 各サイズを SVG から直接描く。tauri icon の縮小では
// 16px の角に色つきの薄い残りが出て、128px も入らないため。32px 以下は羽根が潰れないよう大きめに置く
const winIcoSizes = [16, 24, 32, 48, 64, 128, 256];
const winIcoImages = [];
for (const size of winIcoSizes) {
	winIcoImages.push(await rasterize(size <= 32 ? APP_ICON_WINDOWS_SMALL : APP_ICON_WINDOWS, size));
}
const WINDOWS_ICO = buildIco(winIcoSizes, winIcoImages);

// Tauri 用の元画像(1024px)
png('scripts/app-icon-macos.png', await rasterize(APP_ICON_MACOS, 1024));
png('scripts/app-icon-windows.png', await rasterize(APP_ICON_WINDOWS, 1024));

// サイト: favicon 一式と OG 画像
write('site/static/favicon.ico', readFileSync(at('static/favicon.ico')));
for (const name of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
	write(`site/static/favicon/${name}`, readFileSync(at('static/favicon', name)));
}

const ogLogo = fullSvg(COLORS.ink, COLORS.spark).replace(' width="1161" height="236"', '');
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(
	`<!doctype html><meta charset="utf-8"><style>
html,body{margin:0}
body{width:1200px;height:630px;background:${COLORS.paper};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px;font-family:'Noto Sans JP','IPAGothic','Hiragino Sans','Yu Gothic',sans-serif}
svg{width:760px;height:auto;display:block}
p{margin:0;font-size:38px;letter-spacing:.08em;color:${COLORS.text}}
small{display:block;margin-top:14px;font-size:24px;letter-spacing:.06em;color:${COLORS.textSecondary};text-align:center}
</style>${ogLogo}<div><p>小説を書くための、ひとつの場所。</p><small>執筆・プロット・人物・設定資料・進捗をひとつに</small></div>`
);
write('site/static/og.png', await page.screenshot({ type: 'png' }));

await browser.close();

// ---- Tauri のアイコン ---------------------------------------------------------
const tauriCli = at('node_modules/@tauri-apps/cli/tauri.js');
if (!existsSync(tauriCli)) throw new Error('@tauri-apps/cli が見つかりません(bun install)');
/** tauri icon が書く icns は、エントリの並びが実行ごとに変わる。種別順に並べ直して、出力を決定的にする */
function sortIcns(buf) {
	const entries = [];
	for (let o = 8; o < buf.length; ) {
		const len = buf.readUInt32BE(o + 4);
		entries.push(buf.subarray(o, o + len));
		o += len;
	}
	entries.sort((a, b) => a.subarray(0, 4).compare(b.subarray(0, 4)));
	const head = Buffer.alloc(8);
	head.write('icns', 0, 'ascii');
	head.writeUInt32BE(8 + entries.reduce((n, e) => n + e.length, 0), 4);
	return Buffer.concat([head, ...entries]);
}

const tauriIcon = (source, outDir) => {
	const result = spawnSync(process.execPath, [tauriCli, 'icon', source, '-o', outDir], {
		stdio: 'inherit',
		cwd: ROOT
	});
	if (result.status !== 0) throw new Error(`tauri icon に失敗しました(${source})`);
};
const work = mkdtempSync(path.join(tmpdir(), 'storift-icons-'));
try {
	const macDir = path.join(work, 'macos');
	const winDir = path.join(work, 'windows');
	tauriIcon(at('scripts/app-icon-macos.png'), macDir);
	tauriIcon(at('scripts/app-icon-windows.png'), winDir);

	// 出力先を空にしてから、Windows 版の PNG / ICO(モバイル向けの android / ios は置かない)と macOS 版の icns を置く
	const outDir = at('src-tauri/icons');
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	for (const name of readdirSync(winDir)) {
		if (/\.(png|ico)$/.test(name)) copyFileSync(path.join(winDir, name), path.join(outDir, name));
	}
	writeFileSync(
		path.join(outDir, 'icon.icns'),
		sortIcns(readFileSync(path.join(macDir, 'icon.icns')))
	);
	// icon.ico は tauri icon のものではなく、各サイズを直接描いたもの
	writeFileSync(path.join(outDir, 'icon.ico'), WINDOWS_ICO);
} finally {
	rmSync(work, { recursive: true, force: true });
}

console.log('アイコンを作り直しました');
