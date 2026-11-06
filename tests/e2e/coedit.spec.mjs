// 共同編集の 2 ブラウザ E2E(段階 3b)。
// `bun run test:e2e` から、Firebase Emulator(auth + firestore)の中で実行される:
//   firebase emulators:exec --only auth,firestore --project demo-storift "node tests/e2e/coedit.spec.mjs"
// vite dev(空きポート)を VITE_FIREBASE_EMULATOR つきで起動し、プリインストールの Chromium(Playwright)で操作する。
// 本物の Firebase には接続しない(projectId=demo-storift の偽の設定)。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EMULATOR = process.env.VITE_FIREBASE_EMULATOR ?? '127.0.0.1:8080,127.0.0.1:9099';
const FIREBASE_CONFIG = {
	apiKey: 'fake-api-key',
	authDomain: 'demo-storift.firebaseapp.com',
	projectId: 'demo-storift',
	storageBucket: 'demo-storift.appspot.com',
	messagingSenderId: '1',
	appId: '1:1:web:e2e'
};
const EDITOR = '[role="textbox"][aria-label="エディタ"]';
const PASSWORD = 'e2e-pass-1234';
const INITIAL = '吾輩は猫である。\n名前はまだ無い。\nどこで生れたかとんと見当がつかぬ。';

// ---------- 小道具 ----------

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
			env: { ...process.env, VITE_FIREBASE_EMULATOR: EMULATOR, BROWSER: 'none' },
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

const results = [];
async function step(name, fn) {
	const started = Date.now();
	process.stdout.write(`- ${name} ... `);
	try {
		await fn();
		results.push({ name, ok: true });
		console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
	} catch (error) {
		results.push({ name, ok: false, error });
		console.log('FAILED');
		throw error;
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(`アサーション失敗: ${message}`);
}

const editorText = (page) => page.locator(EDITOR).evaluate((el) => el.innerText);
const editorEditable = (page) => page.locator(EDITOR).getAttribute('contenteditable');

/** ページのエラーログを出す(新しく開いたページにも付ける) */
async function watchPage(page, label) {
	await page.addInitScript(() => {
		Error.stackTraceLimit = 60;
	});
	page.on('pageerror', (error) => console.log(`  [${label}] pageerror: ${error.message}`));
	page.on('console', async (msg) => {
		if (msg.type() !== 'error') return;
		// Error オブジェクトはスタックも出す(原因の特定用)
		const parts = await Promise.all(
			msg
				.args()
				.map((arg) =>
					arg
						.evaluate((v) => (v && typeof v === 'object' && v.stack ? String(v.stack) : String(v)))
						.catch(() => '')
				)
		);
		console.log(`  [${label}] console.error: ${parts.join(' ').slice(0, 3000)}`);
	});
}

async function newClient(browser, label) {
	const context = await browser.newContext({ serviceWorkers: 'block', locale: 'ja-JP' });
	const page = await context.newPage();
	await watchPage(page, label);
	return { context, page, label };
}

/** アプリのモジュール(開発サーバーが配信する /src/...)をページ内で読み込んで実行する */
const run = (page, fn, arg) => page.evaluate(fn, arg);

async function seedSettings(page, base, withFirebase) {
	await page.goto(`${base}/home`);
	await run(
		page,
		async ([config]) => {
			const { settingsDB } = await import('/src/lib/db/index.ts');
			await settingsDB.update({
				...(config ? { firebase: config } : {}),
				setupCompleted: true,
				tutorialDismissed: true
			});
		},
		[withFirebase ? FIREBASE_CONFIG : null]
	);
}

/** 履歴(ナビゲーション履歴)の URL 一覧 */
async function historyUrls(client, page) {
	const cdp = await client.context.newCDPSession(page);
	const { entries } = await cdp.send('Page.getNavigationHistory');
	await cdp.detach();
	return entries.map((e) => e.url);
}

/** 新しいタブで招待リンクを直接開く(/join#...)。フラグメントが URL と履歴から消えることも検証する */
async function openInviteLink(client, base, link) {
	await seedSettings(client.page, base, false);
	const page = await client.context.newPage();
	await watchPage(page, client.label);
	const payload = link.slice(link.indexOf('#') + 1);
	await page.goto(`${base}/join#${payload}`);
	return { page, payload };
}

async function assertFragmentGone(client, page, payload) {
	await waitFor('URL からフラグメントが消える', () => !page.url().includes('#'), 15_000);
	const urls = await historyUrls(client, page);
	assert(
		urls.every((u) => !u.includes('#') && !u.includes(payload)),
		`履歴にフラグメントが残らない: ${urls.join(' , ')}`
	);
}

/**
 * 招待リンクで参加する(実フロー): 新しいタブで /join#... を直接開き、画面操作で参加し、
 * 「プロジェクトを開く」を押す。パスワード方式なら入力する。
 * 終わったら client.page を、参加後のタブに差し替える。
 */
async function joinWith(client, base, link, pid, { password } = {}) {
	const { page, payload } = await openInviteLink(client, base, link);
	if (password !== undefined) {
		const input = page.getByLabel('パスワード');
		await input.waitFor({ timeout: 30_000 });
		await input.fill(password);
		await page.getByRole('button', { name: '参加', exact: true }).click();
	}
	await page
		.getByText('参加しました')
		.or(page.getByText('再参加しました'))
		.waitFor({ timeout: 60_000 });
	await assertFragmentGone(client, page, payload);
	await page.getByRole('button', { name: 'プロジェクトを開く' }).click();
	await page.waitForURL(new RegExp(`/project/${pid}/editor`), { timeout: 30_000 });
	const old = client.page;
	client.page = page;
	await old.close();
}

async function openEditor(client, base, pid, expectedText) {
	await client.page.goto(`${base}/project/${pid}/editor`);
	await waitFor(
		`${client.label}: エディタの表示と共同編集の接続`,
		async () => {
			const editable = await editorEditable(client.page);
			const text = await editorText(client.page);
			return editable === 'true' && (expectedText === undefined || text === expectedText);
		},
		60_000
	);
}

async function typeAt(page, where, text, delay = 20) {
	await page.locator(EDITOR).click();
	await page.keyboard.press(where === 'start' ? 'Control+Home' : 'Control+End');
	await page.keyboard.type(text, { delay });
}

async function converged(clients, mustContain, timeout = 40_000) {
	await waitFor(
		`収束: ${mustContain.join(' / ')}`,
		async () => {
			const texts = await Promise.all(clients.map((c) => editorText(c.page)));
			return (
				texts.every((t) => t === texts[0]) &&
				mustContain.every((needle) => texts[0].includes(needle))
			);
		},
		timeout,
		300
	);
}

// ---------- シナリオ ----------

async function main() {
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;
	console.log(`vite dev: ${base} / emulator: ${EMULATOR}`);
	const vite = await startVite(port);
	const browser = await chromium.launch();
	const state = {};

	try {
		const owner = await newClient(browser, 'A(オーナー)');

		await step(
			'オーナー: Firebase 設定(エミュレータ)でセットアップし、オーナー登録される',
			async () => {
				await seedSettings(owner.page, base, true);
				await owner.page.reload();
				await waitFor(
					'accessMode が owner',
					() =>
						run(owner.page, async () => {
							const { authStore } = await import('/src/lib/stores/auth.svelte.ts');
							return authStore.accessMode === 'owner' && !!authStore.user;
						}),
					60_000
				);
			}
		);

		await step('オーナー: プロジェクトとシーンを作成し、共有を開始する', async () => {
			state.pid = await run(
				owner.page,
				async ([content]) => {
					const { projectsDB, chaptersDB, scenesDB } = await import('/src/lib/db/index.ts');
					const { startSharing } = await import('/src/lib/services/sharing.service.ts');
					const project = await projectsDB.create({ title: 'E2E 共同編集' });
					const chapter = await chaptersDB.create({
						projectId: project.id,
						title: '第一章',
						synopsis: ''
					});
					await scenesDB.create({
						chapterId: chapter.id,
						projectId: project.id,
						title: '冒頭',
						content
					});
					await startSharing(project.id, { visibility: 'private' });
					return project.id;
				},
				[INITIAL]
			);
			await waitFor('共有が active', () =>
				run(
					owner.page,
					async (id) => {
						const { projectsDB } = await import('/src/lib/db/index.ts');
						return (await projectsDB.getById(id))?.sharing?.status === 'active';
					},
					state.pid
				)
			);
		});

		await step('オーナー: 編集・閲覧の招待リンクを発行する', async () => {
			const links = await run(
				owner.page,
				async ([id, origin]) => {
					const { projectsDB, settingsDB } = await import('/src/lib/db/index.ts');
					const { buildInviteLink } = await import('/src/lib/firebase/invite.ts');
					const { inviteSecretFor } = await import('/src/lib/firebase/sharingInvite.ts');
					const project = await projectsDB.getById(id);
					const config = await settingsDB.getFirebaseConfig();
					const make = (role) => {
						const secret = inviteSecretFor(project.sharing, role);
						return buildInviteLink(origin, {
							config,
							pid: id,
							role,
							secret: secret.kind === 'token' ? secret.value : undefined
						});
					};
					return { editor: make('editor'), viewer: make('viewer') };
				},
				[state.pid, base]
			);
			state.links = links;
		});

		await step('オーナー: パスワード方式の共有プロジェクトを作り、リンクを発行する', async () => {
			const result = await run(
				owner.page,
				async ([origin, password]) => {
					const { projectsDB, chaptersDB, scenesDB, settingsDB } = await import(
						'/src/lib/db/index.ts'
					);
					const { startSharing } = await import('/src/lib/services/sharing.service.ts');
					const { buildInviteLink } = await import('/src/lib/firebase/invite.ts');
					const project = await projectsDB.create({ title: 'E2E パスワード共有' });
					const chapter = await chaptersDB.create({
						projectId: project.id,
						title: '章',
						synopsis: ''
					});
					await scenesDB.create({
						chapterId: chapter.id,
						projectId: project.id,
						title: '場面',
						content: 'パスワードの本文'
					});
					await startSharing(project.id, {
						visibility: 'private',
						viewerSecret: { type: 'password', value: password }
					});
					const config = await settingsDB.getFirebaseConfig();
					return {
						pid: project.id,
						link: buildInviteLink(origin, { config, pid: project.id, role: 'viewer' })
					};
				},
				[base, PASSWORD]
			);
			state.pwdPid = result.pid;
			state.pwdLink = result.link;
			await waitFor('パスワード共有が active', () =>
				run(
					owner.page,
					async (id) => {
						const { projectsDB } = await import('/src/lib/db/index.ts');
						return (await projectsDB.getById(id))?.sharing?.status === 'active';
					},
					state.pwdPid
				)
			);
		});

		await step('オーナー: エディタを開く(共同編集に接続し、本文が表示される)', async () => {
			await openEditor(owner, base, state.pid, INITIAL);
		});

		const guest = await newClient(browser, 'B(編集ゲスト)');
		await step('ゲスト B: 招待リンク(編集)で参加し、同じシーンを開く', async () => {
			await joinWith(guest, base, state.links.editor, state.pid);
			await openEditor(guest, base, state.pid, INITIAL);
		});

		await step('在席表示: 互いに「他 1 人が閲覧中」と相手の名前が出る', async () => {
			if (process.env.E2E_DEBUG) {
				await sleep(8000);
				for (const c of [owner, guest]) {
					console.log(
						c.label,
						await run(c.page, async () => {
							const { presenceStore } = await import('/src/lib/stores/presence.svelte.ts');
							return JSON.stringify({
								self: presenceStore.selfUid,
								entries: presenceStore.entries
							});
						})
					);
				}
			}
			await waitFor('A の在席チップ', async () => {
				const text = await owner.page.locator('[data-testid="presence"]').textContent();
				return /他 1 人が閲覧中/.test(text ?? '') && /ゲスト-/.test(text ?? '');
			});
			await waitFor('B の在席チップ', async () => {
				const text = await guest.page.locator('[data-testid="presence"]').textContent();
				return /他 1 人が閲覧中/.test(text ?? '') && /オーナー/.test(text ?? '');
			});
		});

		await step(
			'A と B が同時に別の位置へ入力すると、数秒後に両方のエディタが一致する',
			async () => {
				await Promise.all([
					typeAt(owner.page, 'start', '【Aの入力】\n'),
					typeAt(guest.page, 'end', '【Bの入力】')
				]);
				await converged([owner, guest], ['【Aの入力】', '【Bの入力】']);
				const text = await editorText(owner.page);
				assert(text.startsWith('【Aの入力】\n吾輩は猫である'), `A の入力が先頭にある: ${text}`);
				assert(text.endsWith('【Bの入力】'), `B の入力が末尾にある: ${text}`);
				state.synced = text;
			}
		);

		await step('改行(Enter)・削除(Backspace)も相手に反映される', async () => {
			await owner.page.locator(EDITOR).click();
			await owner.page.keyboard.press('Control+End');
			await owner.page.keyboard.press('Enter');
			await owner.page.keyboard.type('最後の行');
			await owner.page.keyboard.press('Backspace');
			await converged([owner, guest], ['最後の']);
			const [a, b] = await Promise.all([editorText(owner.page), editorText(guest.page)]);
			assert(a === b, '改行・削除後も一致する');
			assert(a.endsWith('【Bの入力】\n最後の'), `末尾: ${JSON.stringify(a.slice(-12))}`);
			state.synced = a;
		});

		await step('undo は自分の編集だけを戻し、他者の編集は戻さない', async () => {
			// B が末尾に追記してから、A が undo する。A の undo は A の最後の入力(「最後の」周辺)を戻すが、B の入力は残る
			await typeAt(guest.page, 'end', '【B追記】');
			await converged([owner, guest], ['【B追記】']);
			await owner.page.locator(EDITOR).click();
			await owner.page.keyboard.press('Control+z');
			await owner.page.keyboard.press('Control+z');
			await sleep(500);
			const after = await editorText(owner.page);
			assert(after.includes('【B追記】'), `B の編集は A の undo で戻らない: ${after}`);
			await converged([owner, guest], ['【B追記】']);
			// B の undo で自分の追記だけが消える
			await guest.page.locator(EDITOR).click();
			await guest.page.keyboard.press('Control+z');
			await waitFor('B の undo が A にも反映', async () => {
				const [a, b] = await Promise.all([editorText(owner.page), editorText(guest.page)]);
				return a === b && !a.includes('【B追記】');
			});
			state.synced = await editorText(owner.page);
		});

		await step('IME: 変換中に相手が前方へ挿入しても、確定した文字が壊れない', async () => {
			const before = await editorText(guest.page);
			const caret = before.indexOf('名前はまだ無い。') + 3; // 「名前は」の後ろ
			const cdp = await guest.context.newCDPSession(guest.page);
			await guest.page.locator(EDITOR).focus();
			await guest.page.evaluate(async (index) => {
				const { selectTextRange } = await import('/src/lib/utils/editorInput.ts');
				const el = document.querySelector('[role="textbox"][aria-label="エディタ"]');
				selectTextRange(el, index, index);
			}, caret);
			await cdp.send('Input.imeSetComposition', {
				text: 'ま',
				selectionStart: 1,
				selectionEnd: 1
			});
			const composing = await editorText(guest.page);
			assert(composing.includes('名前はま'), `変換中の文字が DOM にある: ${composing}`);

			// 変換中に A が先頭へ挿入する(B のキャレットより前)
			await typeAt(owner.page, 'start', '《前方挿入》');
			await sleep(5000); // 送信(約 2.5 秒)+ 受信を待つ。B の DOM は変換中なので変わらない
			const during = await editorText(guest.page);
			assert(
				!during.includes('《前方挿入》'),
				`変換中はリモートの更新を DOM に反映しない: ${during.slice(0, 20)}`
			);

			await cdp.send('Input.imeSetComposition', {
				text: 'まよう',
				selectionStart: 3,
				selectionEnd: 3
			});
			await cdp.send('Input.insertText', { text: '迷う' }); // 確定
			await converged([owner, guest], ['《前方挿入》', '名前は迷う']);
			const [a, b] = await Promise.all([editorText(owner.page), editorText(guest.page)]);
			assert(a === b, 'IME 後も両者が一致する');
			assert(a.startsWith('《前方挿入》'), `前方挿入が先頭: ${a.slice(0, 12)}`);
			assert(a.includes('名前は迷うまだ無い。'), `確定文字が元のキャレット位置に入る: ${a}`);
			assert(!a.includes('ま迷') && !a.includes('まよ'), `変換中の文字が残らない: ${a}`);
			state.synced = a;
			await cdp.detach();
		});

		const pwGuest = await newClient(browser, 'E(パスワードゲスト)');
		await step(
			'ゲスト E: パスワード方式のリンクを直接開き、誤り→正しいパスワードで参加する',
			async () => {
				const { page, payload } = await openInviteLink(pwGuest, base, state.pwdLink);
				const input = page.getByLabel('パスワード');
				await input.waitFor({ timeout: 30_000 });
				await assertFragmentGone(pwGuest, page, payload);
				await input.fill('wrong-password');
				await page.getByRole('button', { name: '参加', exact: true }).click();
				await page.locator('[role="alert"]').waitFor({ timeout: 30_000 });
				// 失敗してもパスワード入力に戻り、入力し直せる
				await input.fill(PASSWORD);
				await page.getByRole('button', { name: '参加', exact: true }).click();
				await page.getByText('参加しました').waitFor({ timeout: 60_000 });
				// リロードしても秘密(フラグメント)は URL に無く、入力画面に戻る
				await page.reload();
				await page.getByLabel('招待リンク').waitFor({ timeout: 30_000 });
				assert(!page.url().includes('#'), 'リロード後も URL にフラグメントが無い');
				await page.goto(`${base}/project/${state.pwdPid}/editor`);
				await waitFor(
					'E: パスワード共有の本文',
					async () => (await editorText(page)) === 'パスワードの本文',
					60_000
				);
				assert((await editorEditable(page)) === 'false', 'E は閲覧専用');
			}
		);

		const dialogGuest = await newClient(browser, 'D(ダイアログゲスト)');
		await step('ゲスト D: ホームの「共有リンクから参加」に貼り付けて参加する', async () => {
			await seedSettings(dialogGuest.page, base, false);
			const page = dialogGuest.page;
			await page.reload();
			await page.getByRole('button', { name: '共有リンクから参加' }).click();
			await page.getByLabel('招待リンク').fill(state.links.viewer);
			await page.getByRole('button', { name: '次へ' }).click();
			await page.getByText('参加しました').waitFor({ timeout: 60_000 });
			await page.getByRole('button', { name: 'ホームへ' }).click();
			await page.getByText('E2E 共同編集').first().waitFor({ timeout: 30_000 });
		});

		await step('不正なリンクは日本語のエラーになり、フラグメントも消える', async () => {
			const bad = await newClient(browser, 'X(不正リンク)');
			await seedSettings(bad.page, base, false);
			const page = await bad.context.newPage();
			await watchPage(page, bad.label);
			await page.goto(`${base}/join#not-a-valid-payload`);
			const alert = page.locator('[role="alert"]');
			await alert.waitFor({ timeout: 30_000 });
			const text = await alert.textContent();
			assert(/招待リンク/.test(text ?? ''), `日本語のエラー表示: ${text}`);
			await assertFragmentGone(bad, page, 'not-a-valid-payload');
			await bad.context.close();
		});

		const viewer = await newClient(browser, 'C(閲覧ゲスト)');
		await step('閲覧ゲスト C: 編集できず、リモートの更新だけ反映される', async () => {
			await joinWith(viewer, base, state.links.viewer, state.pid);
			await viewer.page.goto(`${base}/project/${state.pid}/editor`);
			await waitFor(
				'C: エディタの表示',
				async () => (await editorText(viewer.page)) === state.synced,
				60_000
			);
			assert((await editorEditable(viewer.page)) === 'false', 'viewer は contenteditable=false');
			await viewer.page.locator(EDITOR).click({ force: true });
			await viewer.page.keyboard.type('書けてはいけない');
			await sleep(500);
			assert((await editorText(viewer.page)) === state.synced, 'viewer の入力は反映されない');

			await typeAt(owner.page, 'end', '〈Cに届く〉');
			await converged([owner, guest, viewer], ['〈Cに届く〉']);
			assert(
				!(await editorText(viewer.page)).includes('書けてはいけない'),
				'viewer の入力は残らない'
			);
		});

		await step('オーナーが B を削除すると、B のアクセスが失効表示になる', async () => {
			await run(
				owner.page,
				async (id) => {
					const { getMembers, removeMember } = await import('/src/lib/services/sharing.service.ts');
					const members = await getMembers(id);
					const target = members.find((m) => m.role === 'editor');
					if (!target) throw new Error('編集メンバーが見つかりません');
					await removeMember(id, target.uid);
				},
				state.pid
			);
			// B が入力して送信しようとすると権限エラーになり、失効として扱われる
			await typeAt(guest.page, 'end', '失効後の入力');
			await waitFor(
				'B: アクセス権が無効の表示',
				async () => {
					const banner = await guest.page.locator('[role="status"]').allTextContents();
					return banner.some((t) => t.includes('アクセス権が無効'));
				},
				60_000
			);
			await waitFor(
				'B: エディタが読み取り専用になる',
				async () => (await editorEditable(guest.page)) === 'false',
				30_000
			);
			// 他の参加者(A)には、失効後の入力は届かない
			await sleep(3500);
			assert(
				!(await editorText(owner.page)).includes('失効後の入力'),
				'失効後の B の入力は A に届かない'
			);
		});

		console.log(`\nE2E: ${results.filter((r) => r.ok).length}/${results.length} 件成功`);
	} finally {
		await browser.close().catch(() => undefined);
		vite.stop();
	}
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error(`\nE2E 失敗: ${error?.stack ?? error}`);
		process.exit(1);
	}
);
