import { describe, expect, it } from 'vitest';
import { SESSION_SETTINGS_KEY, loadSessionSettings } from './sessionSettings.svelte';

function store(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		data
	};
}

describe('loadSessionSettings', () => {
	it('何も無ければ既定の 5 分', () => {
		expect(loadSessionSettings(store())).toEqual({ idleMinutes: 5 });
		expect(loadSessionSettings(null)).toEqual({ idleMinutes: 5 });
	});

	it('Monolog. 連携の以前の設定(idleMinutes)を引き継ぎ、本体の設定として保存する', () => {
		const s = store({
			'storift:monolog:settings': JSON.stringify({ mode: 'record', idleMinutes: 15 })
		});
		expect(loadSessionSettings(s)).toEqual({ idleMinutes: 15 });
		expect(JSON.parse(s.data.get(SESSION_SETTINGS_KEY)!)).toEqual({ idleMinutes: 15 });
	});

	it('本体の設定があれば、そちらを優先する', () => {
		const s = store({
			[SESSION_SETTINGS_KEY]: JSON.stringify({ idleMinutes: 10 }),
			'storift:monolog:settings': JSON.stringify({ idleMinutes: 30 })
		});
		expect(loadSessionSettings(s)).toEqual({ idleMinutes: 10 });
	});

	it('範囲外・壊れた値は既定に戻す', () => {
		expect(
			loadSessionSettings(store({ [SESSION_SETTINGS_KEY]: JSON.stringify({ idleMinutes: 7 }) }))
		).toEqual({ idleMinutes: 5 });
		expect(loadSessionSettings(store({ [SESSION_SETTINGS_KEY]: '{oops' }))).toEqual({
			idleMinutes: 5
		});
		expect(
			loadSessionSettings(
				store({ 'storift:monolog:settings': JSON.stringify({ idleMinutes: 'x' }) })
			)
		).toEqual({ idleMinutes: 5 });
	});
});
