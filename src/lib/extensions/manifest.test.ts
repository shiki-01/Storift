import { describe, expect, it } from 'vitest';
import discord from '$extensions/discord/manifest.json';
import monolog from '$extensions/monolog/manifest.json';
import {
	consentFingerprint,
	describeScriptPermissions,
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
		expect(errorsOf({ kind: 'script' }).join()).toContain('entry');
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
		expect(summarizePermissions({})).toEqual({
			receives: [],
			network: [],
			storage: false,
			notify: false,
			ui: false
		});
	});

	it('対応プラットフォームの表示', () => {
		expect(platformsLabel(['web', 'desktop'])).toBe('Web 版・デスクトップ版');
		expect(platformsLabel(['desktop'])).toBe('デスクトップ版のみ');
		expect(platformsLabel(['web'])).toBe('Web 版のみ');
	});
});

describe('スクリプト(kind: script)のマニフェスト', () => {
	const script = (patch: Record<string, unknown> = {}) => ({
		...valid(),
		kind: 'script',
		license: 'MIT',
		updatedAt: '2026-11-12',
		entry: 'main.js',
		permissions: { ui: true, notify: true, storage: true },
		...patch
	});
	const errors = (patch: Record<string, unknown> = {}) => {
		const r = validateManifest(script(patch));
		return r.ok ? [] : r.errors;
	};
	const sends = (to: string) => [{ to, items: ['x'], when: 'y' }];

	it('正しいスクリプトを受け付ける', () => {
		expect(errors()).toEqual([]);
		expect(
			errors({
				permissions: { network: ['discord.com'], events: ['session:end'], read: ['project:title'] },
				privacy: { sends: sends('discord.com(Webhook)'), stores: [], onDisable: 'x' }
			})
		).toEqual([]);
	});

	it('entry・license・updatedAt が必須で、entry は 1 つの .js のファイル名', () => {
		expect(errors({ entry: undefined }).join()).toContain('entry');
		for (const bad of ['../main.js', 'a/b.js', 'main.ts', 'Main.js', '/x.js', 'main.js.json'])
			expect(errors({ entry: bad }).join(), bad).toContain('entry');
		expect(errors({ license: undefined }).join()).toContain('license');
		expect(errors({ updatedAt: undefined }).join()).toContain('updatedAt');
	});

	it('通信先は完全一致のホスト名だけ(ワイルドカード・IP・localhost・ポート・内部名は不可)', () => {
		for (const host of [
			'*.example.com',
			'127.0.0.1',
			'192.168.0.1',
			'localhost',
			'example.com:8080',
			'a.localhost',
			'printer.local',
			'Example.com',
			'https://example.com',
			'example.com/path'
		]) {
			expect(
				errors({
					permissions: { network: [host] },
					privacy: { sends: sends(host), stores: [], onDisable: 'x' }
				}).join(),
				host
			).toContain('permissions.network');
		}
	});

	it('permissions.network の各ホストは privacy.sends[].to のどこかに現れる', () => {
		const e = errors({
			permissions: { network: ['a.example.com', 'b.example.com'] },
			privacy: { sends: sends('a.example.com'), stores: [], onDisable: 'x' }
		});
		expect(e.join()).toContain('b.example.com');
		expect(e.join()).not.toContain('「a.example.com」');
	});

	it('送ると書いたのに通信先を宣言していない、は拒否する', () => {
		expect(
			errors({ privacy: { sends: sends('example.com'), stores: [], onDisable: 'x' } }).join()
		).toContain('permissions.network');
	});

	it('ui / notify はスクリプトだけ。entry もスクリプトだけ', () => {
		expect(errorsOf({ permissions: { ui: true } }).join()).toContain('kind: script');
		expect(errorsOf({ permissions: { notify: true } }).join()).toContain('kind: script');
		expect(errorsOf({ entry: 'main.js' }).join()).toContain('entry');
		expect(errors({ permissions: { ui: 'yes' } }).join()).toContain('permissions.ui');
	});

	it('公式を名乗る ID は使えない', () => {
		expect(errors({ id: 'discord' }).join()).toContain('予約');
		expect(errors({ id: 'official-timer' }).join()).toContain('予約');
	});

	it('権限を平易な日本語で列挙する', () => {
		const lines = describeScriptPermissions({
			events: ['session:start', 'session:end', 'page:change'],
			read: ['project:title', 'project:chars'],
			network: ['discord.com', 'example.org'],
			storage: true,
			notify: true,
			ui: true
		});
		expect(lines).toContain('あなたの執筆の開始・終了を受け取ります');
		expect(lines).toContain('作品名を受け取ります');
		expect(lines).toContain('作品の総文字数を受け取ります');
		expect(lines).toContain('次のサーバーと通信します: discord.com、example.org');
		expect(lines.join()).toContain('通知');
		expect(describeScriptPermissions({})).toEqual([]);
	});

	it('同意の対象(consentFingerprint)に、ui / notify の権限も含まれる', () => {
		const a = script();
		const b = script({ permissions: { ui: true, notify: false, storage: true } });
		expect(consentFingerprint(a as never)).not.toBe(consentFingerprint(b as never));
	});
});
