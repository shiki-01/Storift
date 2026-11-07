// 進捗バー(ProgressBar.svelte)の見た目の E2E。
// `bun run test:e2e:progress` から実行する(Firebase / エミュレータ不要)。
// ・設定「このアプリについて」の更新のダウンロード(Tauri のアップデーター呼び出しをモック)
// ・ヘッダーの同期の進捗(「同期中 12/84」)
// E2E_SHOT_DIR を指定すると、ライト/ダーク/暗いカスタムテーマのスクリーンショットを書き出す。
import {
	chromium,
	devices,
	startVite,
	installTauriMock,
	seedProject,
	applyTheme,
	CUSTOM_DARK_THEME,
	check,
	finish,
	shotEl,
	sleep
} from './helpers.mjs';

const BAR = '.update [role="progressbar"]';

async function main() {
	const vite = await startVite();
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({
			viewport: { width: 1400, height: 900 },
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		await context.addInitScript(installTauriMock);
		const page = await context.newPage();
		page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));

		await page.goto(`${vite.base}/home`);
		await seedProject(page, { title: 'E2E 進捗' });

		console.log('[更新のダウンロード(サイズが分かる)]');
		await page.goto(`${vite.base}/settings#about`);
		await page.locator('.update').waitFor({ timeout: 30_000 });
		await page.getByRole('button', { name: '更新を確認' }).click();
		await page.locator('.update .primary').click();
		await page.locator(BAR).waitFor({ timeout: 10_000 });
		await sleep(500);
		const bar = page.locator(BAR);
		check(
			'role=progressbar と aria-valuemin/max/now',
			(await bar.getAttribute('aria-valuemin')) === '0' &&
				(await bar.getAttribute('aria-valuemax')) === '100' &&
				(await bar.getAttribute('aria-valuenow')) === '42'
		);
		const text = await page.locator('.update [data-testid="progress-bar-text"]').innerText();
		check('割合とサイズ(42% ・ 18.8 / 44.8 MB)を表示する', text === '42% ・ 18.8 / 44.8 MB', text);
		const look = await bar.evaluate((el) => {
			const track = getComputedStyle(el);
			const fill = getComputedStyle(el.firstElementChild);
			const root = getComputedStyle(document.documentElement);
			return {
				height: el.getBoundingClientRect().height,
				radius: track.borderRadius,
				track: track.backgroundColor,
				fill: fill.backgroundColor,
				fillWidth:
					el.firstElementChild.getBoundingClientRect().width / el.getBoundingClientRect().width,
				border: root.getPropertyValue('--color-border').trim(),
				primary: root.getPropertyValue('--color-primary').trim()
			};
		});
		console.log(`  look=${JSON.stringify(look)}`);
		check(
			'高さ 6px・全周の角丸',
			look.height === 6 && parseFloat(look.radius) >= 3,
			`${look.height} ${look.radius}`
		);
		check(
			'トラックは --color-border、塗りは --color-primary',
			look.track === 'rgb(223, 218, 208)' && look.fill === 'rgb(51, 80, 122)',
			`${look.track} / ${look.fill}`
		);
		check('塗りの幅が 42%', Math.abs(look.fillWidth - 0.42) < 0.01, String(look.fillWidth));
		check(
			'従来の <progress> 要素は使っていない',
			(await page.locator('.update progress').count()) === 0
		);
		await shotEl(page.locator('.update'), 'progress-update-light');
		await applyTheme(page, 'dark');
		await shotEl(page.locator('.update'), 'progress-update-dark');
		await applyTheme(page, CUSTOM_DARK_THEME);
		await shotEl(page.locator('.update'), 'progress-update-custom-dark');
		await applyTheme(page, 'light');

		console.log('[更新のダウンロード(サイズが不明: 不確定表示)]');
		// 直前の更新が downloading のままなので、ページを読み込み直して状態を作り直す
		await page.reload();
		await page.evaluate(() => (window.__updateTotal = 0));
		await page.locator('.update').waitFor({ timeout: 30_000 });
		await page.getByRole('button', { name: '更新を確認' }).click();
		await page.locator('.update .primary').click();
		await page.locator(BAR).waitFor({ timeout: 10_000 });
		check(
			'aria-valuenow がない(不確定)',
			(await page.locator(BAR).getAttribute('aria-valuenow')) === null
		);
		check(
			'不確定のクラスが付く',
			await page.locator(BAR).evaluate((el) => el.classList.contains('indeterminate'))
		);
		await shotEl(page.locator('.update'), 'progress-update-indeterminate');
		const reduced = await context.newPage();
		await reduced.emulateMedia({ reducedMotion: 'reduce' });
		await reduced.addInitScript(() => (window.__updateTotal = 0));
		await reduced.goto(`${vite.base}/settings#about`);
		await reduced.locator('.update').waitFor({ timeout: 30_000 });
		await reduced.getByRole('button', { name: '更新を確認' }).click();
		await reduced.locator('.update .primary').click();
		await reduced.locator(BAR).waitFor({ timeout: 10_000 });
		const anim = await reduced
			.locator(`${BAR} .fill`)
			.evaluate((el) => getComputedStyle(el).animationName);
		check('prefers-reduced-motion では不確定のアニメーションを止める', anim === 'none', anim);
		await reduced.close();

		// 同期の状態表示(SyncStatus)は、レールの無いスマホ幅のヘッダーに出る
		console.log('[同期の進捗(スマホのヘッダー)]');
		const mobile = await browser.newContext({
			...devices['iPhone 13'],
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		const mp = await mobile.newPage();
		mp.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
		await mp.goto(`${vite.base}/home`);
		await mp.locator('.sync-root').waitFor({ timeout: 30_000 });
		await mp.evaluate(async () => {
			const { syncStore } = await import('/src/lib/stores/sync.svelte.ts');
			syncStore.isConfigured = true;
			syncStore.status = 'syncing';
			syncStore.progress = { phase: 'upload', done: 12, total: 84 };
		});
		await mp.locator('.sync-root [role="progressbar"]').waitFor({ timeout: 5000 });
		const sync = await mp.evaluate(() => {
			const root = document.querySelector('.sync-root');
			const bar = root.querySelector('[role="progressbar"]');
			const rect = root.getBoundingClientRect();
			return {
				text: root.innerText.replace(/\s+/g, ' ').trim(),
				now: bar.getAttribute('aria-valuenow'),
				barWidth: bar.getBoundingClientRect().width,
				inView: rect.left >= 0 && rect.right <= window.innerWidth,
				hasSymbol: /[\u2190-\u27bf]/.test(root.innerText)
			};
		});
		console.log(`  sync=${JSON.stringify(sync)}`);
		check(
			'「同期中 12/84」と 14% のバー',
			sync.text.includes('同期中 12/84') && sync.now === '14',
			JSON.stringify(sync)
		);
		check('バーを含めてヘッダーの幅に収まる', sync.inView && sync.barWidth > 0);
		check('同期の表示に記号文字(⟳ など)がない', !sync.hasSymbol);
		await shotEl(mp.locator('.app-header'), 'progress-sync-light');
		await applyTheme(mp, 'dark');
		await shotEl(mp.locator('.app-header'), 'progress-sync-dark');
		await mobile.close();

		await context.close();
	} finally {
		await browser.close();
		vite.stop();
	}
	finish();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
