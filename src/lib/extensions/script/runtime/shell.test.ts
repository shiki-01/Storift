import { describe, expect, it } from 'vitest';
import { SHELL_SOURCE, WORKER_BOOTSTRAP, buildCsp, buildShellHtml, createNonce } from './shell';

describe('シェルの CSP', () => {
	const nonce = createNonce();

	it('nonce は毎回新しい乱数', () => {
		const set = new Set(Array.from({ length: 50 }, () => createNonce()));
		expect(set.size).toBe(50);
		expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
	});

	it("必要最小限で、'unsafe-eval' と 'unsafe-inline' が無い", () => {
		const csp = buildCsp(nonce, ['discord.com']);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain(`script-src 'nonce-${nonce}'`);
		expect(csp).toContain('worker-src blob:');
		expect(csp).toContain('connect-src https://discord.com');
		expect(csp).toContain("img-src 'none'");
		expect(csp).toContain("style-src 'none'");
		expect(csp).toContain("form-action 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).not.toMatch(/unsafe-/);
	});

	it('通信を宣言していなければ connect-src は none。複数ホストは https:// つきで並ぶ', () => {
		expect(buildCsp(nonce, [])).toContain("connect-src 'none'");
		expect(buildCsp(nonce, ['a.example.com', 'b.example.org'])).toContain(
			'connect-src https://a.example.com https://b.example.org;'
		);
	});

	it('CSP に混入しうるホスト名と nonce を拒否する', () => {
		for (const host of [
			"a.com; script-src 'unsafe-eval'",
			'a.com *',
			'*.a.com',
			'a.com/x',
			'A.com',
			''
		])
			expect(() => buildCsp(nonce, [host]), host).toThrow();
		expect(() => buildCsp("x'; script-src *", [])).toThrow();
		expect(() => buildCsp('short', [])).toThrow();
	});

	it('HTML は CSP の meta がいちばん先で、シェルのスクリプトだけが nonce 付き', () => {
		const html = buildShellHtml(nonce, ['discord.com']);
		expect(
			html.startsWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"')
		).toBe(true);
		expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
		expect(html.match(/<script nonce=/g)).toHaveLength(1);
		expect(html.match(/<\/script/g)).toHaveLength(1);
		expect(html).not.toContain('<!--');
		expect(html).toContain(`<script nonce="${nonce}">`);
		expect(SHELL_SOURCE).not.toContain('</script');
	});

	it('シェルは eval / innerHTML / new Function を使わない', () => {
		for (const raw of [SHELL_SOURCE, WORKER_BOOTSTRAP]) {
			const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
			expect(source).not.toMatch(/\beval\b|innerHTML|document\.write|new Function/);
		}
	});
});

describe('ワーカー側の SDK(storift)', () => {
	function run() {
		const posted: Record<string, unknown>[] = [];
		const listeners: ((e: { data: unknown }) => void)[] = [];
		const self: Record<string, unknown> = {
			postMessage: (m: Record<string, unknown>) => posted.push(m),
			addEventListener: (_: string, fn: (e: { data: unknown }) => void) => listeners.push(fn)
		};
		new Function('self', 'setTimeout', WORKER_BOOTSTRAP)(self, (fn: () => void) => fn());
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const storift = (self as { storift: any }).storift;
		const deliver = (data: unknown) => listeners.forEach((l) => l({ data }));
		return { posted, storift, deliver };
	}

	it('起動時に boot と loaded を知らせ、ping に pong で答える', () => {
		const { posted, deliver } = run();
		expect(posted.map((m) => m.t)).toEqual(['boot', 'loaded']);
		deliver({ t: 'ping' });
		expect(posted.at(-1)).toEqual({ t: 'pong' });
	});

	it('storift は凍結されていて、書き換えられない', () => {
		const { storift } = run();
		expect(Object.isFrozen(storift)).toBe(true);
		expect(Object.isFrozen(storift.storage)).toBe(true);
		expect(() => {
			'use strict';
			storift.storage = {};
		}).toThrow();
	});

	it('リクエストに id を振り、応答で解決・拒否する(エラーに code が付く)', async () => {
		const { posted, storift, deliver } = run();
		const ok = storift.storage.get('k');
		const ng = storift.notify('x');
		const [a, b] = posted.slice(2) as { id: number; m: string }[];
		expect(a).toMatchObject({ t: 'req', m: 'storage.get', a: { key: 'k' } });
		expect(b.m).toBe('notify');
		deliver({ t: 'res', id: a.id, ok: true, v: 5 });
		deliver({ t: 'res', id: b.id, ok: false, code: 'permission', msg: 'だめ' });
		expect(await ok).toBe(5);
		await expect(ng).rejects.toMatchObject({ code: 'permission', message: 'だめ' });
	});

	it('events.on は購読を 1 回だけ申し込み、イベントを届け、解除できる', async () => {
		const { posted, storift, deliver } = run();
		const seen: unknown[] = [];
		const p1 = storift.events.on('session:end', (p: unknown) => seen.push(p));
		const first = posted.at(-1) as { id: number; m: string; a: unknown };
		expect(first).toMatchObject({ m: 'events.on', a: { name: 'session:end' } });
		deliver({ t: 'res', id: first.id, ok: true, v: null });
		const off = await p1;
		const p2 = storift.events.on('session:end', (p: unknown) => seen.push(['2', p]));
		await p2;
		expect(posted.filter((m) => m.m === 'events.on')).toHaveLength(1);
		deliver({ t: 'ev', n: 'session:end', p: { netChars: 1 } });
		expect(seen).toEqual([{ netChars: 1 }, ['2', { netChars: 1 }]]);
		off();
		deliver({ t: 'ev', n: 'session:end', p: { netChars: 2 } });
		expect(seen).toHaveLength(3);
	});

	it('ui.onEvent に画面の操作が届き、ハンドラの例外でワーカーは止まらない', () => {
		const { storift, deliver } = run();
		const seen: unknown[] = [];
		storift.ui.onEvent((e: unknown) => {
			seen.push(e);
			throw new Error('ハンドラの例外');
		});
		deliver({ t: 'ui', id: 'b', kind: 'press' });
		deliver({ t: 'ui', id: 'i', kind: 'change', v: 'text' });
		expect(seen).toEqual([
			{ id: 'b', kind: 'press', value: undefined },
			{ id: 'i', kind: 'change', value: 'text' }
		]);
	});
});
