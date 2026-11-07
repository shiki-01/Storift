// 人物・設定資料の E2E で共有する補助関数(ドラッグ、要素の位置、閲覧専用の作品、はみ出しの測定)。
import { devices, sleep } from './helpers.mjs';

export const LONG = Array.from(
	{ length: 14 },
	(_, i) => `第${i + 1}行: 長い本文の確認用のテキストです。`
).join('\n');

/** デスクトップ / スマホ(iPhone 13)のコンテキストの設定 */
export const contextOptions = (mobile) =>
	mobile
		? { ...devices['iPhone 13'], serviceWorkers: 'block', locale: 'ja-JP' }
		: { viewport: { width: 1400, height: 900 }, serviceWorkers: 'block', locale: 'ja-JP' };

/** 作品を閲覧専用にする(共有の role=viewer)。/home を開いている状態で呼ぶ */
export function makeViewer(page, pid) {
	return page.evaluate(async (pid) => {
		const { projectsDB } = await import('/src/lib/db/index.ts');
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
	}, pid);
}

export async function box(locator) {
	await locator.scrollIntoViewIfNeeded();
	const b = await locator.boundingBox();
	return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/**
 * ドラッグする。path は通過点の並びで、各点は座標か、その時点の座標を返す関数。
 * kind: 'mouse'(マウス) | 'touch'(CDP のタッチイベント。ポインタイベントは pointerType=touch になる)
 */
export async function dragPath(page, kind, from, path) {
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

/** ページが横にはみ出していないか(0 以下ならはみ出していない) */
export const overflowOf = (page, rootSelector) =>
	page.evaluate((sel) => {
		const root = document.querySelector(sel);
		return {
			doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			body: document.body.scrollWidth - document.body.clientWidth,
			page: root ? root.scrollWidth - root.clientWidth : 0
		};
	}, rootSelector);

export const noOverflow = (o) => o.doc <= 0 && o.body <= 0 && o.page <= 0;
