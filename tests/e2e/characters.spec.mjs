// 人物のページ(一覧/詳細、関係、並べ替え、相関図)の E2E。
// `bun run test:e2e:characters` から実行する(Firebase / エミュレータ不要)。
// デスクトップとスマホ(iPhone 系)で、全文表示・行の寸法(スマホの余白と押せる大きさ)・ドラッグとキーボードでの
// 並べ替え(リロード後も保持)・関係のリンク・一覧→詳細→戻る・閲覧専用・相関図への切り替えを確かめる。
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

const LONG_NAME = '非常に長い名前を持つ人物のサンプルとしての名前その二その三その四';

/** 作品を作り、人物を順に入れる(作成順 = 並び順)。関係は全員を作ってから付ける */
async function seed(page, { title, viewer = false }) {
	await page.goto(`${page.__base}/home`);
	const pid = await seedProject(page, { title });
	await page.evaluate(
		async ({ pid, longName, long }) => {
			const { charactersDB } = await import('/src/lib/db/index.ts');
			const make = async (name, role, extra = {}) => {
				const c = await charactersDB.create({ projectId: pid, name, role });
				await charactersDB.update(c.id, extra);
				return c;
			};
			const akira = await make('アキラ', '主人公', {
				age: 17,
				gender: '男性',
				appearance: '黒髪で細身。',
				personality: long,
				background: '孤児院で育った。'
			});
			const yuki = await make('ユキ', 'ヒロイン', { personality: '穏やか' });
			const kei = await make('ケイ', '悪役', { appearance: '長身で眼鏡。' });
			await make(longName, '脇役');
			await charactersDB.update(akira.id, {
				relationships: [
					{ characterId: yuki.id, relation: '幼なじみ' },
					{ characterId: kei.id, relation: 'ライバル' }
				]
			});
		},
		{ pid, longName: LONG_NAME, long: LONG }
	);
	if (viewer) await makeViewer(page, pid);
	return pid;
}

const rowOf = (page, name) => page.locator('[data-testid="character-row"]', { hasText: name });
const handleOf = (page, name) => page.getByRole('button', { name: `${name}を並べ替え` });
const rowTitles = (page) =>
	page.$$eval('[data-testid="character-row"] .title', (els) =>
		els.map((e) => e.textContent.trim())
	);
const dbRows = (page, pid) =>
	page.evaluate(async (pid) => {
		const { charactersDB } = await import('/src/lib/db/index.ts');
		return (await charactersDB.getByProjectId(pid)).map((c) => ({
			id: c.id,
			name: c.name,
			role: c.role,
			order: c.order,
			updatedAt: c.updatedAt,
			relationships: c.relationships
		}));
	}, pid);

async function openList(page, pid) {
	await page.goto(`${page.__base}/project/${pid}/characters`);
	await page.locator('[data-testid="character-list"]').waitFor({ timeout: 30_000 });
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

	const pid = await seed(page, { title: `E2E 人物 ${name}` });
	await openList(page, pid);
	const detail = page.locator('.detail-pane');

	console.log('[一覧]');
	check('<select> を使っていない', (await page.locator('select').count()) === 0);
	check(
		'人物が手動順(作成順)に並ぶ',
		(await rowTitles(page)).join() === `アキラ,ユキ,ケイ,${LONG_NAME}`,
		(await rowTitles(page)).join()
	);
	if (mobile) {
		check('スマホでは詳細は閉じている', (await detail.count()) === 0);
	} else {
		check(
			'広い画面で何も選んでいないとき、案内が出る',
			await page.getByText('人物を選んでください').isVisible()
		);
	}
	await shot(page, `characters-list-${tag}-light`);

	console.log('[(b) 行の寸法: アバター・余白・押せる大きさ]');
	const rows = await page.$$eval('[data-testid="character-row"]', (els) =>
		els.map((r) => {
			const rect = r.getBoundingClientRect();
			const avatar = r.querySelector('[data-shape]');
			const a = avatar.getBoundingClientRect();
			const open = r.querySelector('.open').getBoundingClientRect();
			const buttons = [...r.querySelectorAll('button')].map((b) => {
				const x = b.getBoundingClientRect();
				return { w: x.width, h: x.height, right: x.right };
			});
			const title = r.querySelector('.title');
			return {
				left: rect.left,
				right: rect.right,
				height: rect.height,
				avatarLeft: a.left,
				aw: a.width,
				ah: a.height,
				radius: getComputedStyle(avatar).borderRadius,
				shrink: getComputedStyle(avatar).flexShrink,
				ratio: getComputedStyle(avatar).aspectRatio,
				openH: open.height,
				buttons,
				lastRight: Math.max(...buttons.map((b) => b.right)),
				ellipsis: getComputedStyle(title).textOverflow,
				clipped: title.scrollWidth > title.clientWidth,
				text: title.textContent.trim()
			};
		})
	);
	check(
		'アバターは正円(幅 == 高さ == 44px、角丸 50%)',
		rows.every((r) => r.aw === 44 && r.ah === 44 && r.radius === '50%'),
		JSON.stringify([rows[0].aw, rows[0].ah, rows[0].radius])
	);
	check(
		'アバターは縮まない(flex-shrink: 0、aspect-ratio: 1)',
		rows.every((r) => r.shrink === '0' && r.ratio === '1 / 1'),
		`${rows[0].shrink} ${rows[0].ratio}`
	);
	check(
		'行がページ幅に収まる',
		rows.every((r) => r.left >= 0 && r.right <= vw + 0.5)
	);
	check(
		'行の高さが 44px 以上',
		rows.every((r) => r.height >= 44 && r.openH >= 44)
	);
	check(
		'名前は 1 行で省略される(text-overflow: ellipsis、長い名前は切れる)',
		rows.every((r) => r.ellipsis === 'ellipsis') && rows.find((r) => r.text === LONG_NAME).clipped
	);
	check(
		'長い名前でもメニューとハンドルが行の中に残る',
		rows.every((r) => r.lastRight <= r.right && r.buttons.length === 3)
	);
	if (mobile) {
		check(
			'スマホ: アバターの左に 16px 以上の余白',
			rows.every((r) => r.avatarLeft >= 16),
			String(rows[0].avatarLeft)
		);
		check(
			'スマホ: 右端の操作の右に 16px 以上の余白',
			rows.every((r) => vw - r.lastRight >= 16),
			String(vw - rows[0].lastRight)
		);
		check(
			'スマホ: メニューとハンドルのタップ領域が 44px 以上',
			rows.every((r) => r.buttons.slice(1).every((b) => b.w >= 44 && b.h >= 44)),
			JSON.stringify(rows[0].buttons)
		);
	}
	const of0 = await overflowOf(page, '.chars-page');
	check('横にはみ出さない', noOverflow(of0), JSON.stringify(of0));

	console.log('[(a) 全文を、編集を押さずに読める]');
	await rowOf(page, 'アキラ').locator('.open').click();
	await detail.waitFor();
	await detail.getByText('第14行').waitFor();
	check('最後の行まで表示される', await detail.getByText('第14行').isVisible());
	check('編集フォームは出ていない', (await detail.locator('textarea, input').count()) === 0);
	check('「編集」ボタンがある', await detail.getByRole('button', { name: '編集' }).isVisible());
	for (const section of ['外見', '性格', '背景', '関係']) {
		check(
			`「${section}」の節がある`,
			await detail.getByRole('heading', { name: section }).isVisible()
		);
	}
	check('背景の全文が見える', await detail.getByText('孤児院で育った。').isVisible());
	check(
		'要約(役割・年齢・性別)が出る',
		await detail.getByText('主人公 ・ 17歳 ・ 男性').isVisible()
	);
	const body = detail.locator('.body').first();
	check(
		'本文は改行を保ち、選択できる',
		(await body.evaluate((e) => getComputedStyle(e).whiteSpace)) === 'pre-wrap' &&
			(await body.evaluate((e) => getComputedStyle(e).userSelect)) === 'text'
	);
	const avatar = await detail.locator('[data-shape]').first().boundingBox();
	check(
		'詳細のアバターも正円(56px)',
		Math.abs(avatar.width - 56) < 0.5 && Math.abs(avatar.height - 56) < 0.5,
		JSON.stringify(avatar)
	);
	check(
		'一覧では選択中の行が示される',
		(await page.locator('.item-row.selected').count()) === (mobile ? 1 : 1)
	);
	await shot(page, `characters-detail-${tag}-light`);
	const of1 = await overflowOf(page, '.chars-page');
	check('詳細を開いても横にはみ出さない', noOverflow(of1), JSON.stringify(of1));

	console.log('[(f) 関係のリンクで別の人物の詳細へ]');
	const rels = detail.getByTestId('relations');
	check(
		'関係は「関係名 → 相手」で全て出る',
		(await rels.locator('li').count()) === 2 &&
			(await rels.getByText('幼なじみ').isVisible()) &&
			(await rels.getByText('ライバル').isVisible())
	);
	const link = detail.getByTestId('relation-link').first();
	const linkBox = await link.boundingBox();
	check('関係のリンクのタップ領域が 40px 以上', linkBox.height >= 40, String(linkBox.height));
	await link.click();
	await detail.locator('h2', { hasText: 'ユキ' }).waitFor();
	check('リンクを押すと、その人物の詳細へ移る', true);
	check('ユキの詳細に性格の全文が出る', await detail.getByText('穏やか').isVisible());

	if (mobile) {
		console.log('[(g) スマホ: 一覧 → 詳細 → 戻る]');
		check(
			'詳細が全画面',
			Math.abs((await detail.boundingBox()).width - vw) < 2 &&
				!(await rowOf(page, 'ケイ').isVisible())
		);
		check('URL に #<id> が付く', /#[0-9a-f-]{8,}/.test(page.url()), page.url());
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await detail.locator('h2', { hasText: 'アキラ' }).waitFor();
		check('関係リンクで移った後の「戻る」は直前の人物へ戻る', true);
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="character-list"]').waitFor({ state: 'visible' });
		check('もう一度戻ると一覧になり、hash が消える', !page.url().includes('#'), page.url());
		await rowOf(page, 'ユキ').locator('.open').click();
		await detail.waitFor();
		await page.goBack();
		await page.locator('[data-testid="character-list"]').waitFor({ state: 'visible' });
		check('ブラウザの戻る(Android の戻る)で一覧に戻る', (await detail.count()) === 0);
		await rowOf(page, 'ユキ').locator('.open').click();
		await detail.waitFor();
		await page.reload();
		await detail.getByText('穏やか').waitFor({ timeout: 30_000 });
		check('リロードで選択中の人物が復元される', true);
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="character-list"]').waitFor({ state: 'visible' });
	} else {
		check(
			'広い画面では一覧と詳細が並ぶ',
			(await rowOf(page, 'ケイ').isVisible()) && (await detail.isVisible())
		);
		check(
			'選択中の行がユキに移る',
			await rowOf(page, 'ユキ').evaluate((e) => e.classList.contains('selected'))
		);
	}

	console.log('[編集 → 保存(関係の追加・削除)/ 未保存の確認]');
	await rowOf(page, 'ユキ').locator('.open').click();
	await detail.locator('h2', { hasText: 'ユキ' }).waitFor();
	await detail.getByRole('button', { name: '編集' }).click();
	await page.locator('#char-name').waitFor();
	check('同じ場所が編集フォームに切り替わる', await page.locator('#char-appearance').isVisible());
	check('<select> を使っていない(編集中)', (await page.locator('select').count()) === 0);
	await page.locator('#char-role').fill('ヒロイン(改)');
	await detail.getByRole('button', { name: '関係を追加' }).click();
	const relRow = page.getByTestId('relation-row').last();
	await relRow.getByRole('combobox', { name: '関係の相手' }).click();
	await page.getByRole('option', { name: 'アキラ' }).click();
	await relRow.getByRole('textbox', { name: '関係の名前' }).fill('想い人');
	await shot(page, `characters-edit-${tag}-light`);
	// 未保存で別の人物へ
	if (mobile) await page.getByRole('button', { name: '一覧に戻る' }).click();
	else await rowOf(page, 'ケイ').locator('.open').click();
	const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
	await dialog.waitFor({ timeout: 5000 });
	check(
		'未保存の変更があると、移る前に確認が出る',
		await dialog.getByText('保存していない変更').isVisible()
	);
	await dialog.getByRole('button', { name: /キャンセル|いいえ/ }).click();
	check(
		'キャンセルすると編集が残る',
		(await page.locator('#char-role').inputValue()) === 'ヒロイン(改)'
	);
	await detail.getByRole('button', { name: '保存' }).click();
	await detail.getByTestId('relations').waitFor();
	check('保存すると閲覧ビューに戻り、関係が出る', await detail.getByText('想い人').isVisible());
	check(
		'関係の相手はアキラへのリンク',
		(await detail.getByTestId('relation-link').first().innerText()).includes('アキラ')
	);
	await waitFor(
		'保存',
		async () => (await dbRows(page, pid)).find((r) => r.name === 'ユキ').relationships.length === 1
	);
	check(
		'一覧の要約も更新される',
		(await rowOf(page, 'ユキ').textContent()).includes('ヒロイン(改)')
	);
	// 関係の削除
	await detail.getByRole('button', { name: '編集' }).click();
	await page.getByRole('button', { name: 'この関係を削除' }).click();
	await detail.getByRole('button', { name: '保存' }).click();
	await detail.locator('h2', { hasText: 'ユキ' }).waitFor();
	await waitFor(
		'関係の削除',
		async () => (await dbRows(page, pid)).find((r) => r.name === 'ユキ').relationships.length === 0
	);
	check('関係を削除して保存できる', (await detail.getByTestId('relations').count()) === 0);
	await detail.getByRole('button', { name: '編集' }).click();
	await page.locator('#char-role').fill('ヒロイン');
	await detail.getByRole('button', { name: '保存' }).click();
	await detail.locator('h2', { hasText: 'ユキ' }).waitFor();
	if (mobile) await page.getByRole('button', { name: '一覧に戻る' }).click();
	else await detail.getByRole('button', { name: '詳細を閉じる' }).count();

	console.log('[検索と並び]');
	if (!mobile) {
		// 広い画面は詳細が開いたまま。一覧だけを操作する
	}
	const search = page.getByRole('searchbox', { name: '人物を検索' });
	await search.fill('眼鏡');
	await sleep(200);
	check(
		'本文(外見)でも検索できる',
		(await rowTitles(page)).join() === 'ケイ',
		(await rowTitles(page)).join()
	);
	check('検索中は並べ替えのハンドルが出ない', (await page.locator('.handle').count()) === 0);
	check(
		'並べ替えできない理由を案内する',
		await page.getByText('並べ替えは、検索を外して').isVisible()
	);
	await search.fill('該当なし');
	await sleep(200);
	check('一致しないときの案内が出る', await page.getByText('条件に合う人物がいません').isVisible());
	await page.getByRole('button', { name: '検索を外す' }).click();
	await sleep(200);
	check('検索を外すと全員が戻り、ハンドルも戻る', (await page.locator('.handle').count()) === 4);
	await page.getByRole('combobox', { name: '並び順' }).click();
	await page.getByRole('option', { name: '名前順' }).click();
	await sleep(200);
	check(
		'名前順に並ぶ(五十音)',
		(await rowTitles(page)).join() ===
			['アキラ', 'ケイ', 'ユキ', LONG_NAME].sort((a, b) => a.localeCompare(b, 'ja')).join(),
		(await rowTitles(page)).join()
	);
	check('名前順ではハンドルが出ない', (await page.locator('.handle').count()) === 0);
	await page.getByRole('combobox', { name: '並び順' }).click();
	await page.getByRole('option', { name: '手動順' }).click();
	await sleep(200);
	check('手動順に戻すとハンドルが出る', (await page.locator('.handle').count()) === 4);

	console.log('[(c) ドラッグで並べ替え → リロード後も保持]');
	// 一覧が見える状態にする(スマホは一覧に戻っている)
	await page.locator('[data-testid="character-list"]').waitFor({ state: 'visible' });
	const before = await dbRows(page, pid);
	const src = await box(handleOf(page, LONG_NAME));
	const dstRow = await box(rowOf(page, 'アキラ'));
	await dragPath(page, mobile ? 'touch' : 'mouse', { x: src.cx, y: src.cy }, [
		{ to: { x: dstRow.cx, y: dstRow.y + 6 } }
	]);
	await waitFor('ドラッグ後の並び', async () => (await rowTitles(page))[0] === LONG_NAME);
	check('ドラッグで先頭へ移る', (await rowTitles(page)).join() === `${LONG_NAME},アキラ,ユキ,ケイ`);
	await waitFor('保存', async () => (await dbRows(page, pid))[0].name === LONG_NAME);
	const after = await dbRows(page, pid);
	const changed = after.filter((a) => a.updatedAt !== before.find((b) => b.id === a.id).updatedAt);
	check(
		'書き換わった行は 1 件だけ',
		changed.length === 1 && changed[0].name === LONG_NAME,
		changed.map((c) => c.name).join()
	);
	await page.reload();
	await page.locator('[data-testid="character-list"]').waitFor({ timeout: 30_000 });
	await sleep(300);
	check(
		'リロード後も順序が保たれる',
		(await rowTitles(page)).join() === `${LONG_NAME},アキラ,ユキ,ケイ`,
		(await rowTitles(page)).join()
	);

	console.log('[キーボードで並べ替え / メニューの上へ・下へ]');
	const kb = handleOf(page, LONG_NAME);
	await kb.focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	const live = await page.locator('[data-testid="character-list"] [role="status"]').innerText();
	check('移動を aria-live で通知する', /3 番目に移動しました/.test(live), live);
	await page.keyboard.press('Space');
	await waitFor('キーボード後の並び', async () => (await rowTitles(page))[2] === LONG_NAME);
	check(
		'Space / ↓↓ / Space で 3 番目へ移る',
		(await rowTitles(page)).join() === `アキラ,ユキ,${LONG_NAME},ケイ`
	);
	await waitFor('保存', async () => (await dbRows(page, pid))[2].name === LONG_NAME);
	await page.reload();
	await page.locator('[data-testid="character-list"]').waitFor({ timeout: 30_000 });
	await sleep(300);
	check(
		'キーボードでの並べ替えもリロード後に保たれる',
		(await rowTitles(page)).join() === `アキラ,ユキ,${LONG_NAME},ケイ`
	);
	await handleOf(page, 'アキラ').focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Escape');
	check('Escape で取り消せる', (await rowTitles(page))[0] === 'アキラ');
	await page.getByRole('button', { name: 'ケイの操作' }).click();
	await page.getByRole('button', { name: '上へ' }).click();
	await waitFor('上へ', async () => (await rowTitles(page))[2] === 'ケイ');
	check('メニューの「上へ」で 1 つ上がる', true);

	console.log('[新規作成]');
	await page.getByTestId('character-new').click();
	await page.locator('#char-name').waitFor();
	check(
		'新規作成は編集フォームで始まる',
		await page.locator('.detail-pane #char-personality').isVisible()
	);
	await page.locator('#char-name').fill('ミナト');
	await page.locator('#char-role').fill('相棒');
	await page.locator('#char-age').fill('25');
	await page.locator('#char-background').fill('港町の出身。\n二行目。');
	await page.getByRole('button', { name: '作成' }).click();
	await detail.locator('h2', { hasText: 'ミナト' }).waitFor();
	check('作成後は閲覧ビューで全文が見える', await detail.getByText('二行目。').isVisible());
	check('一覧の末尾に追加される', (await rowTitles(page)).at(-1) === 'ミナト');
	check('要約に年齢が出る', await detail.getByText('相棒 ・ 25歳').isVisible());

	console.log('[ダーク]');
	await applyTheme(page, 'dark');
	await shot(page, `characters-detail-${tag}-dark`);
	if (mobile) {
		await page.getByRole('button', { name: '一覧に戻る' }).click();
		await page.locator('[data-testid="character-list"]').waitFor({ state: 'visible' });
	}
	await sleep(200);
	await shot(page, `characters-list-${tag}-dark`);
	await applyTheme(page, 'light');

	console.log('[(i) 相関図ビュー]');
	const graphBtn = page.locator('[data-tour="characters-graph-button"]');
	await graphBtn.click();
	await page.locator('[data-tour="relation-canvas"]').waitFor({ timeout: 30_000 });
	await page.locator('.svelte-flow__node').first().waitFor();
	await sleep(600);
	const nodes = await page.locator('.svelte-flow__node-character').count();
	check('相関図に人物のノードが出る', nodes === 5, String(nodes));
	const canvas = await page.locator('[data-tour="relation-canvas"]').boundingBox();
	check(
		'キャンバスが画面に収まり、十分な大きさ',
		canvas.x >= 0 && canvas.x + canvas.width <= vw + 0.5 && canvas.height >= 300,
		JSON.stringify(canvas)
	);
	const of2 = await overflowOf(page, '.chars-page');
	check('相関図でも横にはみ出さない', noOverflow(of2), JSON.stringify(of2));
	check(
		'相関図のとき「相関図」が押されている',
		(await graphBtn.getAttribute('aria-pressed')) === 'true'
	);
	await shot(page, `characters-graph-${tag}-light`);
	await page.locator('.svelte-flow__node-character', { hasText: 'ユキ' }).first().click();
	await detail.locator('h2', { hasText: 'ユキ' }).waitFor({ timeout: 10_000 });
	check('相関図の人物を押すと、一覧に戻ってその人物の詳細が開く', true);
	if (!mobile) {
		check(
			'一覧のボタンが押された状態に戻る',
			(await page
				.getByRole('button', { name: '一覧', exact: true })
				.getAttribute('aria-pressed')) === 'true'
		);
	}

	await context.close();
}

async function readOnlyScenario(browser, vite, { name, mobile }) {
	console.log(`\n=== 閲覧専用 (${name}) ===`);
	const context = await browser.newContext(contextOptions(mobile));
	const page = await context.newPage();
	page.__base = vite.base;
	page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
	const pid = await seed(page, { title: `E2E 閲覧専用 人物 ${name}`, viewer: true });
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
	check('(h) 新規作成のボタンが出ない', (await page.getByTestId('character-new').count()) === 0);
	await rowOf(page, 'アキラ').locator('.open').focus();
	await page.keyboard.press('ArrowDown');
	check('(h) キーボードでも並べ替わらない', (await rowTitles(page))[0] === 'アキラ');
	await rowOf(page, 'アキラ').locator('.open').click();
	const detail = page.locator('.detail-pane');
	await detail.waitFor();
	check('(h) 閲覧専用でも全文が読める', await detail.getByText('第14行').isVisible());
	check(
		'(h) 編集・削除ボタンが出ない',
		(await detail.getByRole('button', { name: '編集' }).count()) === 0 &&
			(await detail.getByRole('button', { name: '削除' }).count()) === 0
	);
	await detail.getByTestId('relation-link').first().click();
	await detail.locator('h2', { hasText: 'ユキ' }).waitFor();
	check('(h) 閲覧専用でも関係のリンクで移れる', true);
	await shot(page, `characters-readonly-${mobile ? 'mobile' : 'desktop'}-light`);
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
