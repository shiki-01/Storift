// E2E スペック共通の補助関数(vite dev の起動、Tauri のモック、テーマの切替、作品の用意など)。
// 既存のスペックは単体で動くように書かれているが、新しいスペックはここを共有する。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
export const { chromium, devices } = require('playwright');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EDITOR = '[role="textbox"][aria-label="エディタ"]';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(description, fn, timeout = 30_000, interval = 150) {
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

/** vite dev を空きポートで起動する。戻り値の stop() で止める */
export async function startVite() {
	const port = await freePort();
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
		base: `http://127.0.0.1:${port}`,
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
export function check(name, condition, detail = '') {
	console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
	if (!condition) failures.push(name);
}

/** 失敗があれば終了コード 1 で終える */
export function finish() {
	if (failures.length) {
		console.error(`\n${failures.length} 件の失敗: ${failures.join(' / ')}`);
		process.exit(1);
	}
	console.log('\nすべて成功しました');
}

/**
 * スクリーンショットを保存する(目視確認用)。環境変数 E2E_SHOT_DIR を指定したときだけ書き出し、
 * リポジトリには何も残さない。
 */
export async function shot(page, name, options = {}) {
	const dir = process.env.E2E_SHOT_DIR;
	if (!dir) return;
	fs.mkdirSync(dir, { recursive: true });
	await page.screenshot({ path: path.join(dir, `${name}.png`), ...options });
}

/** 要素だけのスクリーンショット(shot と同じく E2E_SHOT_DIR を指定したときだけ) */
export async function shotEl(locator, name) {
	const dir = process.env.E2E_SHOT_DIR;
	if (!dir) return;
	fs.mkdirSync(dir, { recursive: true });
	await locator.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * Tauri の呼び出しを最小限に再現して「デスクトップ版」として動かす(ページ内で実行される)。
 * window.__hangSend が true の間は claude_send を完了させない(回答中の状態を作る)。
 * window.__updater* は更新のモック用。
 */
export function installTauriMock() {
	window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
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
		async invoke(cmd, args) {
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
				case 'claude_send':
					if (window.__hangSend) return new Promise(() => {});
					if (window.__failSend) throw new Error('E2E: 送信に失敗しました');
					return null;
				case 'plugin:updater|check':
					return {
						rid: 7,
						currentVersion: '0.3.0',
						version: '0.4.0',
						date: null,
						body: '新しい機能と修正を含むリリースです。',
						rawJson: {}
					};
				case 'plugin:updater|download_and_install': {
					// window.__updateTotal(バイト、0 なら不明)と __updateRatio の位置まで進めたところで止める
					const total = window.__updateTotal ?? 47_000_000;
					const send = (index, message) => window[`_${args.onEvent.id}`]({ index, message });
					send(0, { event: 'Started', data: { contentLength: total || undefined } });
					const ratio = window.__updateRatio ?? 0.42;
					send(1, {
						event: 'Progress',
						data: { chunkLength: Math.floor((total || 5_000_000) * ratio) }
					});
					return new Promise(() => {});
				}
				case 'plugin:app|version':
					return '0.3.0';
				default:
					return null;
			}
		}
	};
}

/** 設定の初期化を済ませ、章とシーンが 1 つずつある作品を作って id を返す(/home を開いている状態で呼ぶ) */
export async function seedProject(page, { title = 'E2E 作品', content = '本文です。' } = {}) {
	return page.evaluate(
		async ({ title, content }) => {
			const { settingsDB, projectsDB, chaptersDB, scenesDB } = await import('/src/lib/db/index.ts');
			await settingsDB.update({ setupCompleted: true, tutorialDismissed: true });
			const project = await projectsDB.create({ title });
			const chapter = await chaptersDB.create({ projectId: project.id, title: '章', synopsis: '' });
			await scenesDB.create({
				chapterId: chapter.id,
				projectId: project.id,
				title: '場面',
				content
			});
			return project.id;
		},
		{ title, content }
	);
}

/** 暗い配色のカスタムテーマ(背景が暗いので isDarkColor が true になる) */
export const CUSTOM_DARK_THEME = {
	id: 'custom-e2e-dark',
	name: 'E2E 暗いカスタム',
	colors: {
		primary: '#7fd1b9',
		secondary: '#b3a6c2',
		background: '#10151c',
		surface: '#18202b',
		text: '#e4ecf5',
		textSecondary: '#93a1b3',
		border: '#2a3544',
		accent: '#f0a86e',
		success: '#8cc98a',
		warning: '#e0b25a',
		error: '#ec8b8b',
		info: '#7fb0e8'
	},
	editor: {
		background: '#131a23',
		text: '#e4ecf5',
		selection: '#2d4560',
		lineHighlight: '#1a2330',
		cursor: '#7fd1b9'
	},
	fonts: {
		body: "'Noto Sans JP', sans-serif",
		editor: "'Noto Serif JP', serif",
		heading: "'Noto Sans JP', sans-serif"
	}
};

/** テーマを切り替える。'light' | 'dark' | カスタムテーマのオブジェクト */
export async function applyTheme(page, theme) {
	await page.evaluate(async (theme) => {
		const { themeStore } = await import('/src/lib/stores/theme.svelte.ts');
		// 初回の読み込み直後は、保存済みテーマの復元(非同期)が終わるのを待つ
		await new Promise((r) => setTimeout(r, 300));
		await themeStore.setAutoTheme(false);
		if (typeof theme === 'string') {
			await themeStore.setTheme(theme);
		} else {
			await themeStore.saveCustomTheme(theme);
			await themeStore.setTheme(theme.id);
		}
	}, theme);
	await sleep(400);
}
