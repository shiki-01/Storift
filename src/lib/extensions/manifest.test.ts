import { describe, expect, it } from 'vitest';
import discord from '$extensions/discord/manifest.json';
import monolog from '$extensions/monolog/manifest.json';
import {
	consentFingerprint,
	parseManifest,
	platformsLabel,
	summarizePermissions,
	validateManifest
} from './manifest';

const valid = () => ({
	id: 'my-ext',
	name: '名前',
	description: '説明',
	version: '1.2.3',
	author: '作者',
	kind: 'official',
	apiVersion: 1,
	platforms: ['web', 'desktop'],
	icon: 'clock',
	permissions: {},
	privacy: { sends: [], stores: [], onDisable: 'なし' }
});

function errorsOf(patch: Record<string, unknown>): string[] {
	const result = validateManifest({ ...valid(), ...patch });
	return result.ok ? [] : result.errors;
}

describe('validateManifest', () => {
	it('正しいマニフェストを受け付ける', () => {
		expect(validateManifest(valid()).ok).toBe(true);
		expect(
			validateManifest({
				...valid(),
				homepage: 'https://example.com/',
				license: 'MIT',
				permissions: {
					events: ['session:start'],
					read: ['project:title'],
					network: ['api.example.com'],
					storage: true
				},
				privacy: {
					sends: [{ to: 'api.example.com', items: ['時刻'], when: '終了時' }],
					stores: ['トークン: 端末内'],
					onDisable: '削除',
					notes: ['本文は送りません']
				}
			}).ok
		).toBe(true);
	});

	it('同梱の公式拡張のマニフェストは、すべて検証に通り、id がフォルダ名と一致する', () => {
		for (const [id, json] of [
			['monolog', monolog],
			['discord', discord]
		] as const) {
			const m = parseManifest(json, id);
			expect(m.id).toBe(id);
			expect(m.kind).toBe('official');
		}
	});

	it('オブジェクト以外・未知のキーを拒否する', () => {
		expect(validateManifest(null).ok).toBe(false);
		expect(validateManifest([]).ok).toBe(false);
		expect(errorsOf({ extra: 1 }).join()).toContain('extra');
	});

	it('id は英小文字・数字・ハイフンだけ', () => {
		for (const id of ['', 'My', 'a_b', 'a b', '-a', 'a-', 'a--b', 'あ']) {
			expect(errorsOf({ id }).join(), id).toContain('id');
		}
		expect(errorsOf({ id: 'a1-b2' })).toEqual([]);
	});

	it('version は semver', () => {
		for (const version of ['1', '1.0', 'v1.0.0', '01.0.0', '1.0.0.0', '']) {
			expect(errorsOf({ version }).join(), version).toContain('version');
		}
		expect(errorsOf({ version: '1.0.0-beta.1+build.5' })).toEqual([]);
	});

	it('kind・apiVersion・platforms', () => {
		expect(errorsOf({ kind: 'plugin' }).join()).toContain('kind');
		// パックは contributions と license が必須(pack.test.ts に詳しいテストがある)
		expect(
			errorsOf({
				kind: 'pack',
				license: 'MIT',
				updatedAt: '2026-11-12',
				contributions: { themes: ['themes/a.json'] }
			})
		).toEqual([]);
		expect(errorsOf({ kind: 'script' })).toEqual([]);
		expect(errorsOf({ apiVersion: 2 }).join()).toContain('apiVersion');
		expect(errorsOf({ platforms: [] }).join()).toContain('platforms');
		expect(errorsOf({ platforms: ['mobile'] }).join()).toContain('platforms');
		expect(errorsOf({ platforms: ['web', 'web'] }).join()).toContain('重複');
		expect(errorsOf({ platforms: ['desktop'] })).toEqual([]);
	});

	it('必須の文字列が空だと拒否する', () => {
		for (const key of ['name', 'description', 'author']) {
			expect(errorsOf({ [key]: '  ' }).join(), key).toContain(key);
		}
		expect(errorsOf({ icon: 'Bad Icon' }).join()).toContain('icon');
	});

	it('homepage は https の URL', () => {
		expect(errorsOf({ homepage: 'http://example.com' }).join()).toContain('homepage');
		expect(errorsOf({ homepage: 'nope' }).join()).toContain('homepage');
	});

	it('permissions: 未知のイベント・読み取り・ホスト名・storage を拒否する', () => {
		expect(errorsOf({ permissions: { events: ['scene:deleted'] } }).join()).toContain('events');
		expect(errorsOf({ permissions: { read: ['project:body'] } }).join()).toContain('read');
		expect(errorsOf({ permissions: { storage: 'yes' } }).join()).toContain('storage');
		expect(errorsOf({ permissions: { other: 1 } }).join()).toContain('other');
		expect(errorsOf({ permissions: null }).join()).toContain('permissions');
		for (const host of [
			'https://a.example.com',
			'a.example.com/path',
			'*.example.com',
			'a.example.com:8080',
			'localhost',
			'A.Example.com',
			''
		]) {
			expect(errorsOf({ permissions: { network: [host] } }).join(), host).toContain('network');
		}
		expect(
			errorsOf({
				permissions: { network: ['api.monolog.life'] },
				privacy: {
					sends: [{ to: 'x', items: ['i'], when: 'w' }],
					stores: [],
					onDisable: 'o'
				}
			})
		).toEqual([]);
	});

	it('privacy: sends の各項目・stores・onDisable が必要', () => {
		expect(errorsOf({ privacy: undefined }).join()).toContain('privacy');
		expect(errorsOf({ privacy: { stores: [], onDisable: 'o' } }).join()).toContain('sends');
		expect(
			errorsOf({
				privacy: { sends: [{ to: '', items: [], when: '' }], stores: [], onDisable: 'o' }
			}).length
		).toBe(3);
		expect(errorsOf({ privacy: { sends: [], onDisable: 'o' } }).join()).toContain('stores');
		expect(errorsOf({ privacy: { sends: [], stores: [] } }).join()).toContain('onDisable');
		expect(
			errorsOf({ privacy: { sends: [], stores: [], onDisable: 'o', notes: [1] } }).join()
		).toContain('notes');
	});

	it('通信を宣言したのに、送る情報の説明が無いマニフェストは拒否する', () => {
		expect(errorsOf({ permissions: { network: ['api.example.com'] } }).join()).toContain(
			'privacy.sends'
		);
	});

	it('すべての問題をまとめて返す', () => {
		expect(errorsOf({ id: 'X', version: 'x', kind: 'y' }).length).toBeGreaterThanOrEqual(3);
	});
});

describe('parseManifest', () => {
	it('不正なら、問題の一覧つきの例外にする', () => {
		expect(() => parseManifest({}, 'test')).toThrow(/test/);
		expect(parseManifest(valid()).id).toBe('my-ext');
	});
});

describe('consentFingerprint', () => {
	it('キーの順序に左右されず、permissions / privacy の内容で決まる', () => {
		const a = parseManifest(valid());
		const b = parseManifest({ ...valid(), version: '9.9.9', name: '別名' });
		expect(consentFingerprint(a)).toBe(consentFingerprint(b));
		const c = parseManifest({ ...valid(), permissions: { storage: true } });
		expect(consentFingerprint(a)).not.toBe(consentFingerprint(c));
		const d = parseManifest({
			...valid(),
			privacy: { onDisable: 'なし', stores: [], sends: [] }
		});
		expect(consentFingerprint(a)).toBe(consentFingerprint(d));
	});
});

describe('表示用の整形', () => {
	it('権限の要約', () => {
		const s = summarizePermissions({
			events: ['session:end'],
			read: ['project:title'],
			network: ['a.example.com'],
			storage: true
		});
		expect(s.receives).toHaveLength(2);
		expect(s.network).toEqual(['a.example.com']);
		expect(s.storage).toBe(true);
		expect(summarizePermissions({})).toEqual({ receives: [], network: [], storage: false });
	});

	it('対応プラットフォームの表示', () => {
		expect(platformsLabel(['web', 'desktop'])).toBe('Web 版・デスクトップ版');
		expect(platformsLabel(['desktop'])).toBe('デスクトップ版のみ');
		expect(platformsLabel(['web'])).toBe('Web 版のみ');
	});
});
