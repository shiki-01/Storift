// 執筆画面の入力まわりの E2E: 選択ポップアップ(AI に聞く・ルビ・メモ)、改行時の字下げ、
// ショートカット、画面を移動して戻ったときのスクロール位置、外枠のずれの補正。
// `bun run test:e2e:editor-input` から実行する(Firebase / エミュレータ不要)。
import {
	chromium,
	startVite,
	installTauriMock,
	seedProject,
	check,
	finish,
	sleep,
	waitFor,
	EDITOR
} from './helpers.mjs';

const POPUP = '[role="toolbar"][aria-label="選択した文章の操作"]';

/** エディタの本文の先頭から n 文字を選択する */
async function selectText(page, start, end) {
	await page.locator(EDITOR).evaluate(
		(el, { start, end }) => {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			const node = walker.nextNode();
			const range = document.createRange();
			range.setStart(node, start);
			range.setEnd(node, end);
			el.focus();
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		},
		{ start, end }
	);
}

const content = (page) => page.locator(EDITOR).evaluate((el) => el.innerText);

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
		const pid = await seedProject(page, { title: 'E2E 入力', content: '紅蓮の炎が燃える。' });
		await page.goto(`${vite.base}/project/${pid}/editor`);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await sleep(800);

		console.log('[選択ポップアップ]');
		await selectText(page, 0, 2);
		await page.locator(POPUP).waitFor({ timeout: 5000 });
		const labels = await page.locator(`${POPUP} button`).allInnerTexts();
		check(
			'ボタンは AI に聞く・ルビ・メモ',
			labels.join(',') === 'AI に聞く,ルビ,メモ',
			labels.join(',')
		);
		await page.locator(`${POPUP} button`, { hasText: 'ルビ' }).click();
		await sleep(200);
		check(
			'ルビ(Storift)で ｜親文字《》 が入る',
			(await content(page)).startsWith('｜紅蓮《》'),
			await content(page)
		);
		await page.keyboard.type('ぐれん');
		check(
			'カーソルは読みの位置',
			(await content(page)).startsWith('｜紅蓮《ぐれん》'),
			await content(page)
		);

		console.log('[ショートカット: 傍点]');
		await selectText(page, 0, 1);
		await page.keyboard.press('Control+Alt+B');
		await sleep(200);
		check('Ctrl+Alt+B で傍点', (await content(page)).startsWith('《《｜》》'), await content(page));

		console.log('[ショートカット: 一覧の開閉]');
		const before = await page.locator('.editor-layout').getAttribute('data-sidebar-open');
		await page.keyboard.press('Control+Alt+L');
		await sleep(200);
		const after = await page.locator('.editor-layout').getAttribute('data-sidebar-open');
		check('Ctrl+Alt+L で一覧が開閉する', before !== after, `${before} -> ${after}`);

		console.log('[改行時の字下げ]');
		await page.evaluate(async () => {
			const { editorStore } = await import('/src/lib/stores/editor.svelte.ts');
			editorStore.autoIndent = true;
		});
		await page.locator(EDITOR).evaluate((el) => {
			el.focus();
			const sel = window.getSelection();
			sel.selectAllChildren(el);
			sel.collapseToEnd();
		});
		await page.keyboard.press('Enter');
		await page.keyboard.type('次の行');
		await sleep(200);
		const lines = (await content(page)).split('\n').filter((l) => l !== '');
		check('改行した行の先頭に全角スペース', lines.at(-1) === '　次の行', JSON.stringify(lines));
		await page.keyboard.press('Enter');
		await page.keyboard.type('「会話');
		await sleep(200);
		await page.evaluate(async () => {
			const { editorStore } = await import('/src/lib/stores/editor.svelte.ts');
			editorStore.autoIndent = false;
		});
		await page.keyboard.press('Enter');
		await page.keyboard.type('字下げなし');
		await sleep(200);
		const lines2 = (await content(page)).split('\n').filter((l) => l !== '');
		check('オフのときは字下げしない', lines2.at(-1) === '字下げなし', JSON.stringify(lines2));

		console.log('[外枠のずれの補正]');
		const frameTop = await page.evaluate(async () => {
			const frame = document.querySelector('.app-frame');
			frame.scrollTop = 200;
			await new Promise((r) => setTimeout(r, 100));
			return frame.scrollTop;
		});
		check('スクロールしない外枠は先頭に戻る', frameTop === 0, String(frameTop));

		console.log('[スクロール位置の記憶]');
		const longText = Array.from({ length: 300 }, (_, i) => `${i + 1}行目の本文です。`).join('\n');
		// 編集中の本文の保存(画面を離れるとき)が書き込みを上書きしないよう、先に別の画面へ移る
		await page.goto(`${vite.base}/home`);
		await sleep(500);
		await page.evaluate(
			async ({ pid, longText }) => {
				const { scenesDB } = await import('/src/lib/db/index.ts');
				const scenes = await scenesDB.getByProjectId(pid);
				await scenesDB.update(scenes[0].id, { content: longText });
			},
			{ pid, longText }
		);
		await page.goto(`${vite.base}/project/${pid}/editor`);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await waitFor('長い本文', async () => (await content(page)).includes('300行目'));
		const panel = page.locator('.editor-panel--editor');
		await panel.evaluate((el) => (el.scrollTop = 1500));
		await sleep(300);
		// 別の画面へ(クライアント側の遷移)
		await page.evaluate((pid) => {
			const a = document.createElement('a');
			a.href = `/project/${pid}/plot`;
			document.body.appendChild(a);
			a.click();
		}, pid);
		await page.waitForURL(/\/plot$/);
		await sleep(600);
		await page.goBack();
		await page.waitForURL(/\/editor$/);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await sleep(1200);
		const restored = await panel.evaluate((el) => el.scrollTop);
		check('戻るとスクロール位置が戻る', Math.abs(restored - 1500) <= 2, String(restored));
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
