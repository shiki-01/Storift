// サイトに載せるアプリの実画面を撮り直す。
// 使い方: アプリの dev サーバーを 5181 番で起動してから、リポジトリ直下で node site/scripts/capture-shots.mjs
// 使い捨てプロファイルの headless Chrome に撮影用の作品(seed.js)を入れて撮るので、手元の作品には触れない。
import { readFileSync, mkdirSync } from 'node:fs';
import { launch } from './cdp.mjs';

const out = new URL('../static/shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(out, { recursive: true });
const base = process.env.APP_DEV_URL || 'http://localhost:5181';
const P = 'cap-project';
const b = await launch({ width: 1280, height: 800, scale: 1.5 });

await b.goto(base + '/', 7000);
await b.evaluate(readFileSync(new URL('./seed.js', import.meta.url), 'utf8'));

const clickText = (t) =>
	b.evaluate(`(() => {
		const el = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(t)});
		if (el) el.click();
		return !!el;
	})()`);
const clickLabel = (t) =>
	b.evaluate(`(() => {
		const el = document.querySelector('[aria-label=${JSON.stringify(t)}]');
		if (el) el.click();
		return !!el;
	})()`);

for (const theme of ['light', 'dark']) {
	await b.evaluate(
		`import('/src/lib/stores/theme.svelte.ts').then(m => m.themeStore.setTheme('${theme}'))`
	);
	await b.sleep(400);
	const shot = (n) => b.shot(`${out}${n}-${theme}.webp`, 'webp', 82);

	await b.goto(`${base}/home`, 5000);
	await clickText('あとで');
	await b.sleep(600);
	await shot('home');

	await b.goto(`${base}/project/${P}/editor`, 6000);
	await b.evaluate(`(() => {
		const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === '祖母の栞');
		if (el) el.click();
	})()`);
	await b.sleep(1500);
	await shot('editor');
	if (!(await clickLabel('二画面表示'))) throw new Error('二画面表示のボタンが見つからない');
	await b.sleep(1500);
	await shot('split');

	await b.goto(`${base}/project/${P}/characters`, 5000);
	await clickText('相関図');
	await b.sleep(2500);
	await shot('relation');

	await b.goto(`${base}/project/${P}/worldbuilding`, 5000);
	await shot('world');

	await b.goto(`${base}/project/${P}/progress`, 5000);
	await shot('progress');
}
await b.close();
