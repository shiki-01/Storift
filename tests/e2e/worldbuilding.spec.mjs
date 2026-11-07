// 設定資料のページ(分類のチップと件数、一覧/詳細、タグの絞り込み、分類ごとの並べ替え)の E2E。
// `bun run test:e2e:worldbuilding` から実行する(Firebase / エミュレータ不要)。
// デスクトップとスマホ(iPhone 系)で、全文表示・アイコン枠の形(楕円にならない)・行の寸法・
// ドラッグとキーボードでの並べ替え(リロード後も保持)・分類の変更・閲覧専用・一覧→詳細→戻るを確かめる。
// E2E_SHOT_DIR を指定すると、ライト/ダーク × デスクトップ/スマホのスクリーンショットを書き出す。
import {
	chromium,
	startVite,
	seedProject,
	applyTheme,
	check,
	finish,
	shot,
	sleep,
	waitFor
} from './helpers.mjs';
import {
	LONG,
	contextOptions,
	makeViewer,
	box,
	dragPath,
	overflowOf,
	noOverflow
} from './items-helpers.mjs';

const LONG_TITLE = '非常に長いタイトルを持つ設定資料のサンプルとしての名前その二その三その四';

/** 作品を作り、設定資料を順に入れる(分類ごとの作成順 = 並び順) */
async function seed(page, { title, viewer = false }) {
	await page.goto(`${page.__base}/home`);
	const pid = await seedProject(page, { title });
	await page.evaluate(
		async ({ pid, long, longTitle }) => {
			const { worldbuildingDB } = await import('/src/lib/db/index.ts');
			const make = async (category, title, content, tags = []) => {
				const w = await worldbuildingDB.create({ projectId: pid, category, title });
				await worldbuildingDB.update(w.id, { content, tags });
			};
			await make('term', '魔法', long, ['力', '基礎']);
			await make('term', '契約', '精霊との約束。', ['力']);
			await make('location', '王都', '白い城壁の街。', ['街']);
			await make('location', '学院', '学びの場所。');
			await make('timeline', '大戦', '百年前の戦い。');
			await make('other', longTitle, '');
		},
		{ pid, long: LONG, longTitle: LONG_TITLE }
	);
	if (viewer) await makeViewer(page, pid);
	return pid;
}

const rowOf = (page, title) => page.locator('[data-testid="world-row"]', { hasText: title });
const handleOf = (page, title) => page.getByRole('button', { name: `${title}を並べ替え` });
const rowTitles = (page) =>
	page.$$eval('[data-testid="world-row"] .title', (els) => els.map((e) => e.textContent.trim()));
const groupTitles = (page, category) =>
	page.$$eval(`[data-testid="world-group"][data-category="${category}"] .title`, (els) =>
		els.map((e) => e.textContent.trim())
	);
const chip = (page, value) => page.locator(`.chip[data-category="${value}"]`);
const chipCounts = (page) =>
	page.$$eval('.chip', (els) =>
		Object.fromEntries(els.map((e) => [e.dataset.category, e.querySelector('.count').textContent]))
	);
const dbRows = (page, pid) =>
	page.evaluate(async (pid) => {
		const { worldbuildingDB } = await import('/src/lib/db/index.ts');
		return (await worldbuildingDB.getByProjectId(pid)).map((w) => ({
			id: w.id,
			title: w.title,
			category: w.category,
			order: w.order,
			tags: w.tags,
			updatedAt: w.updatedAt
		}));
	}, pid);
const dbCategory = async (page, pid, category) =>
	(await dbRows(page, pid)).filter((r) => r.category === category).map((r) => r.title);

async function openList(page, pid) {
	await page.goto(`${page.__base}/project/${pid}/worldbuilding`);
	await page.locator('[data-testid="world-list"]').waitFor({ timeout: 30_000 });
	await sleep(300);
}

async function scenario(browser, vite, { name, mobile }) {
	console.log(`\n=== ${name} ===`);
	const context = await browser.newContext(contextOptions(mobile));
	const page = await context.newPage();
	page.__base = vite.base;
	page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
	const tag = mobile ? 'mobile' : 'desktop';
	const vw = mobile ? page.viewportSize().width : 1400;

	const pid = await seed(page, { title: `E2E 設定資料 ${name}` });
	await openList(page, pid);
	const detail = page.locator('.detail-pane');

	console.log('[(e) 分類のチップと件数]');
	check('<select> を使っていない', (await page.locator('select').count()) === 0);
	const chips = await page.$$eval('.chip', (els) =>
		els.map((e) => ({
			label: e.firstChild.textContent.trim(),
			value: e.dataset.category,
			pressed: e.getAttribute('aria-pressed'),
			top: Math.round(e.getBoundingClientRect().top),
			h: e.getBoundingClientRect().height
		}))
	);
	check(
		'チップは「すべて」＋分類名',
		chips.map((c) => c.label).join() === 'すべて,用語,場所,年表,その他',
		chips.map((c) => c.label).join()
	);
	check(
		'既定は「すべて」が選択中',
		chips[0].pressed === 'true' && chips.slice(1).every((c) => c.pressed === 'false')
	);
	const counts = await chipCounts(page);
	check(
		'件数: すべて 6 / 用語 2 / 場所 2 / 年表 1 / その他 1',
		counts.all === '6' &&
			counts.term === '2' &&
			counts.location === '2' &&
			counts.timeline === '1' &&
			counts.other === '1',
		JSON.stringify(counts)
	);
	check(
		'data-tour の分類チップがある',
		(await page.locator('[data-tour="worldbuilding-categories"]').count()) === 1
	);
	if (mobile) {
		check(
			'スマホ: チップは 1 行に並び(折り返さない)、40px 以上の高さ',
			chips.every((c) => c.top === chips[0].top && c.h >= 40)
		);
		const scroll = await page.locator('.chips').evaluate((e) => ({
			sw: e.scrollWidth,
			cw: e.clientWidth,
			ox: getComputedStyle(e).overflowX
		}));
		check(
			'スマホ: はみ出す分は横スクロール',
			scroll.ox === 'auto' && scroll.sw >= scroll.cw,
			JSON.stringify(scroll)
		);
	}
	check(
		'「すべて」では分類ごとの節に分かれる',
		(await page.locator('[data-testid="world-group"]').count()) === 4
	);
	check(
		'節の中は手動順',
		(await groupTitles(page, 'term')).join() === '魔法,契約' &&
			(await groupTitles(page, 'location')).join() === '王都,学院'
	);
	if (!mobile) {
		check(
			'広い画面で何も選んでいないとき、案内が出る',
			await page.getByText('資料を選んでください').isVisible()
		);
	}
	await shot(page, `world-list-${tag}-light`);

	console.log('[(d) アイコン枠は楕円にならない / 行の寸法]');
	const rows = await page.$$eval('[data-testid="world-row"]', (els) =>
		els.map((r) => {
			const rect = r.getBoundingClientRect();
			const icon = r.querySelector('[data-shape]');
			const a = icon.getBoundingClientRect();
			const cs = getComputedStyle(icon);
			const buttons = [...r.querySelectorAll('button')].map((b) => {
				const x = b.getBoundingClientRect();
				return { w: x.width, h: x.height, right: x.right };
			});
			const title = r.querySelector('.title');
			return {
				left: rect.left,
				right: rect.right,
				height: rect.height,
				iconLeft: a.left,
				w: a.width,
				h: a.height,
				radius: parseFloat(cs.borderTopLeftRadius),
				radiusText: cs.borderRadius,
				shrink: cs.flexShrink,
				ratio: cs.aspectRatio,
				shape: icon.dataset.shape,
				svg: !!icon.querySelector('svg'),
				buttons,
				lastRight: Math.max(...buttons.map((b) => b.right)),
				ellipsis: cs.textOverflow,
				titleEllipsis: getComputedStyle(title).textOverflow,
				clipped: title.scrollWidth > title.clientWidth,
				text: title.textContent.trim()
			};
		})
	);
	check(
		'アイコン枠は width == height == 44px',
		rows.every((r) => r.w === 44 && r.h === 44),
		JSON.stringify(rows.map((r) => [r.w, r.h]))
	);
	check(
		'アイコン枠の角丸は 50% 未満(四角)で、100% / 50% ではない',
		rows.every(
			(r) =>
				r.shape === 'square' && r.radius > 0 && r.radius < r.w / 2 && !r.radiusText.includes('%')
		),
		rows[0].radiusText
	);
	check(
		'アイコン枠は縮まない(flex-shrink: 0、aspect-ratio: 1)',
		rows.every((r) => r.shrink === '0' && r.ratio === '1 / 1')
	);
	check(
		'アイコン枠の中は文字ではなく SVG アイコン',
		rows.every((r) => r.svg)
	);
	check(
		'行がページ幅に収まり、高さは 44px 以上',
		rows.every((r) => r.left >= 0 && r.right <= vw + 0.5 && r.height >= 44)
	);
	check(
		'長いタイトルは 1 行で省略され、メニューとハンドルは行の中に残る',
		rows.every((r) => r.titleEllipsis === 'ellipsis' && r.lastRight <= r.right) &&
			rows.find((r) => r.text === LONG_TITLE).clipped
	);
	if (mobile) {
		check(
			'スマホ: アイコンの左に 16px 以上の余白',
			rows.every((r) => r.iconLeft >= 16),
			String(rows[0].iconLeft)
		);
		check(
			'スマホ: 右端の操作の右に 16px 以上の余白',
			rows.every((r) => vw - r.lastRight >= 16),
			String(vw - rows[0].lastRight)
		);
		check(
			'スマホ: メニューとハンドルのタップ領域が 44px 以上',
			rows.every((r) => r.buttons.slice(1).every((b) => b.w >= 44 && b.h >= 44))
		);
	}
	const of0 = await overflowOf(page, '.world-page');
	check('横にはみ出さない', noOverflow(of0), JSON.stringify(of0));

	console.log('[(a) 全文を、編集を押さずに読める]');
	await rowOf(page, '魔法').locator('.open').click();
	await detail.waitFor();
	await detail.getByText('第14行').waitFor();
	check('内容の最後の行まで表示される', await detail.getByText('第14行').isVisible());
	check('編集フォームは出ていない', (await detail.locator('textarea, input').count()) === 0);
	check('「編集」ボタンがある', await detail.getByRole('button', { name: '編集' }).isVisible());
	check(
		'分類バッジが出る',
		(await detail.getByTestId('world-category-badge').innerText()) === '用語'
	);
	check(
		'タグが出る',
		(await detail.getByTestId('world-tag').allInnerTexts()).join() === '#力,#基礎'
	);
	const body = detail.locator('.body').first();
	check(
		'本文は改行を保ち、選択できる',
		(await body.evaluate((e) => getComputedStyle(e).whiteSpace)) === 'pre-wrap' &&
			(await body.evaluate((e) => getComputedStyle(e).userSelect)) === 'text'
	);
	const lead = await detail.locator('[data-shape]').first().boundingBox();
	check(
		'詳細のアイコン枠も正方形(52px)',
		Math.abs(lead.width - 52) < 0.5 && Math.abs(lead.height - 52) < 0.5,
		JSON.stringify(lead)
	);
	await shot(page, `world-detail-${tag}-light`);
	const of1 = await overflowOf(page, '.world-page');
	check('詳細を開いても横にはみ出さない', noOverflow(of1), JSON.stringify(of1));

	console.log('[(e) タグで絞り込み]');
	await detail.getByRole('button', { name: 'タグ 力 で絞り込む' }).click();
	if (mobile) {
		await page.locator('[data-testid="world-list"]').waitFor({ state: 'visible' });
		check('スマホ: タグを押すと一覧へ戻る', (await detail.count()) === 0);
	}
	await waitFor('タグの絞り込み', async () => (await rowTitles(page)).join() === '魔法,契約');
	check('そのタグの資料だけが並ぶ', (await rowTitles(page)).join() === '魔法,契約');
	check(
		'絞り込み中は件数がタグの結果になる',
		(await chipCounts(page)).all === '2' && (await chipCounts(page)).location === '0'
	);
	check('絞り込み中は並べ替えのハンドルが出ない', (await page.locator('.handle').count()) === 0);
	check(
		'理由を案内する',
		await page.getByText('並べ替えは、検索とタグの絞り込みを外して').isVisible()
	);
	const tagSelect = page.getByRole('combobox', { name: 'タグで絞り込み' });
	check('タグの Select に選択中のタグが出る', (await tagSelect.innerText()).includes('#力'));
	await tagSelect.click();
	await page.getByRole('option', { name: 'すべてのタグ' }).click();
	await sleep(200);
	check(
		'「すべてのタグ」で絞り込みが外れる',
		(await rowTitles(page)).length === 6 && (await page.locator('.handle').count()) === 6
	);
	await tagSelect.click();
	await page.getByRole('option', { name: /#街/ }).click();
	await sleep(200);
	check('Select からもタグで絞り込める', (await rowTitles(page)).join() === '王都');
	await tagSelect.click();
	await page.getByRole('option', { name: 'すべてのタグ' }).click();

	console.log('[検索と並び / 分類で絞り込み]');
	const search = page.getByRole('searchbox', { name: '設定資料を検索' });
	await search.fill('精霊');
	await sleep(200);
	check('内容でも検索できる', (await rowTitles(page)).join() === '契約');
	await search.fill('基礎');
	await sleep(200);
	check('タグでも検索できる', (await rowTitles(page)).join() === '魔法');
	await search.fill('該当なし');
	await sleep(200);
	check(
		'一致しないときの案内が出る',
		await page.getByText('条件に合う設定資料がありません').isVisible()
	);
	await page.getByRole('button', { name: '絞り込みを外す' }).click();
	await sleep(200);
	check('絞り込みを外すと全件に戻る', (await rowTitles(page)).length === 6);
	await page.getByRole('combobox', { name: '並び順' }).click();
	await page.getByRole('option', { name: '更新日が新しい順' }).click();
	await sleep(200);
	check(
		'更新日順では節に分かれず、新しい順(最後に作った資料が先頭)',
		(await page.locator('[data-testid="world-group"]').count()) === 0 &&
			(await rowTitles(page))[0] === LONG_TITLE
	);
	check('更新日順ではハンドルが出ない', (await page.locator('.handle').count()) === 0);
	await page.getByRole('combobox', { name: '並び順' }).click();
	await page.getByRole('option', { name: '手動順' }).click();
	await sleep(200);
	await chip(page, 'location').click();
	await sleep(200);
	check('「場所」を選ぶと、その分類だけが並ぶ', (await rowTitles(page)).join() === '王都,学院');
	check(
		'選んだチップが押された状態になる',
		(await chip(page, 'location').getAttribute('aria-pressed')) === 'true'
	);
	check(
		'分類を選ぶと節の見出しは出ない',
		(await page.locator('[data-testid="world-group"]').count()) === 0
	);
	check('分類の中ではハンドルが出る', (await page.locator('.handle').count()) === 2);
	await chip(page, 'all').click();

	console.log('[(c) 分類の中でドラッグ → リロード後も保持]');
	await chip(page, 'term').click();
	await sleep(200);
	const before = await dbRows(page, pid);
	const src = await box(handleOf(page, '契約'));
	const dst = await box(rowOf(page, '魔法'));
	await dragPath(page, mobile ? 'touch' : 'mouse', { x: src.cx, y: src.cy }, [
		{ to: { x: dst.cx, y: dst.y + 6 } }
	]);
	await waitFor('ドラッグ後の並び', async () => (await rowTitles(page)).join() === '契約,魔法');
	check('「契約」が先頭へ移る', (await rowTitles(page)).join() === '契約,魔法');
	await waitFor('保存', async () => (await dbCategory(page, pid, 'term')).join() === '契約,魔法');
	const after = await dbRows(page, pid);
	const changed = after.filter((a) => a.updatedAt !== before.find((b) => b.id === a.id).updatedAt);
	check(
		'書き換わった行は 1 件だけ',
		changed.length === 1 && changed[0].title === '契約',
		changed.map((c) => c.title).join()
	);
	check(
		'ほかの分類の並びは動かない',
		(await dbCategory(page, pid, 'location')).join() === '王都,学院'
	);
	await page.reload();
	await page.locator('[data-testid="world-list"]').waitFor({ timeout: 30_000 });
	await sleep(300);
	check(
		'リロード後も順序が保たれる(「すべて」の節の中)',
		(await groupTitles(page, 'term')).join() === '契約,魔法',
		(await groupTitles(page, 'term')).join()
	);

	console.log('[キーボードで並べ替え(「すべて」の節の中)]');
	const kb = handleOf(page, '学院');
	await kb.focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowUp');
	const live = await page
		.locator('[data-testid="world-group"][data-category="location"] [role="status"]')
		.innerText();
	check('移動を aria-live で通知する', /1 番目に移動しました/.test(live), live);
	await page.keyboard.press('Space');
	await waitFor(
		'キーボード後の並び',
		async () => (await groupTitles(page, 'location')).join() === '学院,王都'
	);
	check('Space / ↑ / Space で先頭へ', true);
	await waitFor(
		'保存',
		async () => (await dbCategory(page, pid, 'location')).join() === '学院,王都'
	);
	await page.reload();
	await page.locator('[data-testid="world-list"]').waitFor({ timeout: 30_000 });
	await sleep(300);
	check(
		'キーボードでの並べ替えもリロード後に保たれる',
		(await groupTitles(page, 'location')).join() === '学院,王都'
	);
	await handleOf(page, '王都').focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('Escape');
	check('Escape で取り消せる', (await groupTitles(page, 'location')).join() === '学院,王都');
	check(
		'節をまたいだ移動はできない(節ごとに別の一覧)',
		(await page.locator('[data-testid="world-group"][data-category="term"] .handle').count()) === 2
	);
	await page.getByRole('button', { name: '契約の操作' }).click();
	await page.getByRole('button', { name: '下へ' }).click();
	await waitFor('下へ', async () => (await groupTitles(page, 'term')).join() === '魔法,契約');
	check('メニューの「下へ」で 1 つ下がる', true);

	console.log('[編集: 分類を変えると移動先の分類の末尾に入る]');
	await rowOf(page, '魔法').locator('.open').click();
	await detail.locator('h2', { hasText: '魔法' }).waitFor();
	await detail.getByRole('button', { name: '編集' }).click();
	await page.locator('#world-title').waitFor();
	check('同じ場所が編集フォームに切り替わる', await page.locator('#world-content').isVisible());
	check('<select> を使っていない(編集中)', (await page.locator('select').count()) === 0);
	await page.getByRole('combobox', { name: '分類' }).click();
	await page.getByRole('option', { name: '場所' }).click();
	check(
		'分類を変えると案内が出る',
		await page.getByText('移動先の分類の末尾に入ります').isVisible()
	);
	// タグの追加と削除
	await page.locator('#world-tag-input').fill('古代');
	await page.locator('#world-tag-input').press('Enter');
	await page.getByRole('button', { name: 'タグ 基礎 を削除' }).click();
	await shot(page, `world-edit-${tag}-light`);
	// 未保存で別の資料へ
	if (mobile) await page.getByRole('button', { name: '一覧に戻る' }).click();
	else await rowOf(page, '大戦').locator('.open').click();
	const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
	await dialog.waitFor({ timeout: 5000 });
	check(
		'未保存の変更があると、移る前に確認が出る',
		await dialog.getByText('保存していない変更').isVisible()
	);
	await dialog.getByRole('button', { name: /キャンセル|いいえ/ }).click();
	check('キャンセルすると編集が残る', (await page.locator('#world-title').inputValue()) === '魔法');
	await detail.getByRole('button', { name: '保存' }).click();
	await detail.locator('h2', { hasText: '魔法' }).waitFor();
	await waitFor(
		'分類の保存',
		async () => (await dbCategory(page, pid, 'location')).join() === '学院,王都,魔法'
	);
	check(
		'移動先の分類(場所)の末尾に入る',
		(await dbCategory(page, pid, 'location')).join() === '学院,王都,魔法'
	);
	check('元の分類(用語)からは外れる', (await dbCategory(page, pid, 'term')).join() === '契約');
	check(
		'詳細の分類バッジが変わる',
		(await detail.getByTestId('world-category-badge').innerText()) === '場所'
	);
	check(
		'タグの追加と削除が反映される',
		(await detail.getByTestId('world-tag').allInnerTexts()).join() === '#力,#古代'
	);
	if (mobile) await page.getByRole('button', { name: '一覧に戻る' }).click();
	await page.locator('[data-testid="world-list"]').waitFor({ state: 'visible' });
	check(
		'一覧でも場所の節の末尾に出る',
		(await groupTitles(page, 'location')).join() === '学院,王都,魔法'
	);
	check(
		'件数も更新される',
		(await chipCounts(page)).term === '1' && (await chipCounts(page)).location === '3'
	);

	console.log('[新規作成(選択中の分類が既定)]');
	await chip(page, 'timeline').click();
	await page.getByTestId('world-new').click();
	await page.locator('#world-title').waitFor();
	check(
		'新規作成は編集フォームで始まる',
		await page.locator('.detail-pane #world-content').isVisible()
	);
	check(
		'選択中の分類(年表)が既定になる',
		(await page.getByRole('combobox', { name: '分類' }).innerText()).includes('年表')
	);
	await page.locator('#world-title').fill('建国');
	await page.locator('#world-content').fill('王国が建てられた。\n二行目。');
	await page.locator('#world-tag-input').fill('歴史');
	await page.getByRole('button', { name: '作成' }).click();
	await detail.locator('h2', { hasText: '建国' }).waitFor();
	check('作成後は閲覧ビューで全文が見える', await detail.getByText('二行目。').isVisible());
	check(
		'入力したままのタグも保存される',
		(await detail.getByTestId('world-tag').innerText()) === '#歴史'
	);
	check('年表の末尾に追加される', (await dbCategory(page, pid, 'timeline')).join() === '大戦,建国');

	console.log('[ダーク]');
	await applyTheme(page, 'dark');
	await shot(page, `world-detail-${tag}-dark`);
	if (mobile) {
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="world-list"]').waitFor({ state: 'visible' });
	}
	await chip(page, 'all').click();
	await sleep(300);
	await shot(page, `world-list-${tag}-dark`);
	await applyTheme(page, 'light');

	if (mobile) {
		console.log('[(g) スマホ: 一覧 → 詳細 → 戻る]');
		await rowOf(page, '大戦').locator('.open').click();
		await detail.waitFor();
		check('詳細が全画面', Math.abs((await detail.boundingBox()).width - vw) < 2);
		check('URL に #<id> が付く', /#[0-9a-f-]{8,}/.test(page.url()), page.url());
		check('一覧は隠れている', !(await page.locator('[data-testid="world-list"]').isVisible()));
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="world-list"]').waitFor({ state: 'visible' });
		check('戻るボタンで一覧に戻り、hash が消える', !page.url().includes('#'), page.url());
		await rowOf(page, '大戦').locator('.open').click();
		await detail.waitFor();
		await page.goBack();
		await page.locator('[data-testid="world-list"]').waitFor({ state: 'visible' });
		check('ブラウザの戻る(Android の戻る)で一覧に戻る', (await detail.count()) === 0);
		await rowOf(page, '大戦').locator('.open').click();
		await detail.waitFor();
		await page.reload();
		await detail.getByText('百年前の戦い。').waitFor({ timeout: 30_000 });
		check('リロードで選択中の資料が復元される', true);
	}

	await context.close();
}

async function readOnlyScenario(browser, vite, { name, mobile }) {
	console.log(`\n=== 閲覧専用 (${name}) ===`);
	const context = await browser.newContext(contextOptions(mobile));
	const page = await context.newPage();
	page.__base = vite.base;
	page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
	const pid = await seed(page, { title: `E2E 閲覧専用 設定資料 ${name}`, viewer: true });
	await openList(page, pid);
	check('(h) 並べ替えのハンドルが出ない', (await page.locator('.handle').count()) === 0);
	check(
		'(h) 移動ボタンも出ない',
		(await page.getByRole('button', { name: /を(上|下)へ$/ }).count()) === 0
	);
	check(
		'(h) 操作メニューが出ない',
		(await page.getByRole('button', { name: /の操作$/ }).count()) === 0
	);
	check('(h) 新規作成のボタンが出ない', (await page.getByTestId('world-new').count()) === 0);
	check('(h) 分類のチップは使える', (await page.locator('.chip').count()) === 5);
	await rowOf(page, '魔法').locator('.open').focus();
	await page.keyboard.press('ArrowDown');
	check(
		'(h) キーボードでも並べ替わらない',
		(await groupTitles(page, 'term')).join() === '魔法,契約'
	);
	await rowOf(page, '魔法').locator('.open').click();
	const detail = page.locator('.detail-pane');
	await detail.waitFor();
	check('(h) 閲覧専用でも全文が読める', await detail.getByText('第14行').isVisible());
	check(
		'(h) 編集・削除ボタンが出ない',
		(await detail.getByRole('button', { name: '編集' }).count()) === 0 &&
			(await detail.getByRole('button', { name: '削除' }).count()) === 0
	);
	await detail.getByRole('button', { name: 'タグ 基礎 で絞り込む' }).click();
	await waitFor('絞り込み', async () => (await rowTitles(page)).join() === '魔法');
	check('(h) 閲覧専用でもタグで絞り込める', true);
	await shot(page, `world-readonly-${mobile ? 'mobile' : 'desktop'}-light`);
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
