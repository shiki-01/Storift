// テキスト選択(user-select)の方針の E2E。
// `bun run test:e2e:user-select` から実行する(Firebase / エミュレータ不要)。
// UI の操作部品(ボタン・ナビ・見出し・ラベルなど)は選択できず、本文やコピーしたくなる情報は選択できること。
// 対応表は docs/UI_GUIDELINES.md。デスクトップ版(Tauri モック)で AI パネルまで確かめる。
import {
	chromium,
	startVite,
	installTauriMock,
	seedProject,
	check,
	finish,
	sleep,
	EDITOR
} from './helpers.mjs';

/** 要素の user-select(標準と -webkit- 付き) */
const selectOf = (page, selector) =>
	page
		.locator(selector)
		.first()
		.evaluate((el) => {
			const cs = getComputedStyle(el);
			return { std: cs.userSelect, webkit: cs.webkitUserSelect };
		});

async function expectSelect(page, label, selector, expected) {
	const got = await selectOf(page, selector).catch((e) => ({
		std: `missing: ${e.message}`.slice(0, 80)
	}));
	check(
		`${label} は ${expected === 'none' ? '選択できない' : '選択できる'}`,
		got.std === expected && got.webkit === expected,
		`${selector} → ${got.std} / ${got.webkit}`
	);
}

const none = (page, label, selector) => expectSelect(page, label, selector, 'none');
const text = (page, label, selector) => expectSelect(page, label, selector, 'text');

async function main() {
	const vite = await startVite();
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({
			viewport: { width: 1400, height: 900 },
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await context.addInitScript(installTauriMock);
		const page = await context.newPage();
		page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));

		await page.goto(`${vite.base}/home`);
		const pid = await seedProject(page, { title: 'E2E 選択', content: '本文です。' });
		await page.evaluate(async (pid) => {
			const { memosDB, plotsDB, charactersDB, worldbuildingDB, scenesDB } = await import(
				'/src/lib/db/index.ts'
			);
			const [scene] = await scenesDB.getByProjectId(pid);
			await memosDB.create({
				projectId: pid,
				sceneId: scene.id,
				text: 'メモの本文テキスト',
				tags: ['タグ']
			});
			const plot = await plotsDB.create({ projectId: pid, title: 'プロット題', type: 'scene' });
			await plotsDB.update(plot.id, { content: 'プロットの本文テキスト' });
			const ch = await charactersDB.create({ projectId: pid, name: '人物名', role: '主人公' });
			await charactersDB.update(ch.id, { personality: '人物の性格テキスト' });
			await worldbuildingDB.create({
				projectId: pid,
				category: 'location',
				title: '設定題',
				content: '設定資料の本文テキスト'
			});
		}, pid);

		console.log('[ホーム]');
		await page.goto(`${vite.base}/home`);
		await page.locator('.home-head h1').waitFor({ timeout: 30_000 });
		await text(page, 'body の既定を除く、入力欄', '.home-search input, input');
		await none(page, '見出し(作品)', '.home-head h1');
		await none(page, 'ナビ(AppRail は無い画面なので body)', 'body');
		await none(page, 'ボタン', 'button');

		console.log('[エディタ]');
		await page.goto(`${vite.base}/project/${pid}/editor`);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await page.locator('.editor-toolbar').waitFor();
		await text(page, 'エディタ本文', EDITOR);
		await none(page, 'ナビ(AppRail)', 'nav.rail');
		await none(page, 'ナビのリンク', 'nav.rail .rail-item');
		await none(page, 'ツールバー', '.editor-toolbar');
		await none(page, 'ツールバーのボタン', '.editor-toolbar .tool');
		await none(page, 'シーンのタイトル(見出し)', '.editor-title');
		await none(page, '保存状態の表示', '.save-state');
		await none(page, 'シーン一覧', '.editor-sidebar-scroll');
		await none(page, 'アイコン(svg)', '.editor-toolbar svg');

		console.log('[エディタ: Ctrl+A・コピー&ペースト・IME 風の入力]');
		const editor = page.locator(EDITOR);
		await editor.click();
		await page.keyboard.press('Control+A');
		const sel = await page.evaluate(() => {
			const s = getSelection();
			const root = document.querySelector('[role="textbox"]');
			return {
				text: s.toString(),
				inside: !!s.anchorNode && root.contains(s.anchorNode) && root.contains(s.focusNode)
			};
		});
		check(
			'Ctrl+A はエディタの本文だけを選ぶ',
			sel.text.trim() === '本文です。' && sel.inside,
			JSON.stringify(sel)
		);
		await page.keyboard.press('Control+C');
		await page.keyboard.press('End');
		await page.keyboard.press('Control+V');
		await sleep(200);
		check(
			'コピー&ペーストが動く',
			(await editor.innerText()).replace(/\s/g, '') === '本文です。本文です。',
			await editor.innerText()
		);
		// IME の確定を模した挿入(compositionstart/end を伴う入力)
		await page.keyboard.press('Control+End');
		await page.evaluate(() => {
			const el = document.querySelector('[role="textbox"]');
			el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		});
		await page.keyboard.insertText('かな');
		await page.evaluate(() => {
			const el = document.querySelector('[role="textbox"]');
			el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'かな' }));
		});
		await sleep(200);
		check('日本語の入力が反映される', (await editor.innerText()).includes('かな'));
		// 切り取り・貼り付けで本文を戻す
		await page.keyboard.press('Control+A');
		await page.keyboard.press('Control+V');
		await sleep(150);

		console.log('[メモ]');
		await page.locator('.editor-toolbar [aria-label^="メモ"]').click();
		await page.locator('.memo .item').first().waitFor({ timeout: 10_000 });
		await text(page, 'メモの本文', '.memo .item .text');
		await none(page, 'メモのタイトル(見出し)', '.memo .head .title');
		await none(page, 'メモの操作リンク', '.memo .item .link');
		await page.locator('.editor-toolbar [aria-label^="メモ"]').click();

		console.log('[AI パネル]');
		await page.locator('.tool--ai').click();
		await page.locator('[data-ai-panel] textarea').first().waitFor({ timeout: 30_000 });
		await sleep(500);
		await text(page, '入力欄(textarea)', '[data-ai-panel] textarea');
		await none(page, 'ヘッダーのタイトル', '[data-ai-panel] .panel-header .title');
		await none(page, 'クイックアクションのボタン', '[data-ai-panel] .chip');
		await none(page, '本文の編集のセレクト', '[data-ai-panel] .mode-select');
		await none(page, '送信ボタン', '[data-ai-panel] button.send');
		// 送信の失敗(エラー文)
		await page.evaluate(() => (window.__failSend = true));
		await page.locator('[data-ai-panel] textarea').first().fill('もう一度');
		await page.locator('[data-ai-panel] button.send').click();
		await page.locator('[data-ai-panel] .msg.error').first().waitFor({ timeout: 10_000 });
		await text(page, 'AI のエラー文', '[data-ai-panel] .msg.error');
		// 回答中(質問と回答)
		await page.evaluate(() => {
			window.__failSend = false;
			window.__hangSend = true;
		});
		await page.locator('[data-ai-panel] textarea').first().fill('質問のテキスト');
		await page.locator('[data-ai-panel] button.send').click();
		await page.locator('[data-ai-panel] .msg.assistant').waitFor({ timeout: 10_000 });
		await text(page, 'ユーザーの質問', '[data-ai-panel] .msg.user');
		await text(page, 'AI の回答', '[data-ai-panel] .msg.assistant');
		await none(page, '回答の操作ボタン(コピーなど)', '[data-ai-panel] .msg-actions button');
		await page.locator('[data-ai-panel] .panel-header [aria-label="閉じる"]').click();

		console.log('[トースト]');
		await page.evaluate(async () => {
			const { toast } = await import('/src/lib/stores/toast.svelte.ts');
			toast.error('エラーのトースト文');
		});
		await page.locator('.toast .message', { hasText: 'エラーのトースト文' }).waitFor();
		await text(page, 'トーストのメッセージ', '.toast .message:has-text("エラーのトースト文")');
		await none(page, 'トーストの閉じるボタン', '.toast .close');

		console.log('[通読(プレビュー)]');
		await page.goto(`${vite.base}/project/${pid}/preview`);
		await page.locator('[data-testid="reader"] .body').first().waitFor({ timeout: 30_000 });
		await text(page, '通読の本文', '[data-testid="reader"] .body');
		await none(page, '通読の章タイトル(見出し)', '[data-testid="reader"] .chapter-title');
		await none(page, 'ナビ(AppRail)', 'nav.rail');

		console.log('[プロット・人物・設定資料]');
		await page.goto(`${vite.base}/project/${pid}/plot`);
		await page.getByText('プロットの本文テキスト').first().waitFor({ timeout: 30_000 });
		await text(page, 'プロットの本文', 'p:has-text("プロットの本文テキスト")');
		await none(page, 'プロットのページのボタン', '.plot-page button');
		await page.goto(`${vite.base}/project/${pid}/characters`);
		await page.getByText('人物の性格テキスト').first().waitFor({ timeout: 30_000 });
		await text(page, '人物の説明', 'p:has-text("人物の性格テキスト")');
		await page.goto(`${vite.base}/project/${pid}/worldbuilding`);
		await page.getByText('設定資料の本文テキスト').first().waitFor({ timeout: 30_000 });
		await text(page, '設定資料の本文', 'p:has-text("設定資料の本文テキスト")');

		console.log('[進捗]');
		await page.goto(`${vite.base}/project/${pid}/progress`);
		await page.locator('main h1').waitFor({ timeout: 30_000 });
		await none(page, '進捗の見出し', 'main h1');
		await none(page, '進捗のカード', 'main h3, main h2');

		console.log('[設定]');
		await page.goto(`${vite.base}/settings#about`);
		await page.locator('.settings-nav').waitFor({ timeout: 30_000 });
		await none(page, '設定のタイトル', '.settings-title');
		await none(page, '設定のナビ', '.settings-nav');
		await none(page, 'セクションの見出し', '.section-title');
		await none(page, '設定カードの見出し', '.settings-card-title');
		await text(page, 'バージョン情報', '.update p.selectable');
		await page.goto(`${vite.base}/settings#appearance`);
		await page.locator('.settings-nav').waitFor();
		await none(page, '設定の項目名(ラベル)', '.settings-row .label');

		console.log('[セットアップ]');
		await page.goto(`${vite.base}/setup`);
		await page.locator('h1, h2').first().waitFor({ timeout: 30_000 });
		await none(page, 'セットアップの見出し', 'h1, h2');
		await text(page, '入力欄', 'input');

		console.log('[エラーページ]');
		await page.goto(`${vite.base}/no-such-page-e2e`);
		await page.locator('h1').waitFor({ timeout: 30_000 });
		await none(page, 'エラーページの見出し', 'h1');
		await text(page, 'エラーメッセージ', '.selectable');
		await none(page, 'エラーページのボタン', 'button');

		console.log('[タグ・クラスによる判定(合成した要素)]');
		const synthetic = await page.evaluate(() => {
			const make = (html) => {
				const wrap = document.createElement('div');
				wrap.innerHTML = html;
				document.body.appendChild(wrap);
				return wrap;
			};
			const wrap = make(
				`<pre id="s-pre">pre</pre><code id="s-code">code</code>
				 <input id="s-input" /><textarea id="s-ta"></textarea>
				 <div id="s-ce" contenteditable="true"><span id="s-ce-child">x</span></div>
				 <div id="s-cef" contenteditable="false">x</div>
				 <div class="selectable" id="s-sel"><span id="s-sel-child">x</span><button id="s-sel-btn">b</button></div>
				 <div id="s-plain"><span id="s-plain-child">x</span></div>
				 <div role="alert" id="s-alert">err<button id="s-alert-btn">b</button></div>`
			);
			const r = {};
			for (const el of wrap.querySelectorAll('[id]')) {
				const cs = getComputedStyle(el);
				r[el.id] = `${cs.userSelect}/${cs.webkitUserSelect}`;
			}
			wrap.remove();
			return r;
		});
		const want = {
			's-pre': 'text',
			's-code': 'text',
			's-input': 'text',
			's-ta': 'text',
			's-ce': 'text',
			's-ce-child': 'text',
			's-cef': 'none',
			's-sel': 'text',
			's-sel-child': 'text',
			's-sel-btn': 'none',
			's-plain': 'none',
			's-plain-child': 'none',
			's-alert': 'text',
			's-alert-btn': 'none'
		};
		for (const [id, value] of Object.entries(want)) {
			check(`#${id} は ${value}`, synthetic[id] === `${value}/${value}`, synthetic[id]);
		}

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
