import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './events';
import { CONSENT_STORAGE_KEY, ENABLED_STORAGE_KEY, ExtensionHost } from './host.svelte';
import type { ExtensionManifest } from './manifest';
import type { Extension, ExtensionPlatform } from './types';

function makeManifest(
	id: string,
	platforms: ExtensionPlatform[] = ['web', 'desktop'],
	over: Partial<ExtensionManifest> = {}
): ExtensionManifest {
	return {
		id,
		name: id,
		description: 'd',
		version: '1.0.0',
		author: 'a',
		kind: 'official',
		apiVersion: 1,
		platforms,
		icon: 'clock',
		permissions: {},
		privacy: { sends: [], stores: [], onDisable: '消えます' },
		...over
	};
}

function makeExt(
	id: string,
	platforms: ExtensionPlatform[] = ['web', 'desktop'],
	over: Partial<ExtensionManifest> = {}
) {
	const ext = {
		manifest: makeManifest(id, platforms, over),
		activate: vi.fn(),
		deactivate: vi.fn()
	};
	return ext satisfies Extension;
}

function makeHost(extensions: Extension[], platform: ExtensionPlatform = 'web') {
	const events = new EventEmitter();
	const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
	const host = new ExtensionHost({
		extensions,
		platform,
		events,
		storage: localStorage,
		getProjectTitle: async () => 'P',
		getProjectCharCount: async () => 42,
		notify
	});
	return { host, events, notify };
}

/** 同意して有効にする(同意画面の「同意して有効にする」と同じ手順) */
async function enable(host: ExtensionHost, id: string) {
	await host.grantConsent(id);
	return host.setEnabled(id, true);
}

beforeEach(() => localStorage.clear());

describe('ExtensionHost', () => {
	it('既定はすべて無効で、start しても何も activate しない', async () => {
		const ext = makeExt('a');
		const { host } = makeHost([ext]);
		await host.start();
		expect(host.isEnabled('a')).toBe(false);
		expect(ext.activate).not.toHaveBeenCalled();
	});

	it('有効にすると localStorage に保存され、activate される。無効にすると deactivate される', async () => {
		const ext = makeExt('a');
		const { host } = makeHost([ext]);
		await host.start();
		await enable(host, 'a');
		expect(ext.activate).toHaveBeenCalledTimes(1);
		expect(host.isActive('a')).toBe(true);
		expect(JSON.parse(localStorage.getItem(ENABLED_STORAGE_KEY)!)).toEqual(['a']);

		await host.setEnabled('a', false);
		expect(ext.deactivate).toHaveBeenCalledTimes(1);
		expect(host.isActive('a')).toBe(false);
		expect(JSON.parse(localStorage.getItem(ENABLED_STORAGE_KEY)!)).toEqual([]);
	});

	it('起動時は、保存された有効な拡張だけ activate する', async () => {
		localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify(['a']));
		const a = makeExt('a');
		const b = makeExt('b');
		const { host } = makeHost([a, b]);
		await host.start();
		expect(a.activate).toHaveBeenCalledTimes(1);
		expect(b.activate).not.toHaveBeenCalled();
	});

	it('非対応のプラットフォームでは、有効にできず activate もされない', async () => {
		localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify(['d']));
		const d = makeExt('d', ['desktop']);
		const { host } = makeHost([d], 'web');
		expect(host.isSupported('d')).toBe(false);
		await host.start();
		await enable(host, 'd');
		expect(d.activate).not.toHaveBeenCalled();
	});

	it('壊れた保存値や localStorage の失敗でも動く', async () => {
		localStorage.setItem(ENABLED_STORAGE_KEY, '{oops');
		const ext = makeExt('a');
		const { host } = makeHost([ext]);
		expect(host.isEnabled('a')).toBe(false);
		const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await host.start();
		await enable(host, 'a');
		expect(ext.activate).toHaveBeenCalled();
		spy.mockRestore();
		warn.mockRestore();
	});

	it('activate が失敗したら有効扱いにせず通知する', async () => {
		const ext = makeExt('a');
		ext.activate.mockRejectedValue(new Error('x'));
		const { host, notify } = makeHost([ext]);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await host.start();
		await enable(host, 'a');
		expect(host.isActive('a')).toBe(false);
		expect(notify.error).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('拡張に渡す context は購読専用で、emit は見えない', async () => {
		const ext = makeExt('a');
		const { host } = makeHost([ext]);
		await host.start();
		await enable(host, 'a');
		const ctx = ext.activate.mock.calls[0][0];
		expect('emit' in ctx.events).toBe(false);
	});
});

describe('権限(permissions)', () => {
	const sessionEvent = {
		sessionId: 's',
		startedAt: 1,
		lastEditAt: 2,
		endedAt: null,
		netChars: 5,
		projectId: 'p',
		projectTitle: '月の庭'
	};

	it('宣言していないイベントは購読できない(例外)。宣言したものは購読できる', async () => {
		const ext = makeExt('a', ['web', 'desktop'], { permissions: { events: ['scene:created'] } });
		const { host, events } = makeHost([ext]);
		await host.start();
		await enable(host, 'a');
		const ctx = ext.activate.mock.calls[0][0];
		expect(() => ctx.events.on('scene:updated', () => {})).toThrow(/scene:updated/);
		expect(() => ctx.events.on('session:start', () => {})).toThrow();
		const handler = vi.fn();
		ctx.events.on('scene:created', handler);
		events.emit('scene:created', { sceneId: 's', chapterId: 'c', projectId: 'p' });
		expect(handler).toHaveBeenCalled();
	});

	it('作品名は project:title を宣言した拡張にだけ渡す(セッションのイベントからも外す)', async () => {
		const withTitle = makeExt('a', ['web', 'desktop'], {
			permissions: { events: ['session:start'], read: ['project:title'] }
		});
		const without = makeExt('b', ['web', 'desktop'], {
			permissions: { events: ['session:start'] }
		});
		const { host, events } = makeHost([withTitle, without]);
		await host.start();
		await enable(host, 'a');
		await enable(host, 'b');
		const a = withTitle.activate.mock.calls[0][0];
		const b = without.activate.mock.calls[0][0];
		const gotA = vi.fn();
		const gotB = vi.fn();
		a.events.on('session:start', gotA);
		b.events.on('session:start', gotB);
		events.emit('session:start', sessionEvent);
		expect(gotA).toHaveBeenCalledWith(expect.objectContaining({ projectTitle: '月の庭' }));
		expect(gotB.mock.calls[0][0]).not.toHaveProperty('projectTitle');
		expect(gotB.mock.calls[0][0]).toMatchObject({ netChars: 5, sessionId: 's' });
		expect(await a.getProjectTitle('p')).toBe('P');
		expect(await b.getProjectTitle('p')).toBeUndefined();
	});

	it('総文字数は project:chars を宣言した拡張にだけ渡す', async () => {
		const yes = makeExt('a', ['web', 'desktop'], { permissions: { read: ['project:chars'] } });
		const no = makeExt('b');
		const { host } = makeHost([yes, no]);
		await host.start();
		await enable(host, 'a');
		await enable(host, 'b');
		expect(await yes.activate.mock.calls[0][0].getProjectCharCount('p')).toBe(42);
		expect(await no.activate.mock.calls[0][0].getProjectCharCount('p')).toBeUndefined();
	});
});

describe('同意', () => {
	it('同意が無いと有効にできない(setEnabled は false)。同意すると有効にできる', async () => {
		const ext = makeExt('a');
		const { host } = makeHost([ext]);
		await host.start();
		expect(host.consentStatus('a')).toBe('none');
		expect(await host.setEnabled('a', true)).toBe(false);
		expect(host.isEnabled('a')).toBe(false);
		expect(ext.activate).not.toHaveBeenCalled();

		await host.grantConsent('a');
		expect(host.consentStatus('a')).toBe('current');
		expect(await host.setEnabled('a', true)).toBe(true);
		expect(ext.activate).toHaveBeenCalledTimes(1);
		const saved = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!);
		expect(saved.a).toMatchObject({ version: '1.0.0', fingerprint: expect.any(String) });
	});

	it('無効にすると同意の記録を消す(次に有効にするときは、もう一度同意)', async () => {
		const { host } = makeHost([makeExt('a')]);
		await host.start();
		await enable(host, 'a');
		await host.setEnabled('a', false);
		expect(host.consentStatus('a')).toBe('none');
		expect(await host.setEnabled('a', true)).toBe(false);
	});

	it('同意画面ができる前から有効だった拡張は、起動時にそのまま動かし、確認を促す(無効にしない)', async () => {
		localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify(['a']));
		const ext = makeExt('a');
		const { host, notify } = makeHost([ext]);
		await host.start();
		expect(ext.activate).toHaveBeenCalledTimes(1);
		expect(host.isEnabled('a')).toBe(true);
		expect(host.needsReview('a')).toBe(true);
		expect(host.isSuspended('a')).toBe(false);
		expect(notify.info).not.toHaveBeenCalled();
		await host.grantConsent('a');
		expect(host.needsReview('a')).toBe(false);
		expect(ext.activate).toHaveBeenCalledTimes(1);
	});

	function consentedHost(before: Extension, after: Extension) {
		// 同意を記録してから、マニフェストが変わった状態で起動し直す
		localStorage.clear();
		const first = makeHost([before]);
		return first.host.grantConsent(before.manifest.id).then(() => {
			localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify([before.manifest.id]));
			return makeHost([after]);
		});
	}

	it('版だけが変わったときは、動かしたまま確認を促す', async () => {
		const { host } = await consentedHost(
			makeExt('a'),
			makeExt('a', ['web', 'desktop'], { version: '1.1.0' })
		);
		expect(host.consentStatus('a')).toBe('version-changed');
		await host.start();
		expect(host.isActive('a')).toBe(true);
		expect(host.needsReview('a')).toBe(true);
	});

	it('扱う情報(permissions / privacy)が変わったときは、確認されるまで動かさず通知する。同意すると再開する', async () => {
		const changed = makeExt('a', ['web', 'desktop'], {
			version: '2.0.0',
			privacy: { sends: [{ to: 'x.example', items: ['i'], when: 'w' }], stores: [], onDisable: 'o' }
		});
		const { host, notify } = await consentedHost(makeExt('a'), changed);
		expect(host.consentStatus('a')).toBe('changed');
		await host.start();
		expect(changed.activate).not.toHaveBeenCalled();
		expect(host.isEnabled('a')).toBe(true);
		expect(host.isSuspended('a')).toBe(true);
		expect(notify.info).toHaveBeenCalledTimes(1);
		await host.grantConsent('a');
		expect(host.isSuspended('a')).toBe(false);
		expect(changed.activate).toHaveBeenCalledTimes(1);
	});

	it('permissions のキーの順序が違うだけでは、変わったとみなさない', async () => {
		const a = makeExt('a', ['web', 'desktop'], {
			permissions: { storage: true, events: ['scene:created'] }
		});
		const b = makeExt('a', ['web', 'desktop'], {
			permissions: { events: ['scene:created'], storage: true }
		});
		const { host } = await consentedHost(a, b);
		expect(host.consentStatus('a')).toBe('current');
	});

	it('壊れた同意の記録でも動く(同意なしとして扱う)', () => {
		localStorage.setItem(CONSENT_STORAGE_KEY, '{oops');
		const { host } = makeHost([makeExt('a')]);
		expect(host.consentStatus('a')).toBe('none');
	});
});

describe('セッション API', () => {
	it('endNow は本体のセッションを manual で終了する', async () => {
		const ext = makeExt('a');
		const events = new EventEmitter();
		const end = vi.fn(() => true);
		const host = new ExtensionHost({
			extensions: [ext],
			platform: 'web',
			events,
			session: { current: () => null, end },
			storage: localStorage,
			getProjectTitle: async () => undefined,
			notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
		});
		await host.start();
		await enable(host, 'a');
		expect(ext.activate.mock.calls[0][0].session.endNow()).toBe(true);
		expect(end).toHaveBeenCalledWith('manual');
	});
});

describe('ExtensionHost.toolbarItems', () => {
	const panel = (() => {}) as unknown as NonNullable<Extension['toolbar']>['panel'];
	function withToolbar(id: string, platforms: ExtensionPlatform[] = ['web', 'desktop']) {
		const ext = makeExt(id, platforms);
		return Object.assign(ext, {
			toolbar: { id, label: `${id}-label`, icon: 'clock', panel }
		}) satisfies Extension;
	}

	it('有効で対応する拡張の項目だけを、ext:<id> の項目 ID で返す', async () => {
		const a = withToolbar('a');
		const b = withToolbar('b');
		const c = makeExt('c');
		const { host } = makeHost([a, b, c]);
		expect(host.toolbarItems).toEqual([]);

		await enable(host, 'a');
		await enable(host, 'c');
		const items = host.toolbarItems;
		expect(items.map((i) => i.itemId)).toEqual(['ext:a']);
		expect(items[0]).toMatchObject({ extensionId: 'a', label: 'a-label', icon: 'clock' });
	});

	it('無効にすると消える', async () => {
		const { host } = makeHost([withToolbar('a')]);
		await enable(host, 'a');
		expect(host.toolbarItems).toHaveLength(1);
		await host.setEnabled('a', false);
		expect(host.toolbarItems).toEqual([]);
	});

	it('非対応のプラットフォームでは、有効が保存されていても出さない', () => {
		localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify(['d']));
		const { host } = makeHost([withToolbar('d', ['desktop'])], 'web');
		expect(host.toolbarItems).toEqual([]);
	});
});

describe('パックの追加・更新・取り除き', () => {
	const pack = (id: string, over: Partial<ExtensionManifest> = {}) =>
		makeExt(id, ['web', 'desktop'], { kind: 'pack', ...over });

	it('起動後に追加したパックも、同意して有効にすれば activate される', async () => {
		const { host } = makeHost([]);
		await host.start();
		const p = pack('p');
		expect(await host.addExtension(p)).toBe(true);
		expect(host.extensions.map((e) => e.manifest.id)).toEqual(['p']);
		expect(p.activate).not.toHaveBeenCalled();
		await enable(host, 'p');
		expect(p.activate).toHaveBeenCalledTimes(1);
	});

	it('公式の拡張を、パックで置き換えたり取り除いたりできない', async () => {
		const official = makeExt('o');
		const { host } = makeHost([official]);
		await host.start();
		expect(await host.addExtension(pack('o'))).toBe(false);
		expect(await host.addExtension(makeExt('x'))).toBe(false);
		expect(await host.removeExtension('o')).toBe(false);
		expect(host.extensions).toHaveLength(1);
	});

	it('更新で扱う情報が同じなら、止めずに新しい版へ入れ替える', async () => {
		const { host } = makeHost([]);
		await host.start();
		const v1 = pack('p');
		await host.addExtension(v1);
		await enable(host, 'p');
		const v2 = pack('p', { version: '1.1.0' });
		await host.addExtension(v2);
		expect(v1.deactivate).toHaveBeenCalledTimes(1);
		expect(v2.activate).toHaveBeenCalledTimes(1);
		expect(host.consentStatus('p')).toBe('version-changed');
		expect(host.isSuspended('p')).toBe(false);
	});

	it('更新で扱う情報が変わったら、再同意まで動かさない', async () => {
		const { host, notify } = makeHost([]);
		await host.start();
		await host.addExtension(pack('p'));
		await enable(host, 'p');
		const v2 = pack('p', {
			version: '2.0.0',
			privacy: { sends: [], stores: ['新しく保存するもの'], onDisable: '消えます' }
		});
		await host.addExtension(v2);
		expect(host.consentStatus('p')).toBe('changed');
		expect(host.isSuspended('p')).toBe(true);
		expect(v2.activate).not.toHaveBeenCalled();
		expect(notify.info).toHaveBeenCalled();
		await host.grantConsent('p');
		expect(v2.activate).toHaveBeenCalledTimes(1);
	});

	it('取り除くと、無効化・同意の記録の削除・一覧からの削除が行われる', async () => {
		const { host } = makeHost([]);
		await host.start();
		const p = pack('p');
		await host.addExtension(p);
		await enable(host, 'p');
		expect(await host.removeExtension('p')).toBe(true);
		expect(p.deactivate).toHaveBeenCalled();
		expect(host.extensions).toHaveLength(0);
		expect(host.isEnabled('p')).toBe(false);
		expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) ?? '{}')).toEqual({});
	});

	it('start より前に追加したパックは、有効なら start で activate される', async () => {
		localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify(['p']));
		const { host } = makeHost([]);
		const p = pack('p');
		await host.addExtension(p);
		expect(p.activate).not.toHaveBeenCalled();
		await host.start();
		expect(p.activate).toHaveBeenCalledTimes(1);
	});
});

describe('失効(キルスイッチ)', () => {
	const entry = (over = {}) => ({
		id: 'bad',
		versions: '*' as const,
		reason: '情報を不正に送っていた',
		at: '2026-11-12',
		...over
	});

	it('失効の一覧を反映すると、該当する有効な拡張はすぐ無効になり、理由が返る', async () => {
		const ext = makeExt('bad', ['web'], { kind: 'pack' });
		const other = makeExt('good', ['web'], { kind: 'pack' });
		const { host } = makeHost([ext, other]);
		await host.start();
		await enable(host, 'bad');
		await enable(host, 'good');
		const disabled = await host.applyRevocations([entry()]);
		expect(disabled).toEqual([{ name: 'bad', reason: '情報を不正に送っていた' }]);
		expect(host.isEnabled('bad')).toBe(false);
		expect(host.isActive('bad')).toBe(false);
		expect(ext.deactivate).toHaveBeenCalled();
		expect(host.isEnabled('good')).toBe(true);
		expect(host.revocationOf('bad')?.reason).toContain('不正');
	});

	it('失効した拡張は、同意しても有効にできない', async () => {
		const ext = makeExt('bad', ['web'], { kind: 'pack' });
		const { host } = makeHost([ext]);
		await host.applyRevocations([entry()]);
		expect(await enable(host, 'bad')).toBe(false);
		expect(host.isEnabled('bad')).toBe(false);
	});

	it('版を指定した失効は、その版だけ。別の版に更新すれば有効にできる', async () => {
		const v1 = makeExt('bad', ['web'], { kind: 'pack', version: '1.0.0' });
		const { host } = makeHost([v1]);
		await host.applyRevocations([entry({ versions: ['1.0.0'] })]);
		expect(host.revocationOf('bad')).toBeDefined();
		const v2 = makeExt('bad', ['web'], { kind: 'pack', version: '1.0.1' });
		await host.addExtension(v2);
		expect(host.revocationOf('bad')).toBeUndefined();
		expect(await enable(host, 'bad')).toBe(true);
	});

	it('失効の一覧は保存され、再起動しても動かさない。一覧から消えれば解除される', async () => {
		const ext = makeExt('bad', ['web'], { kind: 'pack' });
		const first = makeHost([ext]);
		await first.host.start();
		await enable(first.host, 'bad');
		await first.host.applyRevocations([entry()]);

		const again = makeExt('bad', ['web'], { kind: 'pack' });
		localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify(['bad']));
		const second = makeHost([again]);
		await second.host.start();
		expect(again.activate).not.toHaveBeenCalled();
		expect(second.host.isEnabled('bad')).toBe(false);

		await second.host.applyRevocations([]);
		expect(second.host.revocationOf('bad')).toBeUndefined();
	});

	it('公式の拡張は、失効の一覧に載っていても止めない', async () => {
		const ext = makeExt('official-one');
		const { host } = makeHost([ext]);
		await host.start();
		await enable(host, 'official-one');
		expect(await host.applyRevocations([entry({ id: 'official-one' })])).toEqual([]);
		expect(host.isEnabled('official-one')).toBe(true);
	});

	it('スクリプトとパックは後から足し引きできる', async () => {
		const { host } = makeHost([]);
		const script = makeExt('s', ['web'], { kind: 'script' });
		expect(await host.addExtension(script)).toBe(true);
		expect(await host.addExtension(makeExt('o', ['web'], { kind: 'official' }))).toBe(false);
		expect(await host.removeExtension('s')).toBe(true);
	});
});
