import { describe, expect, it } from 'vitest';
import {
	REGISTRY_INDEX_URL,
	bundlePath,
	compareVersions,
	isRegistryUrl,
	sha256Hex,
	toRegistryEntry,
	validateRegistryIndex
} from './registryIndex';
import type { ExtensionManifest } from './manifest';

const manifest: ExtensionManifest = {
	id: 'my-pack',
	name: 'P',
	description: 'd',
	version: '1.2.3',
	author: 'a',
	kind: 'pack',
	apiVersion: 1,
	platforms: ['web', 'desktop'],
	icon: 'puzzle',
	license: 'MIT',
	updatedAt: '2026-11-12',
	permissions: { storage: true },
	privacy: { sends: [], stores: ['端末内'], onDisable: '止まる' },
	contributions: { themes: ['t.json'] }
};

describe('isRegistryUrl', () => {
	it('storift.shiki-01.com のレジストリ配下の https だけを許す', () => {
		expect(isRegistryUrl(REGISTRY_INDEX_URL)).toBe(true);
		expect(
			isRegistryUrl('https://storift.shiki-01.com/extensions-registry/a/1.0.0.storiftext.json')
		).toBe(true);
		for (const bad of [
			'http://storift.shiki-01.com/extensions-registry/index.json',
			'https://evil.example.com/extensions-registry/index.json',
			'https://storift.shiki-01.com.evil.com/extensions-registry/index.json',
			'https://evil.com/@storift.shiki-01.com/extensions-registry/index.json',
			'https://user@storift.shiki-01.com/extensions-registry/index.json',
			'https://storift.shiki-01.com:8443/extensions-registry/index.json',
			'https://storift.shiki-01.com/other/index.json',
			'https://storift.shiki-01.com/extensions-registry/../x.json',
			'https://storift.shiki-01.com/extensions-registry/index.json?x=1',
			'//storift.shiki-01.com/extensions-registry/index.json',
			'javascript:alert(1)',
			'file:///etc/passwd',
			'not a url'
		]) {
			expect(isRegistryUrl(bad), bad).toBe(false);
		}
	});
});

describe('toRegistryEntry / validateRegistryIndex', () => {
	it('パックの項目を作り、検証を通る', () => {
		const entry = toRegistryEntry(manifest, 'community', { sha256: 'a'.repeat(64), size: 1234 });
		expect(entry.bundle).toBe(`https://storift.shiki-01.com${bundlePath('my-pack', '1.2.3')}`);
		expect(entry.contributes).toEqual(['themes']);
		expect(entry.updatedAt).toBe('2026-11-12');
		const result = validateRegistryIndex({ indexVersion: 1, extensions: [entry] });
		expect(result.ok && result.index.extensions).toEqual([entry]);
	});

	it('公式はバンドルを持たない', () => {
		const official = toRegistryEntry(
			{ ...manifest, kind: 'official', id: 'monolog' },
			'official',
			null
		);
		expect(official.bundle).toBeNull();
		expect(validateRegistryIndex({ indexVersion: 1, extensions: [official] }).ok).toBe(true);
	});

	it('壊れた項目・許可されない URL の項目は捨てる。形式の版が違えば失敗', () => {
		const good = toRegistryEntry(manifest, 'community', { sha256: 'a'.repeat(64), size: 10 });
		const badUrl = {
			...good,
			id: 'x',
			bundle: 'https://evil.example.com/extensions-registry/x.json'
		};
		const badHash = { ...good, id: 'y', sha256: 'zz' };
		const result = validateRegistryIndex({
			indexVersion: 1,
			extensions: [good, badUrl, badHash, null, { id: 1 }, good]
		});
		expect(result.ok && result.index.extensions.map((e) => e.id)).toEqual(['my-pack']);
		expect(validateRegistryIndex({ indexVersion: 2, extensions: [] }).ok).toBe(false);
		expect(validateRegistryIndex({ indexVersion: 1 }).ok).toBe(false);
		expect(validateRegistryIndex('x').ok).toBe(false);
	});
});

describe('compareVersions', () => {
	it('semver の大小を比べる', () => {
		expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
		expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
		expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
		expect(compareVersions('1.0.0', '1.0.0+build')).toBe(0);
		expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
	});
});

describe('sha256Hex', () => {
	it('既知の値と一致する', async () => {
		expect(await sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});
