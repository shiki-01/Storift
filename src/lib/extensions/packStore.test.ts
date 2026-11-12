import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db';
import { createFullBackup } from '$lib/services/backup.service';
import {
	PACK_DB_NAME,
	deleteInstalledPack,
	listInstalledPacks,
	requestPersistence,
	resetPackStore,
	saveInstalledPack,
	type InstalledPackRecord
} from './packStore';
import type { ExtensionManifest } from './manifest';

const manifest = { id: 'my-pack', kind: 'pack' } as unknown as ExtensionManifest;
const record = (id: string, installedAt: number): InstalledPackRecord => ({
	id,
	manifest: { ...manifest, id },
	files: { 'k.json': { secret: 'PACK-MARKER' } },
	origin: 'community',
	size: 10,
	installedAt
});

beforeEach(async () => {
	resetPackStore();
	for (const r of await listInstalledPacks()) await deleteInstalledPack(r.id);
});

describe('packStore', () => {
	it('保存・一覧(入れた順)・削除ができる', async () => {
		await saveInstalledPack(record('b-pack', 2));
		await saveInstalledPack(record('a-pack', 1));
		expect((await listInstalledPacks()).map((r) => r.id)).toEqual(['a-pack', 'b-pack']);
		await deleteInstalledPack('a-pack');
		expect((await listInstalledPacks()).map((r) => r.id)).toEqual(['b-pack']);
	});

	it('persist が使えない・断られても例外にしない', async () => {
		expect(await requestPersistence()).toBe(false);
		Object.defineProperty(navigator, 'storage', {
			configurable: true,
			value: { persist: vi.fn(async () => false), persisted: vi.fn(async () => false) }
		});
		expect(await requestPersistence()).toBe(false);
		Object.defineProperty(navigator, 'storage', {
			configurable: true,
			value: {
				persist: vi.fn(async () => {
					throw new Error('x');
				})
			}
		});
		expect(await requestPersistence()).toBe(false);
		Object.defineProperty(navigator, 'storage', {
			configurable: true,
			value: { persist: vi.fn(async () => true), persisted: vi.fn(async () => false) }
		});
		expect(await requestPersistence()).toBe(true);
	});
});

// パックは、同期(Firestore)・バックアップ・書き出しに含めない。メインの DB とは別の IndexedDB に置くことで担保する
describe('パックはメインの DB・バックアップ・同期・書き出しに含まれない', () => {
	it('別のデータベース(storift-extensions)に保存され、メインの DB にそのテーブルが無い', async () => {
		await saveInstalledPack(record('my-pack', 1));
		const names = (await indexedDB.databases()).map((d) => d.name);
		expect(names).toContain(PACK_DB_NAME);
		expect(PACK_DB_NAME).not.toBe(db.name);
		expect(db.tables.map((t) => t.name)).not.toContain('packs');
		expect(db.tables.map((t) => t.name)).not.toContain('extensions');
	});

	it('全データのバックアップに、パックの内容が入らない', async () => {
		await saveInstalledPack(record('my-pack', 1));
		const backup = JSON.stringify(await createFullBackup());
		expect(backup).not.toContain('PACK-MARKER');
		expect(backup).not.toContain('my-pack');
	});

	it('バックアップ・同期・書き出しのコードが、パックの保存先を参照しない', () => {
		const root = resolve(__dirname, '../..');
		const files = [
			'lib/services/backup.service.ts',
			'lib/services/export.service.ts',
			'lib/services/sync.service.ts',
			'lib/services/import.service.ts',
			'lib/firebase/syncTarget.ts'
		];
		for (const file of files) {
			const source = readFileSync(resolve(root, file), 'utf8');
			expect(source, file).not.toMatch(/packStore|storift-extensions|installedPack/i);
		}
	});
});
