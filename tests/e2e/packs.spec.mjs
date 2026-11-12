// 拡張機能(パック): 拡張機能を探す・インストール・同意・ファイル追加・テーマ・校正・出所のラベルの E2E。
// `bun run test:e2e:packs` から実行する(Firebase / エミュレータ不要)。
// レジストリ(https://storift.shiki-01.com/extensions-registry/)は、リポジトリの extensions/ から作った一覧を
// ルートのモックで返す。本番へは一切アクセスしない。E2E_SHOT_DIR を指定すると、実画面を保存する。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	EDITOR,
	ROOT,
	check,
	chromium,
	finish,
	seedProject,
	shot,
	shotEl,
	applyTheme,
	installTauriMock,
	sleep,
	startVite
} from './helpers.mjs';

const ORIGIN = 'https://storift.shiki-01.com';
const PREFIX = '/extensions-registry/';

function buildRegistry() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storift-registry-'));
	const r = spawnSync('bun', ['scripts/build-registry.ts', dir], { cwd: ROOT, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`レジストリを生成できません:\n${r.stdout}\n${r.stderr}`);
	return dir;
}

/** レジストリのモック。mode: ok / offline / tampered */
async function mockRegistry(context, dir, state) {
	await context.route(`${ORIGIN}${PREFIX}**`, (route) => {
		const url = new URL(route.request().url());
		state.requests.push(url.pathname);
		if (state.mode === 'offline') return route.abort('internetdisconnected');
		const file = path.join(dir, url.pathname.slice(PREFIX.length));
		if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
		let body = fs.readFileSync(file, 'utf8');
		if (state.mode === 'tampered' && file.endsWith('.storiftext.json')) {
			body = body.replace(/\n$/, ' \n');
		}
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'access-control-allow-origin': '*' },
			body
		});
	});
}

/** 画面の動き(モーダルの出入り)が落ち着いてから撮る */
async function snap(page, name, fullPage = false) {
	await sleep(600);
	await shot(page, name, { fullPage });
}

const CARD = (id) => `[data-testid="ext-card-${id}"]`;

async function openBrowser(page) {
	await page.getByTestId('open-pack-browser').click();
	await page.getByTestId('pack-browser').waitFor({ timeout: 10_000 });
}

async function install(page, id) {
	await page.getByTestId(`pack-row-${id}`).click();
	await page.getByTestId('pack-detail').waitFor({ timeout: 5_000 });
	await page.getByTestId('pack-install').click();
	await page.getByTestId('consent-confirm').waitFor({ timeout: 15_000 });
}

async function main() {
	const registryDir = buildRegistry();
	const vite = await startVite();
	const browser = await chromium.launch();
	const state = { mode: 'ok', requests: [] };
	try {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		await mockRegistry(context, registryDir, state);
		const page = await context.newPage();
		page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
		const base = vite.base;
		await page.goto(`${base}/home`);
		const pid = await seedProject(page, { title: 'E2E パック', content: 'お願い下さい。' });

		console.log('[起動時には取得しない]');
		await page.goto(`${base}/settings#extensions`);
		await page.locator(CARD('monolog')).waitFor({ timeout: 30_000 });
		await sleep(800);
		check(
			'設定を開いただけでは、レジストリへアクセスしない',
			state.requests.length === 0,
			state.requests.join(',')
		);
		await snap(page, 'phase2-settings-desktop-light', true);

		console.log('[オフライン]');
		state.mode = 'offline';
		await openBrowser(page);
		await page.getByTestId('registry-error').waitFor({ timeout: 10_000 });
		const offlineText = await page.getByTestId('registry-error').innerText();
		check(
			'オフラインの表示が出て、すでに入れたものは使えると案内する',
			/オフライン/.test(offlineText)
		);
		check('オフラインでも設定画面は壊れない', (await page.locator(CARD('monolog')).count()) === 1);
		await snap(page, 'phase2-browser-offline');
		state.mode = 'ok';
		await page.getByRole('button', { name: '再試行' }).click();

		console.log('[一覧・検索・絞り込み]');
		await page.getByTestId('pack-row-common-notation').waitFor({ timeout: 10_000 });
		check('一覧を開いたときに取得する', state.requests.includes(`${PREFIX}index.json`));
		const rows = await page.locator('[data-testid^="pack-row-"]').count();
		check('公式 2 件とコミュニティ 3 件が並ぶ', rows === 5, String(rows));
		const rowText = await page.getByTestId('pack-row-common-notation').innerText();
		check('コミュニティのラベルが出る', rowText.includes('コミュニティ'));
		check(
			'公式のラベルも出る',
			(await page.getByTestId('pack-row-monolog').innerText()).includes('公式')
		);
		await snap(page, 'phase2-browser-list-desktop-light');
		await page.getByTestId('pack-search').fill('表記ゆれ');
		check('検索で絞り込める', (await page.locator('[data-testid^="pack-row-"]').count()) === 1);
		await page.getByTestId('pack-search').fill('');
		await page.getByRole('combobox', { name: '種類で絞り込み' }).click();
		await page.getByRole('option', { name: '公式' }).click();
		check('種類で絞り込める', (await page.locator('[data-testid^="pack-row-"]').count()) === 2);
		await page.getByRole('combobox', { name: '種類で絞り込み' }).click();
		await page.getByRole('option', { name: 'すべての種類' }).click();
		await page.getByRole('combobox', { name: '出所で絞り込み' }).click();
		await page.getByRole('option', { name: 'コミュニティ' }).click();
		check('出所で絞り込める', (await page.locator('[data-testid^="pack-row-"]').count()) === 3);

		console.log('[詳細とインストール]');
		await page.getByTestId('pack-row-common-notation').click();
		const detail = await page.getByTestId('pack-detail').innerText();
		check(
			'詳細に作者・ライセンス・版・サイズ・出所・権限・プライバシーが出る',
			[
				'shiki-01',
				'MIT',
				'1.0.0',
				'KB',
				'コミュニティ',
				'通信しません',
				'外部へは何も送りません'
			].every((t) => detail.includes(t)),
			detail.slice(0, 80)
		);
		await snap(page, 'phase2-browser-detail-desktop-light');
		await page.getByTestId('pack-install').click();
		await page.getByTestId('consent-confirm').waitFor({ timeout: 15_000 });
		const consent = await page
			.getByRole('region', { name: 'この拡張が扱う情報' })
			.getByTestId('origin-note')
			.innerText();
		check(
			'同意画面に出所と注意が出る',
			consent.includes('コミュニティ') && consent.includes('保証されません')
		);
		await snap(page, 'phase2-consent-desktop-light');
		check(
			'同意するまでは有効にならない',
			(await page
				.locator(CARD('common-notation'))
				.locator('[role="switch"]')
				.getAttribute('aria-checked')) === 'false'
		);
		await page.getByTestId('consent-confirm').click();
		await sleep(500);
		const card = page.locator(CARD('common-notation'));
		check(
			'同意すると有効になる',
			(await card.locator('[role="switch"]').getAttribute('aria-checked')) === 'true'
		);
		check(
			'カードに「パック」と「コミュニティ」が出る',
			(await card.innerText()).includes('パック') &&
				(await card.innerText()).includes('コミュニティ')
		);
		await sleep(600);
		await shotEl(page.getByTestId('installed-packs'), 'phase2-installed-desktop-light');
		const stored = await page.evaluate(async () => {
			const dbs = await indexedDB.databases();
			return dbs.map((d) => d.name);
		});
		check(
			'別のデータベース storift-extensions に保存される',
			stored.includes('storift-extensions')
		);

		console.log('[改ざんの検出]');
		state.mode = 'tampered';
		await openBrowser(page);
		await page.getByTestId('pack-row-dialogue-keys').click();
		await page.getByTestId('pack-install').click();
		await sleep(1200);
		check(
			'ハッシュが合わないバンドルはインストールされない',
			(await page.locator(CARD('dialogue-keys')).count()) === 0
		);
		state.mode = 'ok';
		await page.keyboard.press('Escape');

		console.log('[ファイルから追加]');
		const bundleFile = path.join(registryDir, 'dialogue-keys', '1.0.0.storiftext.json');
		await page.getByTestId('pack-file-input').setInputFiles(bundleFile);
		await page.getByTestId('consent-confirm').waitFor({ timeout: 10_000 });
		const fileConsent = await page
			.getByRole('region', { name: 'この拡張が扱う情報' })
			.getByTestId('origin-note')
			.innerText();
		check(
			'ファイル追加の同意画面に「個人追加(未審査)」が出る',
			fileConsent.includes('個人追加(未審査)')
		);
		await page.getByTestId('consent-confirm').click();
		await sleep(400);
		const fileCard = page.locator(CARD('dialogue-keys'));
		check('個人追加のラベル', (await fileCard.innerText()).includes('個人追加(未審査)'));
		await sleep(600);
		await shotEl(page.getByTestId('installed-packs'), 'phase2-file-added-desktop-light');
		const bad = path.join(os.tmpdir(), `bad-${Date.now()}.storiftext.json`);
		fs.writeFileSync(
			bad,
			JSON.stringify({
				format: 'storift-extension-bundle',
				bundleVersion: 1,
				manifest: { id: 'x' },
				files: {}
			})
		);
		await page.getByTestId('pack-file-input').setInputFiles(bad);
		await page.getByText('追加できません').first().waitFor({ timeout: 10_000 });
		check('不正なファイルは検証で拒否される', true);

		console.log('[校正への反映(スマホ)]');
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${base}/project/${pid}/editor`);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await sleep(1200);
		await page.getByRole('button', { name: 'その他の操作' }).click();
		await page.getByRole('dialog', { name: '操作' }).getByRole('button', { name: '校正' }).click();
		await page.getByText('「下さい」は「ください」と書きます').first().waitFor({ timeout: 10_000 });
		check('有効なパックの辞書が、校正の指摘に出る', true);
		await snap(page, 'phase2-proofread-mobile-light');

		console.log('[テーマのパック]');
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(`${base}/settings#extensions`);
		await page.locator(CARD('monolog')).waitFor({ timeout: 30_000 });
		await openBrowser(page);
		await install(page, 'wakakusa-themes');
		await page.getByTestId('consent-confirm').click();
		await sleep(500);
		await page.goto(`${base}/settings#appearance`);
		const wakakusa = page.getByRole('radio', { name: /若草/ });
		await wakakusa.waitFor({ timeout: 15_000 });
		check(
			'外観にパックのテーマが「パック」付きで並ぶ',
			(await wakakusa.innerText()).includes('パック')
		);
		if (await page.locator('#autoTheme').isChecked()) await page.locator('#autoTheme').click();
		await sleep(300);
		await wakakusa.click();
		await sleep(500);
		const bg = () =>
			page.evaluate(() =>
				getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim()
			);
		check('パックのテーマが適用される', (await bg()) === '#f3f6ec', await bg());
		await page.reload();
		await page.getByRole('radio', { name: /若草/ }).waitFor({ timeout: 15_000 });
		await sleep(800);
		check('再読み込みしても保たれる', (await bg()) === '#f3f6ec', await bg());
		check(
			'パックのテーマの ID は、同期・バックアップ対象の設定には書かれない',
			await page.evaluate(async () => {
				const { settingsDB } = await import('/src/lib/db/index.ts');
				return !String((await settingsDB.get()).theme).startsWith('pack:');
			})
		);
		await snap(page, 'phase2-theme-pack-desktop-light');
		await page.getByRole('radio', { name: /深海/ }).click();
		await sleep(400);
		await snap(page, 'phase2-theme-pack-desktop-dark');

		console.log('[無効化・アンインストール]');
		await page.goto(`${base}/settings#extensions`);
		const themeCard = page.locator(CARD('wakakusa-themes'));
		await themeCard.waitFor({ timeout: 30_000 });
		await themeCard.locator('[role="switch"]').click();
		await sleep(600);
		check('テーマのパックを無効にすると、ライトに戻る', (await bg()) === '#f6f4ef', await bg());
		await themeCard.getByTestId('ext-uninstall-wakakusa-themes').click();
		await page.getByRole('button', { name: 'アンインストール' }).last().click();
		await sleep(600);
		check(
			'アンインストールするとカードが消える',
			(await page.locator(CARD('wakakusa-themes')).count()) === 0
		);

		console.log('[スマホの画面]');
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();
		await page.locator(CARD('monolog')).waitFor({ timeout: 30_000 });
		await snap(page, 'phase2-settings-mobile-light', true);
		await openBrowser(page);
		await page.getByTestId('pack-row-common-notation').waitFor();
		await snap(page, 'phase2-browser-list-mobile-light');
		await page.getByTestId('pack-row-common-notation').click();
		await snap(page, 'phase2-browser-detail-mobile-light');
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
		check('スマホで横にはみ出さない', !overflow);

		console.log('[ダークテーマ]');
		await applyTheme(page, 'dark');
		await snap(page, 'phase2-browser-detail-mobile-dark');
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.reload();
		await page.locator(CARD('monolog')).waitFor({ timeout: 30_000 });
		await openBrowser(page);
		await page.getByTestId('pack-row-common-notation').waitFor();
		await snap(page, 'phase2-browser-list-desktop-dark');
		await page.getByTestId('pack-row-wakakusa-themes').click();
		await snap(page, 'phase2-browser-detail-desktop-dark');
		await page.getByTestId('pack-install').click();
		await page.getByTestId('consent-confirm').waitFor({ timeout: 15_000 });
		await snap(page, 'phase2-consent-desktop-dark');
		await page.getByTestId('consent-confirm').click();
		await sleep(500);
		await shotEl(page.getByTestId('installed-packs'), 'phase2-installed-desktop-dark');

		console.log('[デスクトップ版: 拡張フォルダ]');
		const desktop = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		await desktop.addInitScript(installTauriMock);
		const folderFiles = (dir) => {
			const root = path.join(ROOT, 'extensions', dir);
			const files = {};
			for (const rel of ['manifest.json', 'contents/keys.json']) {
				files[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
			}
			return files;
		};
		await desktop.addInitScript(
			(data) => {
				window.__extFolder = data;
			},
			{
				root: '/home/me/extensions',
				packs: [
					{ dir: 'dialogue-keys', files: folderFiles('dialogue-keys') },
					{
						dir: 'broken-pack',
						files: { 'manifest.json': JSON.stringify({ id: 'other', kind: 'pack' }) }
					},
					{ dir: 'big-pack', files: {}, error: 'big.json が大きすぎます(256KB まで)' }
				]
			}
		);
		const dpage = await desktop.newPage();
		dpage.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
		await dpage.goto(`${base}/settings#extensions`);
		const folderCard = dpage.locator(CARD('dialogue-keys'));
		await folderCard.waitFor({ timeout: 30_000 });
		check('起動時に拡張フォルダのパックが読み込まれる', true);
		check(
			'出所は「個人フォルダ(未審査)」',
			(await folderCard.innerText()).includes('個人フォルダ(未審査)')
		);
		check(
			'読み込んだだけでは有効にならない(同意が要る)',
			(await folderCard.locator('[role="switch"]').getAttribute('aria-checked')) === 'false'
		);
		const errors = await dpage.getByTestId('folder-errors').innerText();
		check(
			'読めなかったフォルダは理由つきで一覧に出る',
			errors.includes('broken-pack') && errors.includes('big-pack') && errors.includes('256KB')
		);
		check(
			'フォルダの読み込みの確認項目がある',
			(await dpage.getByTestId('ext-folder').innerText()).includes('/home/me/extensions')
		);
		await sleep(400);
		await shotEl(dpage.getByTestId('ext-folder'), 'phase2-folder-desktop-light');
		await folderCard.scrollIntoViewIfNeeded();
		await shotEl(dpage.getByTestId('installed-packs'), 'phase2-folder-installed-desktop-light');
		await folderCard.locator('[role="switch"]').click();
		await dpage.getByTestId('consent-confirm').click();
		await sleep(400);
		check(
			'同意すると有効になる',
			(await folderCard.locator('[role="switch"]').getAttribute('aria-checked')) === 'true'
		);
		await desktop.close();
	} finally {
		await browser.close();
		vite.stop();
		fs.rmSync(registryDir, { recursive: true, force: true });
	}
	finish();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
