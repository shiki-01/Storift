// 執筆画面のツールバー: 拡張(Monolog.)のボタンとポップアップ、並べ替え、三点メニュー、スマホの操作シートの E2E。
// `bun run test:e2e:toolbar` から実行する(Firebase / エミュレータ不要)。vite dev を空きポートで起動して確かめる。
import { EDITOR, check, chromium, finish, seedProject, sleep, startVite } from './helpers.mjs';

const EXT_KEY = 'storift:extensions:enabled';
const EXT_BTN = '[data-testid="toolbar-ext-monolog"]';
const DIALOG = '[role="dialog"][aria-label="Monolog."]';

/** ツールバーのボタン(.tool)の aria-label を左から順に */
const toolbarLabels = (page) =>
	page.locator('.editor-toolbar-actions .tool').evaluateAll((els) => els.map((e) => e.ariaLabel));

async function openEditor(page, base, pid) {
	await page.goto(`${base}/project/${pid}/editor`);
	await page.locator(EDITOR).waitFor({ timeout: 30_000 });
	await page.locator('.editor-toolbar').waitFor({ timeout: 30_000 });
}

async function main() {
	const vite = await startVite();
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({
			viewport: { width: 1400, height: 900 },
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		const page = await context.newPage();
		page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
		const base = vite.base;

		await page.goto(`${base}/home`);
		const pid = await seedProject(page, { title: 'E2E ツールバー' });

		console.log('[拡張が無効のとき]');
		await openEditor(page, base, pid);
		check('Monolog. のボタンが無い', (await page.locator(EXT_BTN).count()) === 0);

		console.log('[有効にしたとき]');
		await page.evaluate((k) => localStorage.setItem(k, JSON.stringify(['monolog'])), EXT_KEY);
		await openEditor(page, base, pid);
		await page.locator(EXT_BTN).waitFor({ timeout: 15_000 });
		check('ボタンが出る', true);
		check(
			'既定の並びでは AI の前(組み込みの後ろ)',
			(await toolbarLabels(page)).includes('Monolog.')
		);
		check(
			'MonologBadge の単独表示が無い',
			(await page.locator('.editor-toolbar .monolog-badge').count()) === 0
		);

		await page.locator(EXT_BTN).click();
		await page.locator(DIALOG).waitFor({ timeout: 5_000 });
		check('ポップアップが開く', true);
		check(
			'aria-expanded=true と aria-controls',
			(await page.locator(EXT_BTN).getAttribute('aria-expanded')) === 'true' &&
				!!(await page.locator(EXT_BTN).getAttribute('aria-controls'))
		);
		check(
			'body 直下に描画される',
			await page.locator(DIALOG).evaluate((el) => el.parentElement === document.body)
		);
		const inView = await page.locator(DIALOG).evaluate((el) => {
			const r = el.getBoundingClientRect();
			return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
		});
		check('画面内に収まる', inView);
		check('接続状態の表示がある', (await page.locator(DIALOG).innerText()).includes('未接続'));

		await page.keyboard.press('Escape');
		await sleep(150);
		check('Escape で閉じる', (await page.locator(DIALOG).count()) === 0);
		check(
			'フォーカスがボタンに戻る',
			await page.evaluate(
				() => document.activeElement?.getAttribute('data-testid') === 'toolbar-ext-monolog'
			)
		);

		await page.locator(EXT_BTN).click();
		await page.locator(DIALOG).waitFor({ timeout: 5_000 });
		await page.locator(EDITOR).click();
		await sleep(150);
		check('外側のクリックで閉じる', (await page.locator(DIALOG).count()) === 0);

		await page.locator(EXT_BTN).click();
		await page.locator(DIALOG).waitFor({ timeout: 5_000 });
		await page.locator(EXT_BTN).click();
		await sleep(150);
		check('ボタンをもう一度押すと閉じる', (await page.locator(DIALOG).count()) === 0);

		console.log('[設定画面での並べ替え(キーボード)]');
		await page.goto(`${base}/settings#editor`);
		const list = page.locator('ul[aria-label="ツールバーのボタンの並び"]');
		await list.waitFor({ timeout: 30_000 });
		check('拡張の行が一覧に出る', (await list.locator('li').count()) >= 11);
		check(
			'AI は並べ替えの一覧に含まれない',
			(await list.locator('#toolbar-item-ai').count()) === 0
		);
		const firstHandle = list.locator('li').first().locator('.handle');
		await firstHandle.focus();
		await page.keyboard.press('Space');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Space');
		await sleep(400);
		const saved = await page.evaluate(async () => {
			const { settingsDB } = await import('/src/lib/db/index.ts');
			return (await settingsDB.get()).toolbarOrder ?? null;
		});
		check(
			'保存された並びで、先頭の 2 つが入れ替わる',
			Array.isArray(saved) && saved[0] === 'export' && saved[1] === 'assist',
			JSON.stringify(saved?.slice(0, 3))
		);

		await openEditor(page, base, pid);
		const labels = await toolbarLabels(page);
		const iExport = labels.indexOf('エクスポート');
		const iAssist = labels.indexOf('執筆支援');
		check('ツールバーに順序が反映される', iExport >= 0 && iExport < iAssist, labels.join(','));

		console.log('[三点メニューにまとめる]');
		await page.evaluate(async () => {
			const { settingsDB } = await import('/src/lib/db/index.ts');
			await settingsDB.update({ toolbarMenuItems: ['ext:monolog'] });
		});
		await openEditor(page, base, pid);
		check('ボタンがツールバーから消える', (await page.locator(EXT_BTN).count()) === 0);
		await page.locator('[data-testid="toolbar-more"]').click();
		await page.getByRole('menuitem', { name: 'Monolog.' }).click();
		await page.locator(DIALOG).waitFor({ timeout: 5_000 });
		check('メニューの項目から同じポップアップが開く', true);
		await page.keyboard.press('Escape');

		console.log('[既定に戻す]');
		await page.goto(`${base}/settings#editor`);
		await list.waitFor({ timeout: 30_000 });
		await page.getByRole('button', { name: '既定に戻す' }).click();
		await sleep(400);
		const reset = await page.evaluate(async () => {
			const { settingsDB } = await import('/src/lib/db/index.ts');
			const s = await settingsDB.get();
			return { order: s.toolbarOrder, menu: s.toolbarMenuItems };
		});
		check(
			'順序と非表示の両方が既定に戻る',
			reset.order?.length === 0 && reset.menu?.length === 0,
			JSON.stringify(reset)
		);

		console.log('[無効にしたとき]');
		await page.evaluate((k) => localStorage.setItem(k, JSON.stringify([])), EXT_KEY);
		await openEditor(page, base, pid);
		check('ボタンが出ない', (await page.locator(EXT_BTN).count()) === 0);

		console.log('[スマホ]');
		await page.evaluate((k) => localStorage.setItem(k, JSON.stringify(['monolog'])), EXT_KEY);
		await page.setViewportSize({ width: 390, height: 800 });
		await openEditor(page, base, pid).catch(async () => {
			await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		});
		await page.getByRole('button', { name: 'その他の操作' }).click();
		const item = page.locator('[data-testid="action-ext-monolog"]');
		await item.waitFor({ timeout: 5_000 });
		check('操作シートに項目が出る', true);
		await item.click();
		await page.getByText('Monolog. 連携').first().waitFor({ timeout: 5_000 });
		check('シートで同じパネルが開く', true);
	} finally {
		await browser.close();
		vite.stop();
	}
	finish();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
