import { beforeEach, describe, expect, it, vi } from 'vitest';

let checkImpl: () => Promise<unknown> = async () => null;
const relaunch = vi.fn(async () => {});

vi.mock('$lib/desktop/platform', () => ({ isDesktop: () => true }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => checkImpl() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => relaunch() }));

const { updaterStore } = await import('./updater.svelte');
const { toastStore } = await import('./toast.svelte');

type Event =
	| { event: 'Started'; data: { contentLength?: number } }
	| { event: 'Progress'; data: { chunkLength: number } }
	| { event: 'Finished' };

function fakeUpdate(version: string, events: Event[] = [], fail = false) {
	return {
		version,
		body: '変更点',
		downloadAndInstall: async (on: (e: Event) => void) => {
			for (const e of events) on(e);
			if (fail) throw new Error('署名が合いません');
		}
	};
}

describe('updaterStore', () => {
	beforeEach(() => {
		checkImpl = async () => null;
		relaunch.mockClear();
	});

	it('新しい版がなければ uptodate になる', async () => {
		expect(await updaterStore.check(true)).toBe(false);
		expect(updaterStore.status).toBe('uptodate');
	});

	it('新しい版があれば available になり、版と変更点を持つ', async () => {
		checkImpl = async () => fakeUpdate('1.2.3');
		expect(await updaterStore.check(true)).toBe(true);
		expect(updaterStore.status).toBe('available');
		expect(updaterStore.version).toBe('1.2.3');
		expect(updaterStore.notes).toBe('変更点');
	});

	it('自動確認(silent)では、同じ版を何度も通知しない', async () => {
		checkImpl = async () => fakeUpdate('2.0.0');
		const count = () => toastStore.items.filter((t) => t.message.includes('2.0.0')).length;
		await updaterStore.check(true);
		const first = count();
		await updaterStore.check(true);
		expect(first).toBe(1);
		expect(count()).toBe(1);
	});

	it('確認に失敗したら error になる', async () => {
		checkImpl = async () => {
			throw new Error('network');
		};
		expect(await updaterStore.check(true)).toBe(false);
		expect(updaterStore.status).toBe('error');
		expect(updaterStore.error).toBe('network');
	});

	it('更新は進み具合を持ち、入れ終わると ready になる。再起動できる', async () => {
		checkImpl = async () =>
			fakeUpdate('3.0.0', [
				{ event: 'Started', data: { contentLength: 100 } },
				{ event: 'Progress', data: { chunkLength: 40 } },
				{ event: 'Finished' }
			]);
		await updaterStore.check(true);
		await updaterStore.install();
		expect(updaterStore.status).toBe('ready');
		expect(updaterStore.progress).toBe(1);
		// 「18.8 / 44.8 MB」の表示に使うバイト数
		expect(updaterStore.receivedBytes).toBe(40);
		expect(updaterStore.totalBytes).toBe(100);
		await updaterStore.restart();
		expect(relaunch).toHaveBeenCalledOnce();
	});
});
