// デスクトップ版のエディタ画面: 執筆のツールバーと AI パネルのヘッダーの高さが一致することの E2E。
// `bun run test:e2e:ai-header` から実行する(Firebase / エミュレータ不要)。
// vite dev(空きポート)を起動し、プリインストールの Chromium(Playwright)で確かめる。
// Tauri 本体は無いので、`window.__TAURI_INTERNALS__` を最小限のモックで再現して「デスクトップ版」として動かす
// (AI パネルは isDesktop() のときだけ出る)。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDITOR = '[role="textbox"][aria-label="エディタ"]';
const TOOLBAR = '.editor-toolbar';
const PANEL_HEADER = '[data-ai-panel] .panel-header';

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

/** Tauri の呼び出しを最小限に再現する(状態の確認は「見つかった・ログイン済み」を返す) */
function installTauriMock() {
	window.__TAURI_INTERNALS__ = {
		metadata: {
			currentWindow: { label: 'main' },
			currentWebview: { windowLabel: 'main', label: 'main' }
		},
		transformCallback(cb) {
			const id = Math.floor(Math.random() * 1e9);
			window[`_${id}`] = cb;
			return id;
		},
		unregisterCallback() {},
		convertFileSrc: (p) => p,
		async invoke(cmd) {
			switch (cmd) {
				case 'claude_status':
					return { found: true, path: '/mock/claude', version: 'mock 1.0', loggedIn: true };
				case 'workspace_info':
					return { path: '/mock/workspace' };
				case 'plugin:event|listen':
					return 1;
				case 'plugin:window|is_maximized':
				case 'plugin:window|is_fullscreen':
					return false;
				default:
					return null;
			}
		}
	};
}

/** ヘッダーの外枠と、右端のボタンの位置(ヘッダーの上端からの中心) */
const headerMetrics = (page, selector, buttonSelector) =>
	page.locator(selector).evaluate((el, btnSel) => {
		const r = el.getBoundingClientRect();
		const buttons = [...el.querySelectorAll(btnSel)];
		const last = buttons[buttons.length - 1]?.getBoundingClientRect();
		const cs = getComputedStyle(el);
		return {
			top: r.top,
			height: r.height,
			boxSizing: cs.boxSizing,
			buttonCenter: last ? last.top + last.height / 2 - r.top : null,
			buttonHeight: last?.height ?? null,
			cssVar: getComputedStyle(document.documentElement)
				.getPropertyValue('--editor-header-height')
				.trim()
		};
	}, buttonSelector);

async function main() {
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;
	const vite = await startVite(port);
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

		await page.goto(`${base}/home`);
		const pid = await page.evaluate(async () => {
			const { settingsDB, projectsDB, chaptersDB, scenesDB } = await import('/src/lib/db/index.ts');
			await settingsDB.update({ setupCompleted: true, tutorialDismissed: true });
			const project = await projectsDB.create({ title: 'E2E AI ヘッダー' });
			const chapter = await chaptersDB.create({ projectId: project.id, title: '章', synopsis: '' });
			await scenesDB.create({
				chapterId: chapter.id,
				projectId: project.id,
				title: '場面',
				content: '本文です。'
			});
			return project.id;
		});
		await page.goto(`${base}/project/${pid}/editor`);
		await page.locator(EDITOR).waitFor({ timeout: 30_000 });
		await page.locator(TOOLBAR).waitFor({ timeout: 30_000 });

		console.log('[AI パネルを開く]');
		const toggle = page.locator('.tool--ai');
		await toggle.waitFor({ timeout: 30_000 });
		await toggle.click();
		await page.locator(PANEL_HEADER).waitFor({ timeout: 30_000 });
		// パネルが横へ広がる遷移が終わるのを待つ
		await sleep(600);

		const toolbar = await headerMetrics(page, TOOLBAR, '.tool');
		const panel = await headerMetrics(page, PANEL_HEADER, 'button.icon');
		console.log(`  toolbar=${JSON.stringify(toolbar)}`);
		console.log(`  panel  =${JSON.stringify(panel)}`);

		check(
			'共通の CSS 変数 --editor-header-height が定義されている',
			/^\d+(\.\d+)?px$/.test(toolbar.cssVar),
			toolbar.cssVar
		);
		check(
			'執筆のツールバーの高さが CSS 変数どおり',
			toolbar.height === parseFloat(toolbar.cssVar),
			`${toolbar.height} / ${toolbar.cssVar}`
		);
		check(
			'AI パネルのヘッダーの高さが CSS 変数どおり',
			panel.height === parseFloat(toolbar.cssVar)
		);
		check(
			'2 つのヘッダーの高さ(getBoundingClientRect().height)が一致する',
			toolbar.height === panel.height,
			`${toolbar.height} vs ${panel.height}`
		);
		check(
			'2 つのヘッダーの上端が同じ位置',
			toolbar.top === panel.top,
			`${toolbar.top} vs ${panel.top}`
		);
		check(
			'どちらも border-box',
			toolbar.boxSizing === 'border-box' && panel.boxSizing === 'border-box'
		);
		check(
			'ボタンの高さが同じ',
			toolbar.buttonHeight === panel.buttonHeight,
			`${toolbar.buttonHeight} vs ${panel.buttonHeight}`
		);
		check(
			'ボタンの縦位置(ヘッダー上端からの中心)が同じ',
			Math.abs(toolbar.buttonCenter - panel.buttonCenter) < 0.5,
			`${toolbar.buttonCenter} vs ${panel.buttonCenter}`
		);

		// 幅を変えても高さは変わらない
		await page.setViewportSize({ width: 1100, height: 760 });
		await sleep(300);
		const toolbar2 = await headerMetrics(page, TOOLBAR, '.tool');
		const panel2 = await headerMetrics(page, PANEL_HEADER, 'button.icon');
		check(
			'ウィンドウの大きさを変えても高さが一致する',
			toolbar2.height === panel2.height,
			`${toolbar2.height} vs ${panel2.height}`
		);

		await context.close();
	} finally {
		await browser.close();
		vite.stop();
	}
	if (failures.length) {
		console.error(`\n${failures.length} 件の失敗: ${failures.join(' / ')}`);
		process.exit(1);
	}
	console.log('\nすべて成功しました');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
