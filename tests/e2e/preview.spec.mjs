// 作品全体を通したプレビュー(/project/[id]/preview)の E2E。
// `bun run test:e2e:preview` から実行する(Firebase / エミュレータ不要)。
// vite dev(空きポート)を起動し、プリインストールの Chromium(Playwright)で操作する。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const READER = '[data-testid="reader"]';
const WHERE = '[data-testid="where"] .where-scene';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(description, fn, timeout = 30_000, interval = 150) {
	const start = Date.now();
	let last;
	while (Date.now() - start < timeout) {
		try {
			const value = await fn();
			if (value) return value;
			last = value;
		} catch (error) {
			last = error;
		}
		await sleep(interval);
	}
	throw new Error(`タイムアウト: ${description} (最後の値: ${String(last)})`);
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

async function startVite(port) {
	const child = spawn(
		'bunx',
		['vite', 'dev', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
		{
			cwd: ROOT,
			env: { ...process.env, BROWSER: 'none' },
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: true
		}
	);
	let log = '';
	child.stdout.on('data', (d) => (log += d));
	child.stderr.on('data', (d) => (log += d));
	await waitFor(
		'vite dev の起動',
		async () => {
			if (child.exitCode !== null) throw new Error(`vite が終了しました:\n${log}`);
			const res = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
			return res?.ok;
		},
		90_000,
		500
	);
	return {
		stop() {
			try {
				process.kill(-child.pid, 'SIGTERM');
			} catch {
				// 既に終了している
			}
		}
	};
}

const failures = [];
function check(name, condition, detail = '') {
	console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
	if (!condition) failures.push(name);
}

async function newPage(browser, base, options = {}) {
	const context = await browser.newContext({
		serviceWorkers: 'block',
		locale: 'ja-JP',
		viewport: { width: 1280, height: 800 },
		...options
	});
	const page = await context.newPage();
	page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
	await page.goto(`${base}/home`);
	await page.evaluate(async () => {
		const { settingsDB } = await import('/src/lib/db/index.ts');
		await settingsDB.update({ setupCompleted: true, tutorialDismissed: true });
	});
	return { context, page };
}

/** 小さな作品: 章 3(うち 1 つは空)+ 章に属さないシーン + 空のシーン + ルビ + HTML を含む本文 */
async function createSmallProject(page) {
	return await page.evaluate(async () => {
		const { db } = await import('/src/lib/db/schema.ts');
		const { projectsDB } = await import('/src/lib/db/index.ts');
		const project = await projectsDB.create({ title: 'E2E 通読テスト' });
		const now = Date.now();
		const ch = (id, order, title) => ({
			id,
			projectId: project.id,
			title,
			order,
			synopsis: '',
			createdAt: now,
			updatedAt: now,
			_version: 1
		});
		const sc = (id, chapterId, order, title, content) => ({
			id,
			chapterId,
			projectId: project.id,
			title,
			content,
			order,
			characterCount: content.length,
			tags: [],
			createdAt: now,
			updatedAt: now,
			_version: 1
		});
		// スクロールが必要な長さにする
		const filler =
			'\n' + Array.from({ length: 40 }, (_, i) => `${i + 1} 行目の本文です。`).join('\n');
		// 章の order と登録順をわざとずらす
		await db.chapters.bulkAdd([
			ch('c3', 2, '第三章'),
			ch('c1', 0, '第一章'),
			ch('c2', 1, '第二章(空)')
		]);
		await db.scenes.bulkAdd([
			sc('s1-2', 'c1', 1, 'シーンB', '二つ目の場面。\n\n空行の後の段落。' + filler),
			sc(
				's1-1',
				'c1',
				0,
				'シーンA',
				'漢字《かんじ》のルビと《《傍点》》。<img src=x onerror="window.__xss=1">'
			),
			sc('s3-1', 'c3', 0, '空のシーン', ''),
			sc('s3-2', 'c3', 1, 'シーンD', '最後の場面です。' + filler),
			sc('orphan', 'no-such-chapter', 0, '迷子のシーン', '章に属さない本文。')
		]);
		return project.id;
	});
}

/** 長編: 章 50 × シーン 10、各 1000 字(計 50 万字) */
async function createLongProject(page) {
	return await page.evaluate(async () => {
		const { db } = await import('/src/lib/db/schema.ts');
		const { projectsDB } = await import('/src/lib/db/index.ts');
		const project = await projectsDB.create({ title: 'E2E 長編' });
		const now = Date.now();
		const chapters = [];
		const scenes = [];
		const line = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。';
		for (let c = 0; c < 50; c++) {
			chapters.push({
				id: `lc${c}`,
				projectId: project.id,
				title: `第${c}章`,
				order: c,
				synopsis: '',
				createdAt: now,
				updatedAt: now,
				_version: 1
			});
			for (let s = 0; s < 10; s++) {
				let body = `〈c${c}s${s}〉`;
				while (body.length < 1000) body += (body.length % 7 === 0 ? '\n' : '') + line;
				body = body.slice(0, 1000);
				scenes.push({
					id: `ls${c}-${s}`,
					chapterId: `lc${c}`,
					projectId: project.id,
					title: `〈c${c}s${s}〉`,
					content: body,
					order: s,
					characterCount: body.length,
					tags: [],
					createdAt: now,
					updatedAt: now,
					_version: 1
				});
			}
		}
		await db.chapters.bulkAdd(chapters);
		await db.scenes.bulkAdd(scenes);
		return project.id;
	});
}

const unitIds = (page) =>
	page.$$eval(`${READER} .unit`, (els) => els.map((e) => e.getAttribute('data-scene-id')));

const where = (page) => page.locator(WHERE).innerText();

/** シーン先頭の、リーダー(表示領域)の読み始めの端からの距離 */
const unitOffset = (page, sceneId) =>
	page.evaluate(
		({ sceneId, sel }) => {
			const reader = document.querySelector(sel);
			const el = reader.querySelector(`.unit[data-scene-id="${sceneId}"]`);
			const r = el.getBoundingClientRect();
			const c = reader.getBoundingClientRect();
			return getComputedStyle(reader).writingMode.startsWith('vertical')
				? c.right - r.right
				: r.top - c.top;
		},
		{ sceneId, sel: READER }
	);

async function openToc(page) {
	if ((await page.locator('[data-testid="toc"]').count()) === 0) {
		await page.locator('[data-testid="toc-toggle"]').click();
	}
	await page.locator('[data-testid="toc"]').waitFor();
}

async function openPreview(page, base, pid) {
	await page.goto(`${base}/project/${pid}/preview`);
	await page.locator(READER).waitFor({ timeout: 30_000 });
}

async function main() {
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;
	const vite = await startVite(port);
	const browser = await chromium.launch();
	try {
		// ---------- 小さな作品(デスクトップ幅) ----------
		console.log('[小さな作品 / デスクトップ]');
		const { context, page } = await newPage(browser, base);
		const pid = await createSmallProject(page);
		await openPreview(page, base, pid);

		const expectedOrder = ['s1-1', 's1-2', 's3-1', 's3-2', 'orphan'];
		check(
			'章順・シーン順・孤立シーンは最後で全シーンを表示',
			JSON.stringify(await unitIds(page)) === JSON.stringify(expectedOrder),
			JSON.stringify(await unitIds(page))
		);
		const headings = await page.$$eval(`${READER} h2`, (els) => els.map((e) => e.textContent));
		check(
			'章見出し(空の章・孤立用の擬似章を含む)',
			JSON.stringify(headings) ===
				JSON.stringify(['第一章', '第二章(空)', '第三章', '章に属さないシーン']),
			JSON.stringify(headings)
		);
		check('h1 は作品名', (await page.locator(`${READER} h1`).innerText()) === 'E2E 通読テスト');
		// 遅延描画のため、端までスクロールして全シーンを描画させてから先頭へ戻る
		for (let y = 0; y < 20; y++) {
			await page.locator(READER).evaluate((el) => {
				el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
				el.scrollTop += 700;
			});
			await sleep(80);
		}
		await waitFor(
			'小さな作品の本文が描画される',
			async () => (await page.locator(`${READER} .unit.rendered`).count()) === 5
		);
		await page.locator(READER).evaluate((el) => (el.scrollTop = 0));
		await sleep(300);
		const text = await page.locator(READER).evaluate((el) => el.textContent);
		check(
			'本文が順に並ぶ',
			text.indexOf('二つ目の場面') < text.indexOf('最後の場面です') &&
				text.indexOf('最後の場面です') < text.indexOf('章に属さない本文')
		);
		check('空のシーンは(本文なし)', text.includes('（本文なし）'));
		check('空の章は注記つきで落ちない', text.includes('まだシーンがありません'));
		check(
			'ルビを <ruby> で描画',
			(await page.locator(`${READER} ruby rt`).first().innerText()) === 'かんじ'
		);
		check('傍点を描画', (await page.locator(`${READER} .bouten`).count()) === 1);
		check(
			'本文の HTML はエスケープされ実行されない',
			(await page.evaluate(() => window.__xss)) === undefined &&
				(await page.locator(`${READER} img`).count()) === 0 &&
				text.includes('<img src=x')
		);
		const total = await page.locator('[data-testid="progress-text"]').innerText();
		check('進捗に総文字数を表示', /^0% ・ 0 \/ 1,\d{3}字$/.test(total.trim()), total);

		// 目次
		await openToc(page);
		check(
			'目次は nav(ラベル付き)',
			(await page.locator('[data-testid="toc"] nav[aria-label="目次"]').count()) === 1
		);
		await page.locator('[data-testid="toc"] .toc-scene', { hasText: 'シーンD' }).click();
		await waitFor('目次からシーンDへジャンプ', async () => (await where(page)) === 'シーンD');
		const pct = await page.locator('[data-testid="progress-text"]').innerText();
		check('ジャンプ後に進捗が進む', !pct.trim().startsWith('0%'), pct.trim());
		await page.keyboard.press('Escape');
		check(
			'Esc で目次が閉じ、ボタンへフォーカスが戻る',
			(await page.locator('[data-testid="toc"]').count()) === 0 &&
				(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) ===
					'toc-toggle'
		);

		// 縦書き
		await page.locator('[data-testid="mode-vertical"]').click();
		await waitFor(
			'縦書きに切替',
			async () =>
				(await page.locator(READER).evaluate((el) => getComputedStyle(el).writingMode)) ===
				'vertical-rl'
		);
		check(
			'縦書きに切り替えても読んでいたシーンを保つ',
			await waitFor('位置保持', async () => (await where(page)) === 'シーンD', 3000)
		);
		const prefs = await page.evaluate(() => localStorage.getItem('storift:manuscript-prefs'));
		check('表示設定を端末内に保存', JSON.parse(prefs).writingMode === 'vertical', prefs);

		// 文字サイズ
		await page.locator('[data-testid="settings-toggle"]').click();
		const before = await page
			.locator(READER)
			.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		await page.locator('[data-testid="size-up"]').click();
		const after = await page
			.locator(READER)
			.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		check('文字サイズを変更できる', after === before + 1, `${before} -> ${after}`);
		await page.keyboard.press('Escape');
		check('Esc で表示設定が閉じる', (await page.locator('[data-testid="size-up"]').count()) === 0);

		// エディタで開く
		await page.locator('[data-testid="mode-horizontal"]').click();
		await sleep(300);
		await page.locator(`${READER} .unit[data-scene-id="s1-2"] .open-btn`).click();
		await page.waitForURL(`**/project/${pid}/editor`);
		await waitFor(
			'エディタが該当シーンを開く',
			async () =>
				(await page
					.locator('.editor-title')
					.first()
					.innerText()
					.catch(() => '')) === 'シーンB'
		);
		check('「エディタで開く」で該当シーンの編集画面へ', true);

		// エディタのツールバーから戻れる
		await page.locator('[data-testid="open-manuscript-preview"]').click();
		await page.waitForURL(`**/project/${pid}/preview`);
		check('エディタのツールバーから通読プレビューを開ける', true);
		await context.close();

		// ---------- 長編 ----------
		console.log('[長編 50 万字 / デスクトップ]');
		const long = await newPage(browser, base);
		const lpid = await createLongProject(long.page);
		const t0 = Date.now();
		await long.page.goto(`${base}/project/${lpid}/preview`);
		await long.page.locator(`${READER} .unit.rendered .body`).first().waitFor({ timeout: 30_000 });
		const initialMs = Date.now() - t0;
		console.log(`  初期表示(goto から最初の本文が見えるまで): ${initialMs} ms`);
		check('初期表示が数秒以内(vite dev)', initialMs < 5000, `${initialMs} ms`);
		const units = await long.page.locator(`${READER} .unit`).count();
		const renderedCount = await long.page.locator(`${READER} .unit.rendered`).count();
		check('全 500 シーンが構造として存在', units === 500, String(units));
		check('本文の描画は近傍だけ(遅延描画)', renderedCount < 40, `${renderedCount}/500`);
		const ptext = await long.page.locator('[data-testid="progress-text"]').innerText();
		check('総文字数 500,000 字', ptext.includes('/ 500,000字'), ptext);

		// 遠くへジャンプしても位置がずれない
		await openToc(long.page);
		await long.page.locator('[data-testid="toc"] .toc-scene', { hasText: '〈c37s4〉' }).click();
		await waitFor('c37s4 へジャンプ', async () => (await where(long.page)) === '〈c37s4〉');
		await sleep(1200);
		const o1 = await unitOffset(long.page, 'ls37-4');
		await sleep(600);
		const o2 = await unitOffset(long.page, 'ls37-4');
		check(
			'ジャンプ先が遅延描画後も読み始めの端に留まる(横書き)',
			Math.abs(o1 - o2) < 2 && Math.abs(o2) < 40 && (await where(long.page)) === '〈c37s4〉',
			`offset ${o1.toFixed(1)} -> ${o2.toFixed(1)}`
		);
		const pctMid = await long.page.locator('[data-testid="progress-text"]').innerText();
		check('進捗が約 75%', /^7[45]%/.test(pctMid.trim()), pctMid.trim());

		// 手前へ戻るスクロールでも現在位置が飛ばない(横書き): 4 回ずつ上へ
		let drift = true;
		let lastIdx = 37 * 10 + 4;
		for (let i = 0; i < 12; i++) {
			await long.page.locator(READER).evaluate((el) => {
				el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
				el.scrollTop -= 1500;
			});
			await sleep(150);
			const idx = await long.page.evaluate(() => {
				const t = document.querySelector('[data-testid="where"] .where-scene').textContent;
				const m = /c(\d+)s(\d+)/.exec(t);
				return Number(m[1]) * 10 + Number(m[2]);
			});
			if (idx > lastIdx) drift = false;
			lastIdx = idx;
		}
		check(
			'遅延描画中に逆スクロールしても現在位置が逆行・飛躍しない',
			drift && lastIdx < 37 * 10 + 4,
			`idx=${lastIdx}`
		);

		// 縦書きの長編
		await long.page.locator('[data-testid="mode-vertical"]').click();
		await waitFor(
			'縦書き',
			async () =>
				(await long.page.locator(READER).evaluate((el) => getComputedStyle(el).writingMode)) ===
				'vertical-rl'
		);
		await sleep(800);
		await openToc(long.page);
		await long.page.locator('[data-testid="toc"] .toc-scene', { hasText: '〈c20s7〉' }).click();
		await waitFor(
			'縦書きで c20s7 へジャンプ',
			async () => (await where(long.page)) === '〈c20s7〉'
		);
		await sleep(1200);
		const v1 = await unitOffset(long.page, 'ls20-7');
		await sleep(600);
		const v2 = await unitOffset(long.page, 'ls20-7');
		check(
			'ジャンプ先が遅延描画後も読み始めの端に留まる(縦書き)',
			Math.abs(v1 - v2) < 2 && Math.abs(v2) < 60 && (await where(long.page)) === '〈c20s7〉',
			`offset ${v1.toFixed(1)} -> ${v2.toFixed(1)}`
		);
		const scrollInfo = await long.page.locator(READER).evaluate((el) => ({
			sw: el.scrollWidth,
			cw: el.clientWidth,
			left: el.scrollLeft
		}));
		check(
			'縦書きは横スクロール(負の scrollLeft = 左へ進む)',
			scrollInfo.sw > scrollInfo.cw * 10 && scrollInfo.left < 0,
			JSON.stringify(scrollInfo)
		);
		// 縦書きで読み進めても現在位置が単調に進む
		let mono = true;
		let prev = 20 * 10 + 7;
		for (let i = 0; i < 12; i++) {
			await long.page.locator(READER).evaluate((el) => {
				el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
				el.scrollLeft -= 1500;
			});
			await sleep(150);
			const idx = await long.page.evaluate(() => {
				const m = /c(\d+)s(\d+)/.exec(
					document.querySelector('[data-testid="where"] .where-scene').textContent
				);
				return Number(m[1]) * 10 + Number(m[2]);
			});
			if (idx < prev) mono = false;
			prev = idx;
		}
		check('縦書きで読み進めると現在位置が単調に進む', mono && prev > 20 * 10 + 7, `idx=${prev}`);

		// 最後の位置の復元(縦書きのまま)
		await sleep(900);
		const savedWhere = await where(long.page);
		const savedPos = await long.page.evaluate(
			(id) => localStorage.getItem(`storift:manuscript-pos:${id}`),
			lpid
		);
		check('最後の位置を localStorage に保存', !!savedPos, savedPos ?? '');
		const savedScene = JSON.parse(savedPos).sceneId;
		await long.page.reload();
		await long.page.locator(READER).waitFor({ timeout: 30_000 });
		await waitFor('復元後のシーン', async () => (await where(long.page)) === savedWhere, 15_000);
		await sleep(1500);
		const restoredOffset = await unitOffset(long.page, savedScene);
		check(
			'再読み込みで同じシーンと位置を復元',
			(await where(long.page)) === savedWhere,
			`${savedWhere} offset=${restoredOffset.toFixed(0)}`
		);
		const savedAfter = JSON.parse(
			await long.page.evaluate((id) => localStorage.getItem(`storift:manuscript-pos:${id}`), lpid)
		);
		const restoredSize = await long.page.evaluate(
			({ id, sel }) =>
				document.querySelector(`${sel} .unit[data-scene-id="${id}"]`).getBoundingClientRect().width,
			{ id: savedScene, sel: READER }
		);
		const expectedOffset = -JSON.parse(savedPos).ratio * restoredSize;
		check(
			'復元位置が「シーン先頭 + 割合」と一致(見積りと実測の差を補正)',
			Math.abs(restoredOffset - expectedOffset) < 3,
			`${restoredOffset.toFixed(1)} vs ${expectedOffset.toFixed(1)}`
		);
		check(
			'復元の途中経過で保存位置を上書きしない',
			savedAfter.sceneId === savedScene &&
				Math.abs(savedAfter.ratio - JSON.parse(savedPos).ratio) < 0.05,
			JSON.stringify(savedAfter)
		);

		// 末尾 = 100%
		await long.page.locator(READER).evaluate((el) => {
			el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
			el.scrollLeft = -el.scrollWidth;
		});
		await sleep(800);
		await long.page.locator(READER).evaluate((el) => {
			el.scrollLeft = -el.scrollWidth;
		});
		await sleep(600);
		const end = await long.page.locator('[data-testid="progress-text"]').innerText();
		check('末尾までスクロールすると 100%', end.trim().startsWith('100%'), end.trim());
		await long.context.close();

		// ---------- スマホ幅 ----------
		console.log('[スマホ幅 iPhone 13]');
		const mobile = await newPage(browser, base, { ...devices['iPhone 13'] });
		const mpid = await createSmallProject(mobile.page);
		await openPreview(mobile.page, base, mpid);
		await sleep(600);
		const layout = await mobile.page.evaluate(() => {
			const bar = document.querySelector('.bar').getBoundingClientRect();
			const rows = [...document.querySelectorAll('.bar-row')].map((r) => ({
				right: r.getBoundingClientRect().right,
				overflow: r.scrollWidth > r.clientWidth + 1
			}));
			const toggle = document.querySelector('[data-testid="toc-toggle"]').getBoundingClientRect();
			const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
			const reader = document.querySelector('[data-testid="reader"]').getBoundingClientRect();
			return {
				docOverflow: document.documentElement.scrollWidth > window.innerWidth,
				barRight: bar.right,
				barLeft: bar.left,
				rows,
				toggleW: toggle.width,
				toggleH: toggle.height,
				innerWidth: window.innerWidth,
				readerBottom: reader.bottom,
				navTop: nav?.top ?? null
			};
		});
		check('横スクロールが発生しない', !layout.docOverflow);
		check(
			'操作バーが画面幅に収まる',
			layout.barLeft >= 0 &&
				layout.barRight <= layout.innerWidth + 0.5 &&
				layout.rows.every((r) => !r.overflow),
			JSON.stringify(layout.rows)
		);
		check(
			'目次ボタンは指で押せる大きさ(44px 以上)',
			layout.toggleW >= 44 && layout.toggleH >= 44,
			`${layout.toggleW}x${layout.toggleH}`
		);
		check(
			'本文が下部ナビに重ならない',
			layout.navTop === null || layout.readerBottom <= layout.navTop + 0.5,
			`${layout.readerBottom} / ${layout.navTop}`
		);
		check(
			'下部ナビに通読の入口がある',
			(await mobile.page.locator('.bottom-nav a[href$="/preview"]').count()) === 1
		);

		await openToc(mobile.page);
		await sleep(400);
		const tocBox = await mobile.page.locator('[data-testid="toc"]').boundingBox();
		check(
			'目次が画面幅に収まる',
			tocBox.x >= 0 && tocBox.x + tocBox.width <= layout.innerWidth + 0.5,
			JSON.stringify(tocBox)
		);
		const itemH = await mobile.page
			.locator('[data-testid="toc"] .toc-scene')
			.first()
			.evaluate((el) => el.getBoundingClientRect().height);
		check('目次の項目は 44px 以上', itemH >= 44, String(itemH));
		await mobile.page.locator('[data-testid="toc"] .toc-scene', { hasText: 'シーンD' }).tap();
		await waitFor('スマホで目次ジャンプ', async () => (await where(mobile.page)) === 'シーンD');
		check(
			'スマホでは目次選択後に目次が閉じる',
			(await mobile.page.locator('[data-testid="toc"]').count()) === 0
		);

		await mobile.page.locator('[data-testid="mode-vertical"]').tap();
		await sleep(600);
		const vOverflow = await mobile.page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth
		);
		check('スマホの縦書きでもページ自体は横にはみ出さない', !vOverflow);
		await mobile.page.locator(`${READER} .unit[data-scene-id="s3-2"] .open-btn`).tap();
		await mobile.page.waitForURL(`**/project/${mpid}/editor`);
		await waitFor(
			'スマホでエディタが該当シーンを開く',
			async () =>
				(await mobile.page
					.locator('.m-title-main')
					.first()
					.innerText()
					.catch(() => '')) === 'シーンD'
		);
		check('スマホでも「エディタで開く」が動く', true);
		await mobile.context.close();

		// ---------- reduced motion ----------
		console.log('[prefers-reduced-motion: reduce]');
		const rm = await newPage(browser, base, { reducedMotion: 'reduce' });
		const rpid = await createSmallProject(rm.page);
		await openPreview(rm.page, base, rpid);
		await openToc(rm.page);
		const anim = await rm.page
			.locator('[data-testid="toc"]')
			.evaluate((el) => getComputedStyle(el).animationName);
		check('目次のアニメーションを止める', anim === 'none', anim);
		await rm.context.close();
	} finally {
		await browser.close();
		vite.stop();
	}

	if (failures.length) {
		console.log(`\n失敗: ${failures.length} 件\n- ${failures.join('\n- ')}`);
		process.exit(1);
	}
	console.log('\nすべて成功');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
