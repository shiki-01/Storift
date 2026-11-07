// スクロールバーの有無でページの内容の位置がずれないことの E2E。
// `bun run test:e2e:scrollbar` から実行する(Firebase / エミュレータ不要)。
// このアプリは html/body ではなく、各ページの縦スクロールのコンテナがスクロールする。それらに
// `scrollbar-gutter: stable`(.scroll-stable)を付けているので、スクロールが入っても内容の left が変わらない。
// Chromium は(ヘッドレスの --hide-scrollbars を外せば)クラシックスクロールバーを出すので、幅の差で確かめられる。
// モバイルのエミュレーション(オーバーレイのスクロールバー)では余白が増えないことも確かめる。
import {
	chromium,
	devices,
	startVite,
	seedProject,
	check,
	finish,
	shotEl,
	sleep,
	EDITOR
} from './helpers.mjs';

/**
 * スクロールが無い状態と、縦に長いスペーサーを足してスクロールが入った状態で、target の left を比べる。
 * .scroll-stable を外した状態でも測り、このテストが「ずれ」を検出できること(= 外すとずれること)を確かめる。
 */
function measure(page, scrollerSel, targetSel) {
	return page.evaluate(
		({ s, t }) => {
			const scroller = document.querySelector(s);
			const target = document.querySelector(t);
			const rail = document.querySelector('nav.rail');
			const left = () => {
				const r = target.getBoundingClientRect();
				return `${r.left}|${r.right}`;
			};
			const railLeft = () => (rail ? rail.getBoundingClientRect().left : null);
			const overflows = () => scroller.scrollHeight > scroller.clientHeight + 1;
			const spacer = document.createElement('div');
			spacer.style.cssText = 'height:4000px;flex:none';
			const result = {
				stable: scroller.classList.contains('scroll-stable'),
				gutter: scroller.offsetWidth - scroller.clientWidth,
				overflowBefore: overflows(),
				before: left(),
				railBefore: railLeft()
			};
			scroller.appendChild(spacer);
			result.overflowAfter = overflows();
			result.after = left();
			result.railAfter = railLeft();
			scroller.classList.remove('scroll-stable');
			result.afterWithoutFix = left();
			spacer.remove();
			result.beforeWithoutFix = left();
			scroller.classList.add('scroll-stable');
			return result;
		},
		{ s: scrollerSel, t: targetSel }
	);
}

async function checkPage(page, name, scroller, target) {
	await page.locator(scroller).waitFor({ timeout: 30_000 });
	await page.locator(target).first().waitFor({ timeout: 30_000 });
	await sleep(500);
	const m = await measure(page, scroller, target);
	console.log(`  ${name}: ${JSON.stringify(m)}`);
	check(
		`${name}: スクロール前後で内容の位置(left と right)が同じ`,
		m.stable && m.overflowAfter && !m.overflowBefore && m.before === m.after,
		`before=${m.before} after=${m.after} overflow ${m.overflowBefore}→${m.overflowAfter}`
	);
	check(`${name}: スクロールバー分の幅を常に確保している`, m.gutter > 0, `gutter=${m.gutter}`);
	check(
		`${name}: 固定のナビ(AppRail)の位置は変わらない`,
		m.railBefore === m.railAfter,
		`${m.railBefore} → ${m.railAfter}`
	);
	// 対照: .scroll-stable が無ければ、スクロールの有無で left がずれる(このテストがずれを検出できる)
	check(
		`${name}: (対照) .scroll-stable を外すとずれる`,
		m.afterWithoutFix !== m.beforeWithoutFix,
		`${m.beforeWithoutFix} → ${m.afterWithoutFix}`
	);
}

async function main() {
	const vite = await startVite();
	// Playwright のヘッドレスは --hide-scrollbars を付けるので、外してクラシックスクロールバーを出す
	const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
	try {
		const context = await browser.newContext({
			// 高さに余裕を持たせ、スペーサーを足すまではスクロールが入らないようにする
			viewport: { width: 1400, height: 2600 },
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		const page = await context.newPage();
		page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));

		await page.goto(`${vite.base}/home`);
		const pid = await seedProject(page, { title: 'E2E スクロールバー', content: '短い本文' });
		await page.evaluate(async (pid) => {
			const { plotsDB, charactersDB, worldbuildingDB } = await import('/src/lib/db/index.ts');
			await plotsDB.create({ projectId: pid, title: 'プロット', type: 'scene' });
			await charactersDB.create({ projectId: pid, name: '人物', role: '役' });
			await worldbuildingDB.create({
				projectId: pid,
				category: 'location',
				title: '設定',
				content: '内容'
			});
		}, pid);

		console.log('[ホーム]');
		await page.goto(`${vite.base}/home`);
		await checkPage(page, 'ホーム', '.home-page', '.home-head');

		console.log('[エディタ]');
		await page.goto(`${vite.base}/project/${pid}/editor`);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await checkPage(page, 'エディタ', '.editor-panel--editor', '.editor-page');

		console.log('[プロット・人物・設定資料・進捗]');
		for (const [name, route] of [
			['プロット', 'plot'],
			['人物', 'characters'],
			['設定資料', 'worldbuilding'],
			['進捗', 'progress']
		]) {
			await page.goto(`${vite.base}/project/${pid}/${route}`);
			await checkPage(page, name, 'main.scroll-stable', 'main .page-body');
		}

		console.log('[通読]');
		await page.goto(`${vite.base}/project/${pid}/preview`);
		await checkPage(
			page,
			'通読',
			'[data-testid="reader"]',
			'[data-testid="reader"] .chapter-title'
		);

		console.log('[設定: スペーサー]');
		await page.goto(`${vite.base}/settings#appearance`);
		await checkPage(page, '設定', '.settings-scroll', '.settings-title');

		console.log('[設定: セクション間(スクロールあり/なし)]');
		// 普通の高さに戻す(長いセクションでスクロールが入る)
		await page.setViewportSize({ width: 1400, height: 900 });
		const sections = await page
			.locator('.settings-nav a, .settings-nav button')
			.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? el.textContent));
		const lefts = [];
		for (const key of ['appearance', 'editor', 'sync', 'sharing', 'ai', 'data', 'about']) {
			await page.goto(`${vite.base}/settings#${key}`);
			await page.locator('.settings-title').waitFor();
			await sleep(400);
			lefts.push(
				await page.evaluate(() => {
					const sc = document.querySelector('.settings-scroll');
					const r = (sel) => document.querySelector(sel)?.getBoundingClientRect().left;
					return {
						section: location.hash,
						overflow: sc.scrollHeight > sc.clientHeight + 1,
						title: r('.settings-title'),
						nav: r('.settings-nav'),
						heading: r('.section-title'),
						card: r('.settings-card')
					};
				})
			);
		}
		console.log(`  sections(nav items)=${sections.length}`);
		for (const l of lefts) console.log(`  ${JSON.stringify(l)}`);
		check(
			'設定: スクロールが入るセクションと入らないセクションの両方がある',
			lefts.some((l) => l.overflow) && lefts.some((l) => !l.overflow)
		);
		for (const field of ['title', 'nav', 'heading', 'card']) {
			const values = lefts.map((l) => l[field]).filter((v) => v !== undefined);
			check(
				`設定: 全セクションで ${field} の left が同じ`,
				values.length > 0 && values.every((v) => v === values[0]),
				values.join(' / ')
			);
		}
		await shotEl(page.locator('.settings-scroll'), 'settings-scrollbar');

		await context.close();

		console.log('[モバイル(オーバーレイのスクロールバー)]');
		const mobile = await browser.newContext({
			...devices['iPhone 13'],
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		const mp = await mobile.newPage();
		mp.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
		await mp.goto(`${vite.base}/home`);
		await mp.locator('.home-page').waitFor({ timeout: 30_000 });
		await sleep(400);
		const gutters = {};
		gutters.home = await mp.evaluate(() => {
			const sc = document.querySelector('.home-page');
			return sc.offsetWidth - sc.clientWidth;
		});
		await mp.goto(`${vite.base}/settings#appearance`);
		await mp.locator('.settings-scroll').waitFor();
		gutters.settings = await mp.evaluate(() => {
			const sc = document.querySelector('.settings-scroll');
			return sc.offsetWidth - sc.clientWidth;
		});
		check(
			'オーバーレイのスクロールバーでは、余白(ガター)が増えない',
			Object.values(gutters).every((g) => g === 0),
			JSON.stringify(gutters)
		);
		await mobile.close();
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
