// サイトに載せるアプリの実画面を撮り直す。
// 使い方: アプリの dev サーバーを 5181 番で起動してから、リポジトリ直下で
//   node site/scripts/capture-shots.mjs            (すべて撮る)
//   node site/scripts/capture-shots.mjs plot world (名前を指定すると、その画像だけ撮る)
// 撮れる画面: home editor split plot characters relation world progress preview settings
// Playwright(Chromium)の使い捨てのコンテキストに、撮影用の作品(seed.js)を入れて撮るので、手元の作品には触れない。
// Playwright は E2E と同じく、リポジトリ外にインストール済みのものを require する(`playwright install` はしない)。
// 画像は WebP(1280x800 を device scale 1.5)で、site/static/shots/ に <名前>-light.webp / <名前>-dark.webp を書く。
// 日時は FIXED_TIME に固定する(進捗のカレンダーなど、撮影日が写り込まないようにする)。
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
const QUALITY = 82;
/** 画面に写る「今日」。実行日に依らず同じ絵になる */
const FIXED_TIME = '2026-06-14T10:00:00+09:00';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALL = [
	'home',
	'editor',
	'split',
	'plot',
	'characters',
	'relation',
	'world',
	'progress',
	'preview',
	'settings'
];
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
	timezoneId: 'Asia/Tokyo',
	reducedMotion: 'reduce'
});
// 時刻だけを固定する(タイマーは止めない)
await context.clock.setFixedTime(FIXED_TIME);
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

const scenes = {
	async home() {
		// 「続きから書く」の欄が、ライトとダークで同じように出るよう、前回開いた作品を決めておく
		await page.evaluate(`localStorage.setItem('storift:last-project', '${P}')`);
		await open('/home', 5000);
		await clickText('あとで');
		await sleep(600);
	},
	async editor() {
		await openScene();
	},
	async split() {
		await openScene();
		const toggle = page.locator('[aria-label="二画面表示"]');
		if (!(await toggle.count())) throw new Error('二画面表示のボタンが見つからない');
		await toggle.first().click();
		await sleep(1500);
	},
	async plot() {
		// ボード。詳細は開かず、四つの列(アイデア〜推敲済み)がすべて見える状態で撮る
		await open(`/project/${P}/plot`);
	},
	async characters() {
		// 一覧と詳細。先頭の人物を開く
		await open(`/project/${P}/characters`);
		await page.getByText('朝倉 灯', { exact: true }).first().click();
		await sleep(1200);
	},
	async relation() {
		await open(`/project/${P}/characters`);
		await page.getByRole('button', { name: '相関図' }).first().click();
		await sleep(2500);
	},
	async world() {
		// 一覧と詳細。先頭の「場所」の項目を開いて、詳細に全文が出た状態で撮る
		await open(`/project/${P}/worldbuilding`);
		await page.getByText('坂の上の古書店', { exact: true }).first().click();
		await sleep(1200);
	},
	async progress() {
		await open(`/project/${P}/progress`, 5000);
	},
	async preview() {
		// 前の撮影のスクロール位置が残らないよう、先頭に戻す(作品名の見出しから写す)
		await open(`/project/${P}/preview`, 5000);
		await page.evaluate(`document.querySelectorAll('*').forEach((el) => (el.scrollTop = 0))`);
		await sleep(500);
	},
	async settings(theme) {
		// 「システム設定に従う」を外してから撮る(付いたままだと、配色の見本が薄く disabled 風に写る)
		await open('/settings#appearance', 3000);
		const follow = page.getByRole('checkbox', { name: 'システム設定に従う' });
		if (await follow.count()) await follow.first().uncheck();
		// 選択中の配色の枠が、撮る配色と合うように、見本の「和紙」「墨」を押しておく
		await page
			.getByText(theme === 'dark' ? '墨' : '和紙', { exact: true })
			.first()
			.click();
		await sleep(500);
	}
};

async function openScene() {
	await open(`/project/${P}/editor`, 6000);
	await page.evaluate(`(() => {
		const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === '祖母の栞');
		if (el) el.click();
	})()`);
	await sleep(1500);
}

for (const theme of ['light', 'dark']) {
	for (const name of names) {
		await scenes[name](theme);
		// 画面を開き直すと、テーマが読み込み直しの影響を受けることがあるので、撮る直前に設定する
		await setTheme(theme);
		// 入力欄や本文のフォーカスの枠が写り込まないようにする
		await page.evaluate(
			`document.activeElement instanceof HTMLElement && document.activeElement.blur()`
		);
		// 点滅する入力位置(キャレット)が、撮るたびに写ったり写らなかったりしないよう消す
		await page.addStyleTag({ content: '* { caret-color: transparent !important; }' });
		await sleep(200);
		const r = await cdp.send('Page.captureScreenshot', {
			format: 'webp',
			quality: QUALITY,
			clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: SCALE }
		});
		writeFileSync(`${out}${name}-${theme}.webp`, Buffer.from(r.data, 'base64'));
		console.log(`${name}-${theme}.webp`);
	}
}
await browser.close();
