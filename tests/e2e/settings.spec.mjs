// 設定画面(サイドバー/タブでセクションを切り替える構成)のスモーク E2E。
// `bun run test:e2e:settings` から実行する(Firebase / エミュレータ不要)。
// vite dev(空きポート)を起動し、プリインストールの Chromium(Playwright)で確かめる。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NAV = 'nav[aria-label="設定のセクション"]';
const H2 = '.settings-content h2';

// Web 版(Firebase 未設定)で出るセクション。AI はデスクトップ版だけ
const WEB_SECTIONS = [
	['appearance', '外観'],
	['editor', 'エディタ'],
	['sync', '同期'],
	['sharing', '共有'],
	['data', 'データ'],
	['about', 'このアプリについて']
];

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

/** 新しい端末(コンテキスト)で設定画面を開ける状態にする */
async function openSettings(browser, base, contextOptions, hash = '') {
	const context = await browser.newContext({
		...contextOptions,
		serviceWorkers: 'block',
		locale: 'ja-JP',
		reducedMotion: 'reduce'
	});
	const page = await context.newPage();
	page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
	await page.goto(`${base}/home`);
	await page.evaluate(async () => {
		const { settingsDB } = await import('/src/lib/db/index.ts');
		await settingsDB.update({ setupCompleted: true, tutorialDismissed: true });
	});
	await page.goto(`${base}/settings${hash}`);
	await page.locator(NAV).waitFor({ timeout: 30_000 });
	return { context, page };
}

/**
 * 直接リンク(URL を開き直す)を再現する。
 * 同じ文書内でハッシュだけを goto すると、直前のリンクのクリックによる hashchange が
 * まだ届いていないうちに SvelteKit が popstate を受け取り、URL の反映を飛ばすことがある
 * (クリックから数 ms 以内に別のハッシュへ移る、テスト特有の操作のとき)。
 * 別のページを挟んで、文書ごと読み込み直す。
 */
async function openDirectLink(page, base, hash) {
	await page.goto(`${base}/home`);
	await page.goto(`${base}/settings${hash}`);
	await page.locator(NAV).waitFor();
}

const heading = (page) => page.locator(H2).first().textContent();
const currentLabel = (page) =>
	page
		.locator(`${NAV} a[aria-current="page"]`)
		.evaluateAll((els) => els.map((e) => e.textContent?.trim()));
const savedSettings = (page) =>
	page.evaluate(async () => {
		const { settingsDB } = await import('/src/lib/db/index.ts');
		return await settingsDB.get();
	});

/** 横にはみ出していないか(ページ全体と設定の領域) */
const overflowX = (page) =>
	page.evaluate(() => {
		const doc = document.documentElement;
		const page = document.querySelector('.settings-page');
		const scroll = document.querySelector('.settings-scroll');
		return {
			doc: doc.scrollWidth - doc.clientWidth,
			page: page ? page.scrollWidth - page.clientWidth : 0,
			scroll: scroll ? scroll.scrollWidth - scroll.clientWidth : 0
		};
	});

async function desktopTests(browser, base) {
	console.log('[デスクトップ幅]');
	const { context, page } = await openSettings(browser, base, {
		viewport: { width: 1280, height: 800 }
	});

	check('h1 は「設定」', (await page.locator('h1').textContent())?.trim() === '設定');
	const labels = await page.locator(`${NAV} a`).allTextContents();
	check(
		'サイドバーに Web 版のセクションだけが並ぶ(AI は出ない)',
		JSON.stringify(labels.map((l) => l.trim())) === JSON.stringify(WEB_SECTIONS.map(([, l]) => l)),
		labels.join(',')
	);
	check('hash が無ければ先頭(外観)', (await heading(page))?.trim() === '外観');
	check('現在位置に aria-current', JSON.stringify(await currentLabel(page)) === '["外観"]');

	const navBox = await page.locator(NAV).boundingBox();
	const contentBox = await page.locator('.settings-content').boundingBox();
	check(
		'広い画面ではサイドバーが左、内容が右',
		!!navBox && !!contentBox && navBox.x + navBox.width <= contentBox.x + 1
	);
	check(
		'サイドバーは sticky',
		(await page.locator(NAV).evaluate((el) => getComputedStyle(el).position)) === 'sticky'
	);

	// 各セクションに切り替える
	for (const [index, [id, label]] of WEB_SECTIONS.entries()) {
		await page.locator(`${NAV} a[data-section="${id}"]`).click();
		await waitFor(`${label} が開く`, async () => (await heading(page))?.trim() === label, 5000);
		check(
			`「${label}」に切り替わる(URL の hash と aria-current)`,
			(index === 0 || page.url().endsWith(`#${id}`)) &&
				JSON.stringify(await currentLabel(page)) === `["${label}"]`
		);
		// 先頭は最初から開いているので、切り替えは起きない
		if (index > 0) {
			check(
				`「${label}」切替後、見出しへフォーカスが移る`,
				await page.evaluate(() => document.activeElement?.tagName === 'H2')
			);
		}
	}

	// 直接リンク・旧 hash・未知の hash
	for (const [hash, label] of [
		['#sync', '同期'],
		['#sharing', '共有'],
		['#claude', '外観'],
		['#shortcuts', 'エディタ'],
		['#nonexistent', '外観']
	]) {
		await openDirectLink(page, base, hash);
		check(`直接リンク ${hash} は「${label}」`, (await heading(page))?.trim() === label);
	}

	// 戻る/進む(別のページから開き直して、履歴をアプリの操作だけにする)
	await page.goto(`${base}/home`);
	await page.goto(`${base}/settings#appearance`);
	await page.locator(NAV).waitFor();
	await page.locator(`${NAV} a[data-section="sync"]`).click();
	await waitFor('同期', async () => (await heading(page))?.trim() === '同期', 5000);
	await page.locator(`${NAV} a[data-section="data"]`).click();
	await waitFor('データ', async () => (await heading(page))?.trim() === 'データ', 5000);
	await sleep(400); // SvelteKit が履歴の移動を処理し終えるのを待つ
	await page.goBack();
	await waitFor('戻ると同期', async () => (await heading(page))?.trim() === '同期', 5000);
	check('戻るで前のセクションに戻る', page.url().endsWith('#sync'));
	await sleep(400); // SvelteKit が履歴の移動を処理し終えるのを待つ
	await page.goBack();
	await waitFor('さらに戻ると外観', async () => (await heading(page))?.trim() === '外観', 5000);
	await sleep(400);
	await page.goForward();
	await waitFor('進むと同期', async () => (await heading(page))?.trim() === '同期', 5000);
	check('進むで次のセクションへ', page.url().endsWith('#sync'));

	// キーボード: 矢印で項目間を移動し、Enter で開く
	await page.goto(`${base}/settings#appearance`);
	await page.locator(NAV).waitFor();
	await page.locator(`${NAV} a[data-section="appearance"]`).focus();
	await page.keyboard.press('ArrowDown');
	check(
		'↓ キーで次の項目にフォーカスが移る',
		await page.evaluate(() => document.activeElement?.getAttribute('data-section') === 'editor')
	);
	await page.keyboard.press('Enter');
	await waitFor(
		'Enter でエディタが開く',
		async () => (await heading(page))?.trim() === 'エディタ',
		5000
	);
	check(
		'Enter で開くと見出しへフォーカス',
		await page.evaluate(() => document.activeElement?.tagName === 'H2')
	);
	check(
		'切替を aria-live で知らせる',
		((await page.locator('.settings-page [role="status"]').textContent()) ?? '').includes(
			'エディタ'
		)
	);

	// サイドバーの固定: 内容を長くしてスクロールしても、サイドバーは動かない
	await page.goto(`${base}/settings#editor`);
	await page.locator(NAV).waitFor();
	await page.locator('#fontSize').waitFor();
	const before = (await page.locator(NAV).boundingBox())?.y ?? -1;
	const scrolled = await page.locator('.settings-content').evaluate((el) => {
		el.scrollTop = el.scrollHeight;
		return el.scrollTop;
	});
	await sleep(200);
	const after = (await page.locator(NAV).boundingBox())?.y ?? -2;
	check(
		'スクロールしてもサイドバーの位置は変わらない',
		scrolled > 0 && before >= 0 && after === before,
		`scrolled=${scrolled} before=${before} after=${after}`
	);

	// 主要な操作: テーマの切替
	await page.goto(`${base}/settings#appearance`);
	await page.locator(NAV).waitFor();
	const auto = page.getByLabel('システム設定に従う');
	await auto.waitFor();
	if (await auto.isChecked()) await auto.uncheck();
	await page.getByRole('radio', { name: '墨' }).click();
	await waitFor(
		'テーマが適用・保存される',
		async () =>
			(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark' &&
			(await savedSettings(page)).theme === 'dark',
		10_000
	);
	check('テーマを切り替えると適用・保存される', true);
	await page.getByRole('radio', { name: '和紙' }).click();
	await waitFor(
		'和紙に戻る',
		async () =>
			(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light',
		10_000
	);

	// 主要な操作: 自動保存のトグル(エディタ)
	await page.goto(`${base}/settings#editor`);
	const autoSave = page.getByLabel('自動保存を有効にする');
	await autoSave.waitFor();
	const wasOn = await autoSave.isChecked();
	await autoSave.setChecked(!wasOn);
	await waitFor(
		'自動保存の設定が保存される',
		async () => (await savedSettings(page)).autoSave === !wasOn,
		10_000
	);
	await autoSave.setChecked(wasOn);
	await waitFor(
		'自動保存を元に戻す',
		async () => (await savedSettings(page)).autoSave === wasOn,
		10_000
	);
	check('自動保存のトグルが保存される', true);

	// 主要な操作: 表示名とカーソル表示(共有)
	await page.goto(`${base}/settings#sharing`);
	const nameInput = page.getByLabel('共有時の表示名');
	await nameInput.waitFor({ timeout: 30_000 });
	await nameInput.fill('E2E 太郎');
	await page.getByRole('button', { name: '保存', exact: true }).click();
	await waitFor(
		'表示名が保存される',
		async () => (await savedSettings(page)).displayName === 'E2E 太郎',
		10_000
	);
	check('表示名を入力して保存できる', true);

	const cursor = page.getByLabel('他の人のカーソルを表示');
	await cursor.waitFor();
	check('カーソル表示は既定でオン', await cursor.isChecked());
	await cursor.uncheck();
	await waitFor(
		'カーソル表示のオフが保存される',
		async () => (await savedSettings(page)).showRemoteCursors === false,
		10_000
	);
	await page.reload();
	const cursor2 = page.getByLabel('他の人のカーソルを表示');
	await cursor2.waitFor();
	const keptOff = await waitFor(
		'オフが読み込まれる',
		async () => !(await cursor2.isChecked()),
		5000
	).catch(() => false);
	check('オフにした状態が再読み込み後も残る', keptOff);
	await cursor2.check();
	await waitFor(
		'カーソル表示のオンが保存される',
		async () => (await savedSettings(page)).showRemoteCursors === true,
		10_000
	);

	// 危険な操作は削除ボタンを出すだけ(押さない)
	await page.goto(`${base}/settings#data`);
	check(
		'データ: 全データ削除ボタンが危険な操作として並ぶ',
		(await page.getByRole('button', { name: '全データを削除' }).count()) === 1 &&
			(await page.getByRole('button', { name: 'エクスポート' }).count()) === 1
	);

	const ov = await overflowX(page);
	check(
		'デスクトップ幅で横にはみ出さない',
		ov.doc <= 0 && ov.page <= 0 && ov.scroll <= 0,
		JSON.stringify(ov)
	);

	await context.close();
}

async function mobileTests(browser, base) {
	console.log('[スマホ幅(iPhone 13)]');
	const { context, page } = await openSettings(browser, base, devices['iPhone 13']);

	const navBox = await page.locator(NAV).boundingBox();
	const contentBox = await page.locator('.settings-content').boundingBox();
	check(
		'タブは内容の上に横並びで出る',
		!!navBox && !!contentBox && navBox.y + navBox.height <= contentBox.y + 1
	);
	const tops = await page
		.locator(`${NAV} a`)
		.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
	check('タブは 1 行に並ぶ', new Set(tops).size === 1, tops.join(','));
	check(
		'タブが多くて収まらないときは横スクロールできる',
		await page
			.locator(NAV)
			.evaluate(
				(el) => el.scrollWidth >= el.clientWidth && getComputedStyle(el).overflowX === 'auto'
			)
	);

	for (const [id, label] of WEB_SECTIONS) {
		await page.locator(`${NAV} a[data-section="${id}"]`).click();
		await waitFor(`${label} が開く`, async () => (await heading(page))?.trim() === label, 5000);
		const ov = await overflowX(page);
		check(
			`「${label}」で横にはみ出さない`,
			ov.doc <= 0 && ov.page <= 0 && ov.scroll <= 0,
			JSON.stringify(ov)
		);
		// 一度に 1 セクションだけ表示する
		check(
			`「${label}」だけが表示される`,
			(await page.locator('.settings-content h2').count()) === 1
		);
	}

	// スマホ幅でも主要な操作が動く
	await openDirectLink(page, base, '#sharing');
	const cursor = page.getByLabel('他の人のカーソルを表示');
	await cursor.waitFor({ timeout: 30_000 });
	await cursor.uncheck();
	await waitFor(
		'スマホ幅でカーソル表示のオフが保存される',
		async () => (await savedSettings(page)).showRemoteCursors === false,
		10_000
	);
	check('スマホ幅でも設定を操作できる', true);

	await context.close();
}

async function main() {
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;
	const vite = await startVite(port);
	const browser = await chromium.launch();
	try {
		await desktopTests(browser, base);
		await mobileTests(browser, base);
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
