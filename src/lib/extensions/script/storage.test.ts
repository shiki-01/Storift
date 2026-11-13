import { describe, expect, it } from 'vitest';
import { SCRIPT_LIMITS } from './limits';
import {
	ScriptStorage,
	deleteExtensionData,
	usedBytes,
	type ScriptStorageBackend
} from './storage';

function memory(): ScriptStorageBackend & { data: Map<string, Record<string, string>> } {
	const data = new Map<string, Record<string, string>>();
	return {
		data,
		read: async (id) => data.get(id),
		write: async (id, items) => void data.set(id, items),
		remove: async (id) => void data.delete(id)
	};
}

describe('ScriptStorage', () => {
	it('JSON の値を保存・取得・削除・一覧できる', async () => {
		const s = new ScriptStorage('a', memory());
		await s.set('k1', { n: 1 });
		await s.set('k2', 'v');
		await s.set('x', [1, 2]);
		expect(await s.get('k1')).toEqual({ n: 1 });
		expect(await s.get('none')).toBeNull();
		expect(await s.list('k')).toEqual(['k1', 'k2']);
		await s.delete('k1');
		expect(await s.list()).toEqual(['k2', 'x']);
	});

	it('拡張ごとの名前空間で、ほかの拡張の値は見えない。削除で消える', async () => {
		const backend = memory();
		const a = new ScriptStorage('a', backend);
		const b = new ScriptStorage('b', backend);
		await a.set('secret', 1);
		expect(await b.get('secret')).toBeNull();
		await deleteExtensionData('a', backend);
		expect(backend.data.has('a')).toBe(false);
		expect(await a.get('secret')).toBeNull();
	});

	it('値・合計・キー数の上限を超える書き込みを拒否する', async () => {
		const s = new ScriptStorage('a', memory());
		await expect(
			s.set('big', 'x'.repeat(SCRIPT_LIMITS.storageValueBytes + 10))
		).rejects.toMatchObject({
			code: 'quota'
		});
		let ok = 0;
		for (let i = 0; i < 10; i++) {
			try {
				await s.set(`k${i}`, 'x'.repeat(60_000));
				ok++;
			} catch (error) {
				expect(error).toMatchObject({ code: 'quota' });
				break;
			}
		}
		expect(ok).toBe(4);
		const backend = memory();
		const many = new ScriptStorage('m', backend);
		for (let i = 0; i < SCRIPT_LIMITS.storageKeys; i++) await many.set(`k${i}`, 1);
		await expect(many.set('overflow', 1)).rejects.toMatchObject({ code: 'quota' });
		await many.set('k0', 2);
		expect(usedBytes(backend.data.get('m')!)).toBeLessThanOrEqual(SCRIPT_LIMITS.storageTotalBytes);
	});

	it('同時の書き込みでも上限を超えない', async () => {
		const backend = memory();
		const s = new ScriptStorage('a', backend);
		const results = await Promise.allSettled(
			Array.from({ length: 10 }, (_, i) => s.set(`k${i}`, 'x'.repeat(60_000)))
		);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
		expect(usedBytes(backend.data.get('a')!)).toBeLessThanOrEqual(SCRIPT_LIMITS.storageTotalBytes);
	});

	it('キーの形と、JSON で表せない値を拒否する', async () => {
		const s = new ScriptStorage('a', memory());
		await expect(s.get('')).rejects.toMatchObject({ code: 'invalid' });
		await expect(s.get('a'.repeat(100))).rejects.toMatchObject({ code: 'invalid' });
		await expect(s.get('a\nb')).rejects.toMatchObject({ code: 'invalid' });
		await expect(s.get(1)).rejects.toMatchObject({ code: 'invalid' });
		await expect(s.set('f', () => 1)).rejects.toMatchObject({ code: 'invalid' });
		await expect(s.set('u', undefined)).rejects.toMatchObject({ code: 'invalid' });
	});

	it('__proto__ などのキーでも、プロトタイプを汚さない', async () => {
		const s = new ScriptStorage('a', memory());
		await s.set('__proto__', { polluted: true });
		await s.set('constructor', 1);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(await s.get('__proto__')).toEqual({ polluted: true });
	});
});
