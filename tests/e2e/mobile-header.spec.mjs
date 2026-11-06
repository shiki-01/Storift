// スマホのエディタ画面: 上部バーの出入りが本文のレイアウトに影響しないことの E2E。
// `bun run test:e2e:mobile` から実行する(Firebase / エミュレータ不要)。
// vite dev(空きポート)を起動し、プリインストールの Chromium(Playwright)でモバイルエミュレーションする。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDITOR = '[role="textbox"][aria-label="エディタ"]';
const PANEL = '.editor-panel--editor';
const BAR = '.m-bar-wrap';

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

/** 本文コンテナの位置・高さ・スクロール量 */
const panelMetrics = (page) =>
	page.locator(PANEL).evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { top: r.top, height: r.height, scrollTop: el.scrollTop };
	});

const barState = (page) =>
	page.locator(BAR).evaluate((el) => {
		const cs = getComputedStyle(el);
		const r = el.getBoundingClientRect();
		return {
			transform: cs.transform,
			opacity: Number(cs.opacity),
			position: cs.position,
			pointerEvents: cs.pointerEvents,
			transitionProperty: cs.transitionProperty,
			transitionDuration: cs.transitionDuration,
			inert: el.inert,
			ariaHidden: el.getAttribute('aria-hidden'),
			bottom: r.bottom,
			height: r.height
		};
	});

/** ユーザー操作(wheel)に続けて本文を指定位置までスクロールする */
async function userScrollTo(page, top) {
	await page.locator(PANEL).evaluate((el, y) => {
		el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
		el.scrollTop = y;
	}, top);
}

/** 1 回のスクロールを段階的に行う(細かいイベントの積算で判定されることも確かめる) */
async function userScrollBy(page, total, steps = 6) {
	for (let i = 0; i < steps; i++) {
		await page.locator(PANEL).evaluate((el, d) => {
			el.dispatchEvent(new WheelEvent('wheel', { deltaY: d, bubbles: true }));
			el.scrollTop += d;
		}, total / steps);
		await sleep(30);
	}
}

async function openEditor(browser, base, reducedMotion) {
	const context = await browser.newContext({
		...devices['iPhone 13'],
		serviceWorkers: 'block',
		locale: 'ja-JP',
		reducedMotion: reducedMotion ? 'reduce' : 'no-preference'
	});
	const page = await context.newPage();
	page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
	await page.goto(`${base}/home`);
	const pid = await page.evaluate(async () => {
		const { settingsDB, projectsDB, chaptersDB, scenesDB } = await import('/src/lib/db/index.ts');
		await settingsDB.update({ setupCompleted: true, tutorialDismissed: true });
		const project = await projectsDB.create({ title: 'E2E モバイルヘッダー' });
		const chapter = await chaptersDB.create({ projectId: project.id, title: '章', synopsis: '' });
		const content = Array.from({ length: 200 }, (_, i) => `これは ${i + 1} 行目の本文です。`).join(
			'\n'
		);
		await scenesDB.create({ chapterId: chapter.id, projectId: project.id, title: '場面', content });
		return project.id;
	});
	await page.goto(`${base}/project/${pid}/editor`);
	await page.locator(EDITOR).waitFor({ timeout: 30_000 });
	await page.locator(BAR).waitFor({ timeout: 30_000 });
	await sleep(800);
	return { context, page };
}

async function main() {
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;
	const vite = await startVite(port);
	const browser = await chromium.launch();
	try {
		// ---------- 通常モーション ----------
		console.log('[通常モーション]');
		const { context, page } = await openEditor(browser, base, false);

		const initial = await panelMetrics(page);
		const shown0 = await barState(page);
		check('最初はバーが見えている', shown0.opacity === 1 && !shown0.inert);
		check('バーは本文に重なる(absolute)', shown0.position === 'absolute');

		// 本文コンテナの矩形を rAF ごとに記録する(遷移中の動きも検出する)
		await page.locator(PANEL).evaluate((el) => {
			window.__rects = [];
			const tick = () => {
				const r = el.getBoundingClientRect();
				window.__rects.push(`${r.top}/${r.height}`);
				window.__raf = requestAnimationFrame(tick);
			};
			tick();
		});

		// 下へ(隠れる)
		await userScrollTo(page, 300);
		await sleep(50);
		const midHide = await barState(page);
		await sleep(500);
		const hiddenBar = await barState(page);
		const afterHide = await panelMetrics(page);
		check('下スクロールでバーが隠れる', hiddenBar.opacity === 0 && hiddenBar.inert);
		check('隠れたバーは aria-hidden', hiddenBar.ariaHidden === 'true');
		check('隠れたバーは pointer-events:none', hiddenBar.pointerEvents === 'none');
		check(
			'隠れたバーは transform で上へ移動(高さは不変)',
			hiddenBar.transform !== 'none' && hiddenBar.bottom <= 0 && hiddenBar.height === shown0.height,
			`transform=${hiddenBar.transform}`
		);
		check(
			'遷移の対象は transform/opacity のみ',
			/^transform, opacity$/.test(shown0.transitionProperty),
			shown0.transitionProperty
		);
		check(
			'遷移時間が 150〜220ms',
			shown0.transitionDuration.split(',').every((d) => {
				const ms = parseFloat(d) * 1000;
				return ms >= 150 && ms <= 220;
			}),
			shown0.transitionDuration
		);
		void midHide;
		check(
			'隠れた後も本文の top/height 不変',
			afterHide.top === initial.top && afterHide.height === initial.height,
			JSON.stringify([initial, afterHide])
		);
		check(
			'隠れた後も scrollTop は指定値のまま',
			afterHide.scrollTop === 300,
			String(afterHide.scrollTop)
		);

		// 小さな揺れでは出ない(上へ 8px)
		await userScrollBy(page, -8, 2);
		await sleep(300);
		check('上へ 8px 程度の揺れでは出ない', (await barState(page)).opacity === 0);

		// 上へ(出る)
		await userScrollBy(page, -40, 8);
		await sleep(500);
		const shownBar = await barState(page);
		const afterShow = await panelMetrics(page);
		check(
			'上スクロールでバーが出る',
			shownBar.opacity === 1 && !shownBar.inert && shownBar.ariaHidden === null
		);
		check(
			'出た後も本文の top/height 不変',
			afterShow.top === initial.top && afterShow.height === initial.height,
			JSON.stringify(afterShow)
		);
		check(
			'出た後の scrollTop は操作量どおり(252)',
			Math.abs(afterShow.scrollTop - 252) <= 1,
			String(afterShow.scrollTop)
		);

		// 最上部では常に表示
		await userScrollTo(page, 300);
		await sleep(400);
		await userScrollTo(page, 0);
		await sleep(400);
		check('最上部ではバーが出る', (await barState(page)).opacity === 1);

		const rects = await page.evaluate(() => {
			cancelAnimationFrame(window.__raf);
			return [...new Set(window.__rects)];
		});
		check('全フレームを通じて本文コンテナの矩形が一定', rects.length === 1, rects.join(' | '));
		await context.close();

		// ---------- reduced motion ----------
		console.log('[prefers-reduced-motion: reduce]');
		const rm = await openEditor(browser, base, true);
		const rmBar = await barState(rm.page);
		check(
			'遷移時間が 0',
			rmBar.transitionDuration.split(',').every((d) => parseFloat(d) === 0),
			rmBar.transitionDuration
		);
		await userScrollTo(rm.page, 300);
		await sleep(50);
		const rmHidden = await barState(rm.page);
		check('即時に隠れる(待たずに opacity 0)', rmHidden.opacity === 0);
		await rm.context.close();
		// ---------- キャレットが上部バーの裏に入らない ----------
		console.log('[キャレットの補正(バーの高さを考慮)]');
		const cr = await openEditor(browser, base, false);
		const caretMetrics = (page) =>
			page.evaluate(
				async ([panelSel, barSel]) => {
					const panel = document.querySelector(panelSel).getBoundingClientRect();
					const bar = document.querySelector(barSel).getBoundingClientRect();
					const range = getSelection().getRangeAt(0).cloneRange();
					range.collapse(true);
					const rects = [...range.getClientRects()].filter((r) => r.height > 0);
					const r = rects[0] ?? range.getBoundingClientRect();
					return {
						top: r.top,
						bottom: r.bottom,
						center: (r.top + r.bottom) / 2,
						barBottom: bar.bottom,
						panelTop: panel.top,
						panelBottom: panel.bottom
					};
				},
				[PANEL, BAR]
			);
		/** n 行目(0 始まり)の行末にキャレットを置き、その行がバーの裏に来るようにスクロールする(ユーザー操作ではない) */
		const placeCaretBehindBar = async (page, line, offsetBelowTop) => {
			await page.locator(EDITOR).focus();
			await page.evaluate(
				async ([panelSel, editorSel, n, offset]) => {
					const { selectTextRange } = await import('/src/lib/utils/editorInput.ts');
					const editor = document.querySelector(editorSel);
					const lines = editor.innerText.split('\n');
					const start = lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
					const end = start + lines[n].length;
					selectTextRange(editor, end, end);
					const range = getSelection().getRangeAt(0).cloneRange();
					range.collapse(true);
					const panel = document.querySelector(panelSel);
					const rect = [...range.getClientRects()][0] ?? range.getBoundingClientRect();
					panel.scrollTop += rect.top - (panel.getBoundingClientRect().top + offset);
				},
				[PANEL, EDITOR, line, offsetBelowTop]
			);
			await sleep(100);
		};

		const bar0 = await barState(cr.page);
		check('キャレット補正の前提: バーが表示されている', bar0.opacity === 1 && bar0.bottom > 40);
		// 行の先頭がバーの中ほど(上から 20px)に来る位置へ。バーの高さより上なので、補正が無いとバーの裏のまま
		await placeCaretBehindBar(cr.page, 60, 20);
		const before = await caretMetrics(cr.page);
		check(
			'準備: キャレットがバーの裏にある',
			before.top < before.barBottom,
			`caret.top=${before.top} bar.bottom=${before.barBottom}`
		);
		await cr.page.keyboard.type('あ');
		await sleep(300);
		const fixed = await caretMetrics(cr.page);
		check(
			'入力するとキャレットがバーの下端より下に補正される',
			fixed.top >= fixed.barBottom - 0.5,
			`caret.top=${fixed.top} bar.bottom=${fixed.barBottom}`
		);
		check(
			'補正後も可視領域の下端を越えない',
			fixed.bottom <= fixed.panelBottom,
			`caret.bottom=${fixed.bottom} panel.bottom=${fixed.panelBottom}`
		);

		// 下端側は従来どおり(バーの有無に関わらず下端の手前に収まる)
		await placeCaretBehindBar(cr.page, 100, initial.height - 4);
		await cr.page.keyboard.type('い');
		await sleep(300);
		const lower = await caretMetrics(cr.page);
		check(
			'下端にはみ出たキャレットも可視領域に収まる',
			lower.bottom <= lower.panelBottom && lower.top >= lower.barBottom - 0.5,
			JSON.stringify(lower)
		);

		// タイプライタースクロール: 可視領域(バーの下端〜下端)の 40% 付近に置く
		await cr.page.evaluate(async () => {
			const { editorStore } = await import('/src/lib/stores/editor.svelte.ts');
			editorStore.typewriter = true;
		});
		await sleep(200);
		await placeCaretBehindBar(cr.page, 60, 20);
		await cr.page.keyboard.type('う');
		await sleep(300);
		const tw = await caretMetrics(cr.page);
		const target = tw.barBottom + (tw.panelBottom - tw.barBottom) * 0.4;
		check(
			'タイプライタースクロールでもバーの下端より下に置かれる',
			tw.top >= tw.barBottom - 0.5 && Math.abs(tw.center - target) <= 12,
			`caret.center=${tw.center} target=${target} bar.bottom=${tw.barBottom}`
		);
		await cr.context.close();
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
