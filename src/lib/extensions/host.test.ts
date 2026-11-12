import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './events';
import { ENABLED_STORAGE_KEY, ExtensionHost } from './host.svelte';
import type { Extension, ExtensionPlatform } from './types';

function makeExt(id: string, platforms: ExtensionPlatform[] = ['web', 'desktop']) {
	const ext = {
		manifest: { id, name: id, description: '', platforms },
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
		notify
	});
	return { host, events, notify };
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
		await host.setEnabled('a', true);
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
		await host.setEnabled('d', true);
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
		await host.setEnabled('a', true);
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
		await host.setEnabled('a', true);
		expect(host.isActive('a')).toBe(false);
		expect(notify.error).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('拡張に渡す context は購読専用で、emit は見えない', async () => {
		const ext = makeExt('a');
		const { host, events } = makeHost([ext]);
		await host.start();
		await host.setEnabled('a', true);
		const ctx = ext.activate.mock.calls[0][0];
		expect('emit' in ctx.events).toBe(false);
		const handler = vi.fn();
		ctx.events.on('scene:created', handler);
		events.emit('scene:created', { sceneId: 's', chapterId: 'c', projectId: 'p' });
		expect(handler).toHaveBeenCalled();
		expect(await ctx.getProjectTitle('p')).toBe('P');
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

		await host.setEnabled('a', true);
		await host.setEnabled('c', true);
		const items = host.toolbarItems;
		expect(items.map((i) => i.itemId)).toEqual(['ext:a']);
		expect(items[0]).toMatchObject({ extensionId: 'a', label: 'a-label', icon: 'clock' });
	});

	it('無効にすると消える', async () => {
		const { host } = makeHost([withToolbar('a')]);
		await host.setEnabled('a', true);
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
