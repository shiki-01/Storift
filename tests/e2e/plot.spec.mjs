// プロットのページ(ボード / タイムライン、詳細、並べ替え)の E2E。
// `bun run test:e2e:plot` から実行する(Firebase / エミュレータ不要)。
// デスクトップとスマホ(iPhone 系)で、全文表示・列幅・ドラッグとキーボードでの並べ替え(リロード後も保持)・
// 別の列へのドラッグ・閲覧専用・スマホの一覧→詳細→戻る・横はみ出し・アイコン枠の形を確かめる。
// E2E_SHOT_DIR を指定すると、ライト/ダーク × デスクトップ/スマホのスクリーンショットを書き出す。
import {
	chromium,
	devices,
	startVite,
	seedProject,
	applyTheme,
	check,
	finish,
	shot,
	sleep,
	waitFor
} from './helpers.mjs';

const LONG = Array.from(
	{ length: 14 },
	(_, i) => `第${i + 1}行: 長い本文の確認用のテキストです。`
).join('\n');

/** 作品を作り、プロットを順に入れる(作成順 = 並び順)。viewer なら閲覧専用にする */
async function seed(page, { title, plots, viewer = false }) {
	await page.goto(`${page.__base}/home`);
	const pid = await seedProject(page, { title });
	await page.evaluate(
		async ({ pid, plots, viewer }) => {
			const { plotsDB, projectsDB } = await import('/src/lib/db/index.ts');
			for (const p of plots) {
				const plot = await plotsDB.create({
					projectId: pid,
					title: p.title,
					type: p.type ?? 'scene',
					status: p.status ?? 'idea'
				});
				if (p.content) await plotsDB.update(plot.id, { content: p.content });
			}
			if (viewer) {
				await projectsDB.update(pid, {
					sharing: {
						pid,
						role: 'viewer',
						connectionId: 'e2e',
						visibility: 'link',
						status: 'active',
						startedAt: 1
					}
				});
			}
		},
		{ pid, plots, viewer }
	);
	return pid;
}

const plotRows = (page, pid) =>
	page.evaluate(async (pid) => {
		const { plotsDB } = await import('/src/lib/db/index.ts');
		return (await plotsDB.getByProjectId(pid)).map((p) => ({
			id: p.id,
			title: p.title,
			status: p.status,
			order: p.order,
			updatedAt: p.updatedAt,
			version: p._version
		}));
	}, pid);

const columnTitles = (page, status) =>
	page.$$eval(`[data-testid="plot-column"][data-status="${status}"] [data-plot-id] .open`, (els) =>
		els.map((e) => e.textContent.trim())
	);

async function openBoard(page, pid) {
	await page.goto(`${page.__base}/project/${pid}/plot`);
	await page.locator('[data-testid="plot-board"]').waitFor({ timeout: 30_000 });
	await sleep(300);
}

async function box(locator) {
	await locator.scrollIntoViewIfNeeded();
	const b = await locator.boundingBox();
	return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/**
 * ドラッグする。path は通過点の並びで、各点は座標か、その時点の座標を返す関数(自動スクロール後の位置を使うため)。
 * dwell を指定した点では、そこで止まって待つ(端での自動スクロールを待つ)。
 * kind: 'mouse'(マウス) | 'touch'(CDP のタッチイベント。ポインタイベントは pointerType=touch になる)
 */
async function dragPath(page, kind, from, path) {
	let client;
	let cur = from;
	const send = async (type, x, y) => {
		if (kind === 'mouse') {
			if (type === 'down') await page.mouse.down();
			else if (type === 'up') await page.mouse.up();
			else await page.mouse.move(x, y);
		} else {
			await client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }]
			});
		}
	};
	const move = (x, y) => send(kind === 'mouse' ? 'move' : 'touchMove', x, y);
	if (kind === 'touch') client = await page.context().newCDPSession(page);
	if (kind === 'mouse') await page.mouse.move(from.x, from.y);
	await send(kind === 'mouse' ? 'down' : 'touchStart', from.x, from.y);
	await sleep(60);
	await move(from.x + 2, from.y + 8);
	for (const step of path) {
		const to = typeof step.to === 'function' ? await step.to() : step.to;
		const n = 14;
		for (let i = 1; i <= n; i++) {
			await move(cur.x + ((to.x - cur.x) * i) / n, cur.y + ((to.y - cur.y) * i) / n);
			await sleep(16);
		}
		cur = to;
		await sleep(step.dwell ?? 120);
	}
	await send(kind === 'mouse' ? 'up' : 'touchEnd', cur.x, cur.y);
	await client?.detach();
}

const handleOf = (page, title) => page.getByRole('button', { name: `${title}を並べ替え` });
const noOverflow = (page) =>
	page.evaluate(() => ({
		doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		body: document.body.scrollWidth - document.body.clientWidth,
		page:
			(document.querySelector('.plot-page')?.scrollWidth ?? 0) -
			(document.querySelector('.plot-page')?.clientWidth ?? 0)
	}));

async function scenario(browser, vite, { name, mobile }) {
	console.log(`\n=== ${name} ===`);
	const context = await browser.newContext(
		mobile
			? { ...devices['iPhone 13'], serviceWorkers: 'block', locale: 'ja-JP' }
			: { viewport: { width: 1400, height: 900 }, serviceWorkers: 'block', locale: 'ja-JP' }
	);
	const page = await context.newPage();
	page.__base = vite.base;
	page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
	const tag = mobile ? 'mobile' : 'desktop';

	const pid = await seed(page, {
		title: `E2E プロット ${name}`,
		plots: [
			{ title: '導入', content: LONG },
			{ title: '事件', type: 'chapter', content: '事件が起きる。' },
			{ title: '転機', type: 'arc', content: '主人公が決断する。' },
			{ title: '構想メモ', status: 'planned', content: '後で書く' }
		]
	});
	await openBoard(page, pid);

	console.log('[(b) 列の幅とカード]');
	const cols = await page.$$eval('[data-testid="plot-column"]', (els) =>
		els.map((e) => e.getBoundingClientRect().width)
	);
	check(`4 列ある`, cols.length === 4, String(cols.length));
	check(
		'どの列も幅 280px 以上 340px 以下',
		cols.every((w) => w >= 279.5 && w <= 340.5),
		cols.map(Math.round).join(',')
	);
	const cardW = await page.$eval('[data-plot-id]', (e) => e.getBoundingClientRect().width);
	check('カードの幅が窮屈でない(240px 以上)', cardW >= 240, String(Math.round(cardW)));
	if (mobile) {
		const vw = page.viewportSize().width;
		check(
			'スマホでは 1 列が画面幅の約 85%',
			Math.abs(cols[0] / vw - 0.85) < 0.12,
			`${Math.round(cols[0])} / ${vw}`
		);
		const next = await page.$$eval(
			'[data-testid="plot-column"]',
			(els) => els[1].getBoundingClientRect().left
		);
		check('次の列がのぞいている', next < vw, String(Math.round(next)));
	}
	await shot(page, `plot-board-${tag}-light`);

	console.log('[カード内の「もっと見る」]');
	const first = page.locator('[data-plot-id]').first();
	const more = first.getByRole('button', { name: 'もっと見る' });
	check('長い本文のカードに「もっと見る」が出る', await more.isVisible());
	const collapsedH = (await first.boundingBox()).height;
	await more.click();
	const expandedH = (await first.boundingBox()).height;
	check(
		'展開すると全文が出てカードが高くなる',
		expandedH > collapsedH + 40,
		`${collapsedH}→${expandedH}`
	);
	check('展開した本文に最後の行が含まれて見える', await first.getByText('第14行').isVisible());
	await first.getByRole('button', { name: '閉じる' }).click();

	console.log('[(a) 全文を、編集を押さずに読める]');
	await first.locator('.open').click();
	const detail = page.locator('.detail-pane');
	await detail.waitFor();
	await detail.getByText('第14行').waitFor();
	check(
		'詳細に最後の行まで表示されている(編集を押していない)',
		await detail.getByText('第14行').isVisible()
	);
	check('編集フォーム(textarea)は出ていない', (await detail.locator('textarea').count()) === 0);
	check('「編集」ボタンがある', await detail.getByRole('button', { name: '編集' }).isVisible());
	const wsp = await detail
		.locator('.body')
		.first()
		.evaluate((el) => getComputedStyle(el).whiteSpace);
	check('本文は改行を保つ(pre-wrap)', wsp === 'pre-wrap', wsp);
	const sel = await detail
		.locator('.body')
		.first()
		.evaluate((el) => getComputedStyle(el).userSelect);
	check('本文は選択できる', sel === 'text', sel);
	await shot(page, `plot-detail-${tag}-light`);

	console.log('[(h) 横にはみ出さない]');
	let of = await noOverflow(page);
	check(
		'詳細を開いた状態でも横にはみ出さない',
		of.doc <= 0 && of.body <= 0 && of.page <= 0,
		JSON.stringify(of)
	);

	if (mobile) {
		console.log('[(g) スマホ: 一覧 → 詳細 → 戻る]');
		check(
			'詳細が全画面(ページ幅いっぱい)',
			Math.abs((await detail.boundingBox()).width - page.viewportSize().width) < 2
		);
		check('URL に #<id> が付く', /#[0-9a-f-]{8,}/.test(page.url()), page.url());
		check(
			'一覧は隠れている',
			!(await page.locator('[data-testid="plot-column"]').first().isVisible())
		);
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="plot-column"]').first().waitFor({ state: 'visible' });
		check('戻るボタンで一覧に戻り hash が消える', !page.url().includes('#'), page.url());
		check('詳細は閉じている', (await page.locator('.detail-pane').count()) === 0);
		// ブラウザ / Android の戻る
		await first.locator('.open').click();
		await page.locator('.detail-pane').waitFor();
		await page.goBack();
		await page.locator('[data-testid="plot-column"]').first().waitFor({ state: 'visible' });
		check(
			'ブラウザの戻る(Android の戻る)で一覧へ戻る',
			(await page.locator('.detail-pane').count()) === 0 && page.url().includes('/plot')
		);
		// リロードで復元
		await first.locator('.open').click();
		await page.locator('.detail-pane').waitFor();
		await page.reload();
		await page.locator('.detail-pane').waitFor({ timeout: 30_000 });
		await page.locator('.detail-pane').getByText('第14行').waitFor();
		check('リロードで選択中の項目が復元される', true);
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="plot-column"]').first().waitFor({ state: 'visible' });
	} else {
		check(
			'広い画面では一覧と詳細が並ぶ',
			(await page.locator('[data-testid="plot-column"]').first().isVisible()) &&
				(await detail.isVisible())
		);
		await detail.getByRole('button', { name: '詳細を閉じる' }).click();
	}

	console.log('[編集 → 保存 / 未保存の確認]');
	await first.locator('.open').click();
	await page.locator('.detail-pane').waitFor();
	await page.locator('.detail-pane').getByRole('button', { name: '編集' }).click();
	const title = page.locator('#plot-title');
	await title.fill('導入(改)');
	await page.getByRole('button', { name: '保存' }).click();
	await page.locator('.detail-pane h2', { hasText: '導入(改)' }).waitFor();
	check(
		'保存すると閲覧ビューに戻り、題名が変わる',
		(await page.locator('.detail-pane textarea').count()) === 0
	);
	check('一覧のカードにも反映される', (await columnTitles(page, 'idea')).includes('導入(改)'));
	// 元に戻す
	await page.locator('.detail-pane').getByRole('button', { name: '編集' }).click();
	await page.locator('#plot-title').fill('導入');
	await page.getByRole('button', { name: '保存' }).click();
	await page.locator('.detail-pane h2', { hasText: '導入' }).waitFor();
	// 未保存で別の項目へ
	await page.locator('.detail-pane').getByRole('button', { name: '編集' }).click();
	await page.locator('#plot-title').fill('書きかけ');
	if (mobile) {
		await page.getByRole('button', { name: '一覧に戻る' }).click();
	} else {
		await page.locator('[data-plot-id]').nth(1).locator('.open').click();
	}
	const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
	await dialog.waitFor({ timeout: 5000 });
	check(
		'未保存の変更があると、移る前に確認が出る',
		await dialog.getByText('保存していない変更').isVisible()
	);
	await dialog.getByRole('button', { name: /キャンセル|いいえ/ }).click();
	check(
		'キャンセルすると編集が残る',
		(await page.locator('#plot-title').inputValue()) === '書きかけ'
	);
	await page.getByRole('button', { name: 'キャンセル' }).first().click();
	const dlg2 = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
	await dlg2.waitFor({ timeout: 5000 });
	await dlg2.getByRole('button', { name: '破棄して移動' }).click();
	await sleep(300);
	check('破棄すると閲覧ビューに戻る', (await page.locator('.detail-pane textarea').count()) === 0);
	if (mobile) {
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="plot-column"]').first().waitFor({ state: 'visible' });
	} else {
		await page.locator('.detail-pane').getByRole('button', { name: '詳細を閉じる' }).click();
	}

	console.log('[(c) ドラッグで並べ替え → リロード後も保持]');
	const before = await plotRows(page, pid);
	check(
		'初期の並び',
		(await columnTitles(page, 'idea')).join() === '導入,事件,転機',
		(await columnTitles(page, 'idea')).join()
	);
	const h3 = await box(handleOf(page, '転機'));
	const inView = async (title) => {
		const b = await box(page.locator('[data-plot-id]', { hasText: title }).first());
		return { x: b.cx, y: b.y + 6 };
	};
	if (mobile) {
		// 画面が狭く、移動先が見えていない: 列の上端まで運んで、自動スクロールで移動先が現れるのを待つ
		const colTop = await page
			.locator('.col-body')
			.first()
			.evaluate((el) => el.getBoundingClientRect().top);
		await dragPath(page, 'touch', { x: h3.cx, y: h3.cy }, [
			{ to: { x: h3.cx, y: colTop + 10 }, dwell: 1500 },
			{ to: () => inView('導入') }
		]);
	} else {
		const target = await inView('導入');
		await dragPath(page, 'mouse', { x: h3.cx, y: h3.cy }, [{ to: target }]);
	}
	await waitFor(
		'ドラッグ後の並び',
		async () => (await columnTitles(page, 'idea')).join() === '転機,導入,事件'
	);
	check(
		'ドラッグで「転機」が先頭に移る',
		(await columnTitles(page, 'idea')).join() === '転機,導入,事件'
	);
	await waitFor('保存', async () => (await plotRows(page, pid))[0].title === '転機');
	const after = await plotRows(page, pid);
	const changed = after.filter((a) => a.updatedAt !== before.find((b) => b.id === a.id).updatedAt);
	check(
		'書き換わった行は 1 件だけ',
		changed.length === 1 && changed[0].title === '転機',
		changed.map((c) => c.title).join()
	);
	await page.reload();
	await page.locator('[data-testid="plot-board"]').waitFor();
	await sleep(300);
	check(
		'リロード後も順序が保たれる',
		(await columnTitles(page, 'idea')).join() === '転機,導入,事件',
		(await columnTitles(page, 'idea')).join()
	);

	console.log('[(d) キーボードで並べ替え]');
	const kb = handleOf(page, '転機');
	await kb.focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	const live = await page
		.locator('[data-testid="plot-column"][data-status="idea"] [role="status"]')
		.innerText();
	check('移動を aria-live で通知する', /3 番目に移動しました/.test(live), live);
	await page.keyboard.press('Space');
	await waitFor(
		'キーボード後の並び',
		async () => (await columnTitles(page, 'idea')).join() === '導入,事件,転機'
	);
	check(
		'Space / ↓↓ / Space で末尾へ移る',
		(await columnTitles(page, 'idea')).join() === '導入,事件,転機'
	);
	// 保存の完了を待ってからリロードする
	await waitFor(
		'保存',
		async () =>
			(await plotRows(page, pid))
				.map((r) => r.title)
				.slice(0, 3)
				.join() === '導入,事件,転機'
	);
	await page.reload();
	await page.locator('[data-testid="plot-board"]').waitFor();
	await sleep(300);
	check(
		'キーボードでの並べ替えもリロード後に保たれる',
		(await columnTitles(page, 'idea')).join() === '導入,事件,転機'
	);
	await handleOf(page, '導入').focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Escape');
	check('Escape で取り消せる', (await columnTitles(page, 'idea')).join() === '導入,事件,転機');

	console.log('[メニュー: 上へ / 下へ / 状態を変更]');
	const menuBtn = page.getByRole('button', { name: '事件の操作' });
	await menuBtn.click();
	await page.getByRole('button', { name: '上へ' }).click();
	await waitFor('上へ', async () => (await columnTitles(page, 'idea')).join() === '事件,導入,転機');
	check('メニューの「上へ」で 1 つ上がる', true);
	await page.getByRole('button', { name: '事件の操作' }).click();
	await page.getByRole('combobox', { name: '状態を変更' }).click();
	await page.getByRole('option', { name: '執筆済み' }).click();
	await waitFor('状態変更', async () => (await columnTitles(page, 'written')).join() === '事件');
	check(
		'メニューの Select で状態を変えると列が移る',
		(await columnTitles(page, 'written')).join() === '事件'
	);
	await page.getByRole('button', { name: '元に戻す' }).first().waitFor({ timeout: 5000 });
	check('状態を変えた通知に「元に戻す」がある', true);
	await page.getByRole('button', { name: '元に戻す' }).first().click();
	await waitFor('元に戻す', async () => (await columnTitles(page, 'idea')).includes('事件'));
	check(
		'「元に戻す」で元の列へ戻る',
		(await columnTitles(page, 'idea')).join() === '事件,導入,転機',
		(await columnTitles(page, 'idea')).join()
	);

	console.log('[(e) 別の列へのドラッグで状態が変わる]');
	const src = await box(handleOf(page, '転機'));
	const plannedCard = () =>
		box(page.locator('[data-testid="plot-column"][data-status="planned"] [data-plot-id]').first());
	if (mobile) {
		// 次の列は画面の右端にのぞいている。右端へ運び、自動スクロールで列が現れるのを待ってから、列の中へ落とす
		const vw = page.viewportSize().width;
		await dragPath(page, 'touch', { x: src.cx, y: src.cy }, [
			{ to: { x: vw - 6, y: src.cy }, dwell: 1500 },
			{
				to: async () => {
					const d = await plannedCard();
					return { x: d.cx, y: d.y + d.height - 6 };
				}
			}
		]);
	} else {
		const dst = await plannedCard();
		await dragPath(page, 'mouse', { x: src.cx, y: src.cy }, [
			{ to: { x: dst.cx, y: dst.y + dst.height - 6 } }
		]);
	}
	await waitFor('別の列', async () => (await columnTitles(page, 'planned')).includes('転機'));
	check(
		'「転機」が計画中の列の末尾に移る',
		(await columnTitles(page, 'planned')).join() === '構想メモ,転機',
		(await columnTitles(page, 'planned')).join()
	);
	await waitFor(
		'状態の保存',
		async () => (await plotRows(page, pid)).find((r) => r.title === '転機').status === 'planned'
	);
	const moved = (await plotRows(page, pid)).find((r) => r.title === '転機');
	check('状態が planned に変わっている', moved.status === 'planned');
	await page.reload();
	await page.locator('[data-testid="plot-board"]').waitFor();
	await sleep(300);
	check('リロード後も移動先の列にいる', (await columnTitles(page, 'planned')).includes('転機'));

	console.log('[タイムライン]');
	await page.getByRole('button', { name: 'タイムライン' }).click();
	await page.locator('[data-testid="plot-timeline"]').waitFor();
	await sleep(300);
	const tl = await page.$$eval('[data-testid="plot-timeline"] [data-plot-id] .open', (els) =>
		els.map((e) => e.textContent.trim())
	);
	check('全プロットが時系列に並ぶ', tl.length === 4, tl.join());
	await shot(page, `plot-timeline-${tag}-light`);
	const badges = await page.$$eval('.rail > span', (els) =>
		els.map((e) => {
			const r = e.getBoundingClientRect();
			return {
				w: r.width,
				h: r.height,
				radius: getComputedStyle(e).borderRadius,
				ar: getComputedStyle(e).aspectRatio
			};
		})
	);
	console.log(`  badges=${JSON.stringify(badges[0])}`);
	check(
		'(i) 番号の丸い枠が正円(width == height、50%)',
		badges.length > 0 &&
			badges.every((b) => Math.abs(b.w - b.h) < 0.5 && b.w >= 28 && b.radius === '50%'),
		JSON.stringify(badges[0])
	);
	const tlCard = page.locator('[data-testid="plot-timeline"] [data-plot-id]', { hasText: '導入' });
	const tlMore = tlCard.getByRole('button', { name: 'もっと見る' });
	check('タイムラインの長文にも「もっと見る」がある', await tlMore.isVisible());
	await tlMore.click();
	check('展開すると全文が読める', await tlCard.getByText('第14行').isVisible());
	// タイムラインでの並べ替え(キーボード)
	const order0 = await plotRows(page, pid);
	const firstTitle = order0[0].title;
	await handleOf(page, firstTitle).focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Space');
	await sleep(500);
	const order1 = await plotRows(page, pid);
	check(
		'タイムラインでも並べ替えられ、状態は変わらない',
		order1[1].title === firstTitle &&
			order1.every((r) => r.status === order0.find((o) => o.id === r.id).status),
		order1.map((r) => r.title).join()
	);
	of = await noOverflow(page);
	check(
		'タイムラインも横にはみ出さない',
		of.doc <= 0 && of.body <= 0 && of.page <= 0,
		JSON.stringify(of)
	);

	console.log('[絞り込み]');
	await page.getByRole('button', { name: 'ボード' }).click();
	await page.locator('[data-testid="plot-board"]').waitFor();
	await page.getByRole('searchbox', { name: 'プロットを検索' }).fill('構想');
	await sleep(200);
	check('検索語で絞り込める', (await page.locator('[data-plot-id]').count()) === 1);
	check('絞り込み中は並べ替えのハンドルが出ない', (await page.locator('.handle').count()) === 0);
	check(
		'並べ替えできない理由を案内する',
		await page.getByText('並べ替えは、絞り込みを外して').isVisible()
	);
	await page.getByRole('searchbox', { name: 'プロットを検索' }).fill('');
	await sleep(200);
	check('絞り込みを外すとハンドルが戻る', (await page.locator('.handle').count()) === 4);

	console.log('[新規作成(詳細ペイン / 全画面)]');
	await page.getByTestId('plot-new').click();
	await page.locator('#plot-title').waitFor();
	check(
		'新規作成は編集フォームで始まる',
		await page.locator('.detail-pane #plot-content').isVisible()
	);
	await page.locator('#plot-title').fill('新しい山場');
	await page.locator('#plot-content').fill('クライマックス。\n二行目。');
	await page.getByRole('button', { name: '作成' }).click();
	await page.locator('.detail-pane h2', { hasText: '新しい山場' }).waitFor();
	check(
		'作成後は閲覧ビューで全文が見える',
		await page.locator('.detail-pane').getByText('二行目').isVisible()
	);
	check('ボードにも追加される', (await columnTitles(page, 'idea')).includes('新しい山場'));

	console.log('[ダーク]');
	await applyTheme(page, 'dark');
	await shot(page, `plot-detail-${tag}-dark`);
	if (mobile) {
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="plot-column"]').first().waitFor({ state: 'visible' });
	} else {
		await page.locator('.detail-pane').getByRole('button', { name: '詳細を閉じる' }).click();
	}
	await sleep(300);
	check(
		'詳細を閉じるとカードの選択表示も外れる',
		(await page.locator('.card.selected').count()) === 0
	);
	await shot(page, `plot-board-${tag}-dark`);
	await applyTheme(page, 'light');

	await context.close();
}

async function readOnlyScenario(browser, vite, { name, mobile }) {
	console.log(`\n=== 閲覧専用 (${name}) ===`);
	const context = await browser.newContext(
		mobile
			? { ...devices['iPhone 13'], serviceWorkers: 'block', locale: 'ja-JP' }
			: { viewport: { width: 1400, height: 900 }, serviceWorkers: 'block', locale: 'ja-JP' }
	);
	const page = await context.newPage();
	page.__base = vite.base;
	page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
	const pid = await seed(page, {
		title: `E2E 閲覧専用 ${name}`,
		viewer: true,
		plots: [
			{ title: '導入', content: LONG },
			{ title: '事件', content: '事件が起きる。' }
		]
	});
	await openBoard(page, pid);
	check('(f) 並べ替えのハンドルが出ない', (await page.locator('.handle').count()) === 0);
	check(
		'(f) 移動ボタンも出ない',
		(await page.getByRole('button', { name: /を(上|下)へ$/ }).count()) === 0
	);
	check(
		'(f) 操作メニューが出ない',
		(await page.getByRole('button', { name: /の操作$/ }).count()) === 0
	);
	check('(f) 新規作成が無効', await page.getByTestId('plot-new').isDisabled());
	check(
		'(f) 列の追加ボタンが出ない',
		(await page.getByRole('button', { name: /にプロットを追加$/ }).count()) === 0
	);
	// キーボード操作も無効(ハンドルが無いので、カードにフォーカスして Space を押しても動かない)
	await page.locator('[data-plot-id]').first().locator('.open').focus();
	await page.keyboard.press('ArrowDown');
	check(
		'(f) キーボードでも並べ替わらない',
		(await columnTitles(page, 'idea')).join() === '導入,事件'
	);
	await page.locator('[data-plot-id]').first().locator('.open').click();
	const detail = page.locator('.detail-pane');
	await detail.waitFor();
	check('(f) 閲覧専用でも全文が読める', await detail.getByText('第14行').isVisible());
	check(
		'(f) 編集・削除ボタンが出ない',
		(await detail.getByRole('button', { name: '編集' }).count()) === 0 &&
			(await detail.getByRole('button', { name: '削除' }).count()) === 0
	);
	check(
		'(f) 状態は変更できない(Select が無い)',
		(await detail.getByRole('combobox', { name: '状態を変更' }).count()) === 0
	);
	await shot(page, `plot-readonly-${mobile ? 'mobile' : 'desktop'}-light`);
	await context.close();
}

async function main() {
	const vite = await startVite();
	const browser = await chromium.launch();
	try {
		await scenario(browser, vite, { name: 'デスクトップ', mobile: false });
		await scenario(browser, vite, { name: 'スマホ(iPhone 13)', mobile: true });
		await readOnlyScenario(browser, vite, { name: 'デスクトップ', mobile: false });
		await readOnlyScenario(browser, vite, { name: 'スマホ', mobile: true });
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
