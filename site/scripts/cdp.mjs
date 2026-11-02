// 使い捨てプロファイルの headless Chrome を CDP で動かす小さな補助
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, width = 1440, height = 900, scale = 1 } = {}) {
	const profile = mkdtempSync(join(tmpdir(), 'storift-cap-'));
	const proc = spawn(
		CHROME,
		[
			'--headless=new',
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${profile}`,
			'--no-first-run',
			'--hide-scrollbars',
			'about:blank'
		],
		{ stdio: 'ignore' }
	);
	let targets;
	for (let i = 0; i < 50; i++) {
		await sleep(200);
		try {
			targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
			if (targets.some((t) => t.type === 'page')) break;
		} catch {
			/* 起動待ち */
		}
	}
	const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
	await new Promise((r) => (ws.onopen = r));
	let id = 0;
	const pending = new Map();
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data);
		if (m.id && pending.has(m.id)) {
			const { res, rej } = pending.get(m.id);
			pending.delete(m.id);
			if (m.error) rej(new Error(JSON.stringify(m.error)));
			else res(m.result);
		}
	};
	const send = (method, params = {}) =>
		new Promise((res, rej) => {
			pending.set(++id, { res, rej });
			ws.send(JSON.stringify({ id, method, params }));
		});
	await send('Page.enable');
	await send('Runtime.enable');
	await send('Emulation.setDeviceMetricsOverride', {
		width,
		height,
		deviceScaleFactor: scale,
		mobile: false
	});

	const api = {
		send,
		sleep,
		async goto(url, wait = 2500) {
			await send('Page.navigate', { url });
			await sleep(wait);
		},
		async evaluate(expression) {
			const r = await send('Runtime.evaluate', {
				expression,
				awaitPromise: true,
				returnByValue: true
			});
			if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
			return r.result.value;
		},
		async shot(path, format = 'png', quality = 86) {
			const r = await send('Page.captureScreenshot', {
				format,
				...(format === 'png' ? {} : { quality })
			});
			writeFileSync(path, Buffer.from(r.data, 'base64'));
		},
		async close() {
			ws.close();
			proc.kill();
			await sleep(500);
			try {
				rmSync(profile, { recursive: true, force: true });
			} catch {
				/* Chrome の終了待ちで消せないことがある */
			}
		}
	};
	return api;
}
