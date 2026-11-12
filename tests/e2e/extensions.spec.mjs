// 拡張機能: 設定のカード・同意画面・再同意の促し・執筆セッション(計測中の表示)・スマホの操作シートの E2E。
// `bun run test:e2e:extensions` から実行する(Firebase / エミュレータ不要)。Monolog. の API はモックし、実際には呼ばない。
import { EDITOR, check, chromium, finish, seedProject, sleep, startVite } from './helpers.mjs';

const ENABLED = 'storift:extensions:enabled';
const CONSENT = 'storift:extensions:consent';
const TOKENS = 'storift:monolog:tokens';
const MONOLOG_CARD = '[data-testid="ext-card-monolog"]';

async function mockMonolog(context) {
	await context.route('https://api.monolog.life/**', (route) => {
		const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
		if (route.request().method() === 'OPTIONS')
			return route.fulfill({
				status: 204,
				headers: { ...headers, 'access-control-allow-methods': '*' }
			});
		const body = route.request().url().includes('/timer')
			? {
					status: 'running',
					started_at: new Date().toISOString(),
					elapsed_ms: 0,
					tag: { name: '執筆' }
				}
			: { time_zone: 'Asia/Tokyo' };
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers,
			body: JSON.stringify(body)
		});
	});
}

async function main() {
	const vite = await startVite();
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		await mockMonolog(context);
		const page = await context.newPage();
		page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
		const base = vite.base;
		await page.goto(`${base}/home`);
		const pid = await seedProject(page, { title: 'E2E 拡張' });

		console.log('[設定: カード]');
		await page.goto(`${base}/settings#extensions`);
		await page.locator(MONOLOG_CARD).waitFor({ timeout: 30_000 });
		const card = page.locator(MONOLOG_CARD);
		const text = await card.innerText();
		check(
			'Monolog. のカードに名前・「公式」・対応環境が出る',
			text.includes('Monolog. 連携') &&
				text.includes('公式') &&
				text.includes('Web 版') &&
				text.includes('デスクトップ版')
		);
		check(
			'既定は無効',
			(await card.locator('#ext-monolog').getAttribute('aria-checked')) === 'false'
		);
		const discord = page.locator('[data-testid="ext-card-discord"]');
		check(
			'Discord はデスクトップ版のみで、Web 版ではスイッチを使えない',
			(await discord.locator('#ext-discord').isDisabled()) &&
				(await discord.innerText()).includes('デスクトップ版')
		);
		check(
			'Web 版では Discord の設定を読み込まない',
			(await discord.locator('.ext-settings').count()) === 0
		);
		check(
			'無効のときは、拡張固有の設定が出ない',
			(await card.locator('.ext-settings').count()) === 0
		);

		console.log('[同意画面]');
		await card.locator('#ext-monolog').click();
		const dialog = page.getByRole('dialog', { name: /Monolog. 連携」を有効にする/ });
		await dialog.waitFor({ timeout: 5_000 });
		const dtext = await dialog.innerText();
		check(
			'マニフェストの送り先・送る項目・保存場所・解除時の扱いが出る',
			[
				'www.monolog.life',
				'api.monolog.life',
				'メモ(増減した文字数)',
				'キーチェーン',
				'連携を解除'
			].every((w) => dtext.includes(w))
		);
		check('本文は送らないと書いてある', dtext.includes('本文は送信しません'));
		await dialog.getByRole('button', { name: 'キャンセル' }).click();
		await sleep(300);
		check(
			'キャンセルすると有効にならない',
			(await card.locator('#ext-monolog').getAttribute('aria-checked')) === 'false' &&
				(await page.evaluate((k) => localStorage.getItem(k), ENABLED)) === null
		);

		await card.locator('#ext-monolog').click();
		await page.getByRole('button', { name: '同意して有効にする' }).click();
		await card.locator('.ext-settings').waitFor({ timeout: 10_000 });
		check('同意すると有効になり、拡張固有の設定が出る', true);
		const consent = await page.evaluate(
			(k) => JSON.parse(localStorage.getItem(k) ?? '{}'),
			CONSENT
		);
		check(
			'同意の記録(版・内容)が端末内に残る',
			typeof consent.monolog?.version === 'string' &&
				typeof consent.monolog?.fingerprint === 'string'
		);
		check(
			'「プライバシー」を開くと、マニフェストの内容が出る',
			await (async () => {
				await card.locator('details.privacy summary').click();
				return (await card.locator('details.privacy').innerText()).includes('api.monolog.life');
			})()
		);

		console.log('[既存ユーザー(同意の記録なし)]');
		await page.evaluate(
			([e, c]) => {
				localStorage.setItem(e, JSON.stringify(['monolog']));
				localStorage.removeItem(c);
			},
			[ENABLED, CONSENT]
		);
		await page.reload();
		await card.waitFor({ timeout: 30_000 });
		check(
			'勝手に無効にしない',
			(await card.locator('#ext-monolog').getAttribute('aria-checked')) === 'true'
		);
		await page.locator('[data-testid="ext-review-monolog"]').waitFor({ timeout: 10_000 });
		check('確認を促す表示が出る', true);
		await page.locator('[data-testid="ext-review-monolog"] button').click();
		await page.getByRole('button', { name: '確認した' }).click();
		await sleep(300);
		check(
			'確認すると促しが消える',
			(await page.locator('[data-testid="ext-review-monolog"]').count()) === 0
		);

		console.log('[扱う情報が変わったとき]');
		await page.evaluate((k) => {
			const c = JSON.parse(localStorage.getItem(k));
			c.monolog.fingerprint = 'old';
			localStorage.setItem(k, JSON.stringify(c));
		}, CONSENT);
		await page.reload();
		await card.waitFor({ timeout: 30_000 });
		await card.getByText('確認するまで停止しています').waitFor({ timeout: 10_000 });
		check('確認するまで停止して、再開の操作を出す', true);
		check('停止中は拡張固有の設定を出さない', (await card.locator('.ext-settings').count()) === 0);
		await card.getByRole('button', { name: '内容を確認して再開' }).click();
		await page.getByRole('button', { name: '確認した' }).click();
		await card.locator('.ext-settings').waitFor({ timeout: 10_000 });
		check('同意すると再開する', true);

		console.log('[執筆セッション設定]');
		await page.locator('#session-idle').click();
		await page.getByRole('option', { name: '15 分' }).click();
		await sleep(200);
		check(
			'無操作時間は本体の設定として保存される',
			(await page.evaluate(
				() => JSON.parse(localStorage.getItem('storift:extensions:session')).idleMinutes
			)) === 15
		);

		console.log('[執筆セッションの計測表示]');
		await page.evaluate(
			(k) =>
				localStorage.setItem(
					k,
					JSON.stringify({
						accessToken: 'mla_t',
						refreshToken: 'mlr_t',
						expiresAt: Date.now() + 3_600_000,
						scope: ''
					})
				),
			TOKENS
		);
		await page.goto(`${base}/project/${pid}/editor`);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await sleep(1500);
		await page.locator(EDITOR).click();
		await page.keyboard.type('夜の庭に、月が落ちていた。');
		await page
			.locator(
				'[data-testid="toolbar-ext-monolog"] .ext-dot, [data-testid="toolbar-ext-monolog"] [class*="dot"]'
			)
			.first()
			.waitFor({ timeout: 15_000 })
			.catch(() => {});
		await page.locator('[data-testid="toolbar-ext-monolog"]').click();
		const panel = page.locator('[role="dialog"][aria-label="Monolog."]');
		await panel.waitFor({ timeout: 5_000 });
		await panel.getByText('計測中').first().waitFor({ timeout: 15_000 });
		check('最初の編集で計測が始まり、パネルに「計測中」が出る', true);
		await page.keyboard.press('Escape');

		console.log('[スマホ: 操作シート]');
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		// 再読み込みで執筆セッションは終わっているので、もう一度書く
		await sleep(1500);
		await page.locator(EDITOR).click();
		await page.keyboard.type('風が吹いた。');
		// 自動保存のあと、計測が始まる(上部バーの「計測中」を待つ)
		await page
			.getByRole('status', { name: /Monolog. に執筆時間を記録/ })
			.waitFor({ timeout: 20_000 });
		await page.getByRole('button', { name: 'その他の操作' }).click();
		const sheet = page.getByRole('dialog', { name: '操作' });
		await sheet.waitFor({ timeout: 5_000 });
		const headings = await sheet.locator('h3').allInnerTexts();
		check(
			'項目が「執筆 / 出力と確認 / 拡張機能 / このシーン」にまとまる',
			['執筆', '出力と確認', '拡張機能', 'このシーン'].every((h) => headings.includes(h)),
			headings.join(',')
		);
		const small = await sheet.locator('button').evaluateAll((els) =>
			els
				.filter((el) => el.offsetParent !== null)
				.map((el) => ({
					label: el.innerText.trim() || el.ariaLabel,
					h: el.getBoundingClientRect().height,
					w: el.getBoundingClientRect().width
				}))
				.filter((b) => b.h < 44 || b.w < 44)
		);
		check('すべてのボタンのタップ領域が 44px 以上', small.length === 0, JSON.stringify(small));
		check(
			'拡張の項目に計測中の表示が出る',
			(await sheet.locator('[data-testid="action-ext-monolog"] .act-live').count()) === 1
		);
		await sheet.locator('[data-testid="action-ext-monolog"]').click();
		const extSheet = page.getByRole('dialog', { name: 'Monolog.' });
		await extSheet.waitFor({ timeout: 5_000 });
		check(
			'拡張のパネルがシートで開き、閉じる操作がある',
			(await extSheet.getByRole('button', { name: '閉じる' }).count()) >= 1
		);
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
		check('横にはみ出さない', !overflow);
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
