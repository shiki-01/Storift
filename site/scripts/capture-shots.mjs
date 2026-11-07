// サイトに載せるアプリの実画面を撮り直す。
// 使い方: アプリの dev サーバーを 5181 番で起動してから、リポジトリ直下で
//   node site/scripts/capture-shots.mjs            (すべて撮る)
//   node site/scripts/capture-shots.mjs relation world   (名前を指定すると、その画像だけ撮る)
// Playwright(Chromium)の使い捨てのコンテキストに、撮影用の作品(seed.js)を入れて撮るので、手元の作品には触れない。
// Playwright は E2E と同じく、リポジトリ外にインストール済みのものを require する(`playwright install` はしない)。
// 画像は WebP(device scale 1.5)で、site/static/shots/ に <名前>-light.webp / <名前>-dark.webp を書く。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = new URL('../static/shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(out, { recursive: true });
const base = process.env.APP_DEV_URL || 'http://localhost:5181';
const P = 'cap-project';
const WIDTH = 1280;
const HEIGHT = 800;
const SCALE = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALL = ['home', 'editor', 'split', 'relation', 'world', 'progress'];
const wanted = process.argv.slice(2);
for (const n of wanted)
	if (!ALL.includes(n)) throw new Error(`未知の画像名: ${n}(${ALL.join(', ')})`);
const names = wanted.length ? wanted : ALL;

const browser = await chromium.launch({ args: ['--hide-scrollbars'] });
const context = await browser.newContext({
	viewport: { width: WIDTH, height: HEIGHT },
	deviceScaleFactor: SCALE,
	serviceWorkers: 'block',
	locale: 'ja-JP',
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
const cdp = await context.newCDPSession(page);

await page.goto(`${base}/`);
await sleep(5000);
await page.evaluate(readFileSync(new URL('./seed.js', import.meta.url), 'utf8'));

const open = async (path, wait = 3000) => {
	await page.goto(`${base}${path}`);
	await sleep(wait);
};
const setTheme = async (theme) => {
	await page.evaluate(
		`import('/src/lib/stores/theme.svelte.ts').then(m => m.themeStore.setTheme('${theme}'))`
	);
	await sleep(700);
};
const clickText = (t) =>
	page.evaluate(`(() => {
		const el = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(t)});
		if (el) el.click();
		return !!el;
	})()`);

for (const theme of ['light', 'dark']) {
	// 画面を開き直すと、テーマが読み込み直しの影響を受けることがあるので、撮る直前にも設定する
	const shot = async (name) => {
		await setTheme(theme);
		const r = await cdp.send('Page.captureScreenshot', {
			format: 'webp',
			quality: 82,
			clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: SCALE }
		});
		writeFileSync(`${out}${name}-${theme}.webp`, Buffer.from(r.data, 'base64'));
		console.log(`${name}-${theme}.webp`);
	};

	if (names.includes('home')) {
		await open('/home', 5000);
		await clickText('あとで');
		await sleep(600);
		await shot('home');
	}

	if (names.includes('editor') || names.includes('split')) {
		await open(`/project/${P}/editor`, 6000);
		await page.evaluate(`(() => {
			const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === '祖母の栞');
			if (el) el.click();
		})()`);
		await sleep(1500);
		if (names.includes('editor')) await shot('editor');
		if (names.includes('split')) {
			const toggle = page.locator('[aria-label="二画面表示"]');
			if (!(await toggle.count())) throw new Error('二画面表示のボタンが見つからない');
			await toggle.first().click();
			await sleep(1500);
			await shot('split');
		}
	}

	if (names.includes('relation')) {
		await open(`/project/${P}/characters`);
		await page.getByRole('button', { name: '相関図' }).first().click();
		await sleep(2500);
		await shot('relation');
	}

	if (names.includes('world')) {
		// 一覧と詳細の画面。先頭の「場所」の項目を開いて、詳細に全文が出た状態で撮る
		await open(`/project/${P}/worldbuilding`);
		await page.getByText('坂の上の古書店', { exact: true }).first().click();
		await sleep(1200);
		await shot('world');
	}

	if (names.includes('progress')) {
		await open(`/project/${P}/progress`, 5000);
		await shot('progress');
	}
}
await browser.close();
