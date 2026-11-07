// デスクトップ版の AI パネル: 独自セレクト(Select.svelte)と送信ボタンの E2E。
// `bun run test:e2e:ai-select` から実行する(Firebase / エミュレータ不要)。
// ・セレクトの開閉・選択・キーボード・上向き表示・画面内に収まること
// ・送信ボタンが、隣のボタンと高さ・上下の余白で揃っていること(送信中の停止ボタンも同じ大きさ)
// E2E_SHOT_DIR を指定すると、目視確認用のスクリーンショットを書き出す。
import {
	chromium,
	startVite,
	installTauriMock,
	seedProject,
	applyTheme,
	CUSTOM_DARK_THEME,
	check,
	finish,
	shot,
	sleep,
	waitFor,
	EDITOR
} from './helpers.mjs';

const TRIGGER = '[data-ai-panel] .mode-select';
const LISTBOX = '[role="listbox"]';

const box = (page, selector) =>
	page
		.locator(selector)
		.first()
		.evaluate((el) => {
			const r = el.getBoundingClientRect();
			return {
				top: r.top,
				bottom: r.bottom,
				left: r.left,
				right: r.right,
				width: r.width,
				height: r.height
			};
		});

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
		const pid = await seedProject(page, { title: 'E2E AI セレクト' });
		await page.goto(`${vite.base}/project/${pid}/editor`);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await page.locator('.tool--ai').click();
		await page.locator('[data-ai-panel] .panel-header').waitFor({ timeout: 30_000 });
		await sleep(600);

		console.log('[パネルに <select> が残っていない]');
		check(
			'AI パネルに <select> がない',
			(await page.locator('[data-ai-panel] select').count()) === 0
		);

		console.log('[開閉と選択]');
		const trigger = page.locator(TRIGGER);
		await trigger.waitFor();
		check(
			'トリガーが combobox で aria-expanded=false',
			(await trigger.getAttribute('role')) === 'combobox' &&
				(await trigger.getAttribute('aria-expanded')) === 'false'
		);
		check('既定の値は「提案のみ」', (await trigger.innerText()).includes('提案のみ'));
		await trigger.click();
		await page.locator(LISTBOX).waitFor();
		await sleep(250);
		check('開くと aria-expanded=true', (await trigger.getAttribute('aria-expanded')) === 'true');
		const options = page.locator('[role="option"]');
		check('項目が 3 つある', (await options.count()) === 3);
		check(
			'選択中の項目に aria-selected=true と check アイコンがある',
			(await options.nth(0).getAttribute('aria-selected')) === 'true' &&
				(await options.nth(0).locator('.select-check svg').count()) === 1
		);
		check('補足説明が表示される', (await page.locator('.option-desc').count()) === 3);

		const t = await box(page, TRIGGER);
		const list = await box(page, LISTBOX);
		check(
			'AI パネルは画面下にあるので上向きに開く',
			list.bottom <= t.top,
			`list.bottom=${list.bottom} trigger.top=${t.top}`
		);
		check(
			'ポップアップが画面内に収まる',
			list.top >= 0 && list.left >= 0 && list.right <= 1400 && list.bottom <= 900,
			JSON.stringify(list)
		);
		check('data-side=up', (await page.locator(LISTBOX).getAttribute('data-side')) === 'up');
		check(
			'ポップアップは body 直下(親の overflow で切れない)',
			await page.locator(LISTBOX).evaluate((el) => el.parentElement === document.body)
		);
		await shot(page, 'ai-select-open-light');

		console.log('[キーボード]');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		const active = await trigger.getAttribute('aria-activedescendant');
		check('↓↓で 3 番目が active', active === (await options.nth(2).getAttribute('id')));
		await page.keyboard.press('Enter');
		await waitFor('閉じる', async () => (await page.locator(LISTBOX).count()) === 0, 3000);
		check(
			'Enter で確定すると値が変わり、閉じる',
			(await trigger.innerText()).includes('自動で反映')
		);
		const saved = await page.evaluate(async () => {
			const { aiStore } = await import('/src/lib/stores/ai.svelte.ts');
			return aiStore.settings.editMode;
		});
		check('ストアの editMode が更新される', saved === 'auto', saved);

		await page.keyboard.press('Enter');
		await page.locator(LISTBOX).waitFor();
		await page.keyboard.press('Home');
		await page.keyboard.press('Escape');
		await waitFor('Esc で閉じる', async () => (await page.locator(LISTBOX).count()) === 0, 3000);
		check(
			'Esc で閉じても値は変わらず、フォーカスはトリガーに戻る',
			(await trigger.innerText()).includes('自動で反映') &&
				(await trigger.evaluate((el) => el === document.activeElement))
		);

		await page.keyboard.press('Space');
		await page.locator(LISTBOX).waitFor();
		await trigger.dispatchEvent('keydown', { key: '差', bubbles: true });
		await page.keyboard.press('Enter');
		await waitFor(
			'文字入力でジャンプして確定',
			async () => (await trigger.innerText()).includes('差分を確認して反映'),
			3000
		);
		check('文字入力(先頭一致)で「差分を確認して反映」に移れる', true);

		console.log('[外側クリックで閉じる]');
		await trigger.click();
		await page.locator(LISTBOX).waitFor();
		await page.locator('[data-ai-panel] .panel-header .title').click();
		await waitFor(
			'外側クリックで閉じる',
			async () => (await page.locator(LISTBOX).count()) === 0,
			3000
		);
		check('外側をクリックすると閉じる', true);

		console.log('[ダーク系テーマ]');
		await applyTheme(page, 'dark');
		console.log(
			'  data-theme=' +
				(await page.evaluate(() => document.documentElement.getAttribute('data-theme')))
		);
		await trigger.click();
		await page.locator(LISTBOX).waitFor();
		await sleep(250);
		await shot(page, 'ai-select-open-dark');
		const bg = await page.locator(LISTBOX).evaluate((el) => getComputedStyle(el).backgroundColor);
		check('ポップアップの背景がテーマに追従する(暗い)', bg === 'rgb(27, 26, 24)', bg);
		await page.keyboard.press('Escape');

		console.log('[送信ボタンの揃い]');
		await applyTheme(page, 'light');
		const textarea = page.locator('[data-ai-panel] textarea').first();
		const send = page.locator('[data-ai-panel] button.send');
		await shot(page, 'ai-composer-disabled-light');
		check(
			'入力が空の間は無効で、背景なし',
			(await send.isDisabled()) &&
				(await send.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgba(0, 0, 0, 0)'
		);
		await textarea.fill('テスト');
		// 背景色の遷移(0.15s)が終わるのを待つ
		await sleep(600);
		check(
			'入力があると有効で、primary の背景',
			!(await send.isDisabled()) &&
				(await send.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(51, 80, 122)'
		);
		await shot(page, 'ai-composer-enabled-light');

		const metrics = () =>
			page.evaluate(() => {
				const rect = (el) => el.getBoundingClientRect();
				const foot = document.querySelector('[data-ai-panel] .input-foot');
				const box = document.querySelector('[data-ai-panel] .input-box');
				const sendBtn = foot.querySelector('button.send');
				const headerBtn = document.querySelector('[data-ai-panel] .panel-header button.icon');
				const mode = foot.querySelector('.mode-select');
				const tag = foot.querySelector('.provider-tag');
				const s = rect(sendBtn);
				const f = rect(foot);
				const b = rect(box);
				const cs = getComputedStyle(sendBtn);
				return {
					sendW: s.width,
					sendH: s.height,
					headerW: rect(headerBtn).width,
					headerH: rect(headerBtn).height,
					radius: cs.borderRadius,
					headerRadius: getComputedStyle(headerBtn).borderRadius,
					top: s.top - f.top,
					bottom: f.bottom - s.bottom,
					right: b.right - s.right,
					boxBottom: b.bottom - s.bottom,
					sendCenter: s.top + s.height / 2,
					modeCenter: rect(mode).top + rect(mode).height / 2,
					tagCenter: rect(tag).top + rect(tag).height / 2,
					stopClass: sendBtn.classList.contains('stop')
				};
			});
		const m = await metrics();
		console.log(`  send=${JSON.stringify(m)}`);
		check(
			'送信ボタンは他のアイコンボタンと同じ 34x34',
			m.sendW === 34 && m.sendH === 34 && m.headerW === 34 && m.headerH === 34
		);
		check(
			'角丸が他のアイコンボタンと同じ',
			m.radius === m.headerRadius,
			`${m.radius} vs ${m.headerRadius}`
		);
		check('行の上下の余白が等しい', Math.abs(m.top - m.bottom) < 0.5, `${m.top} vs ${m.bottom}`);
		check(
			'右の余白が下の余白と等しい(正方形の角で揃う)',
			Math.abs(m.right - m.boxBottom) < 0.5,
			`${m.right} vs ${m.boxBottom}`
		);
		check(
			'セレクト・モデル表示・送信ボタンの縦の中心が揃う',
			Math.abs(m.sendCenter - m.modeCenter) < 0.5 && Math.abs(m.sendCenter - m.tagCenter) < 0.5,
			`${m.sendCenter} / ${m.modeCenter} / ${m.tagCenter}`
		);

		console.log('[送信中は同じ位置に停止ボタン]');
		await page.evaluate(() => (window.__hangSend = true));
		await send.click();
		await waitFor(
			'停止ボタンに変わる',
			async () => (await page.locator('[data-ai-panel] button.send.stop').count()) === 1,
			5000
		);
		const stopped = await metrics();
		check(
			'停止ボタンも 34x34 で、送信ボタンと同じ位置',
			stopped.stopClass &&
				stopped.sendW === 34 &&
				stopped.sendH === 34 &&
				Math.abs(stopped.top - m.top) < 0.5 &&
				Math.abs(stopped.right - m.right) < 0.5,
			JSON.stringify(stopped)
		);
		await shot(page, 'ai-composer-stop-light');
		await applyTheme(page, 'dark');
		await shot(page, 'ai-composer-stop-dark');
		await applyTheme(page, CUSTOM_DARK_THEME);
		await shot(page, 'ai-composer-stop-custom-dark');

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
