import { describe, expect, it, vi } from 'vitest';
import { RegistryError, fetchBundle, fetchRegistryIndex } from './registryClient';
import { buildBundle, serializeBundle } from './pack';
import { sha256Hex, toRegistryEntry, REGISTRY_INDEX_URL } from './registryIndex';
import type { ExtensionManifest } from './manifest';

const manifest: ExtensionManifest = {
	id: 'my-pack',
	name: 'P',
	description: 'd',
	version: '1.0.0',
	author: 'a',
	kind: 'pack',
	apiVersion: 1,
	platforms: ['web'],
	icon: 'puzzle',
	license: 'MIT',
	updatedAt: '2026-11-12',
	permissions: { storage: true },
	privacy: { sends: [], stores: ['端末内'], onDisable: '止まる' },
	contributions: { assistKeys: ['k.json'] }
};
const files = { 'k.json': { id: 'k', name: 'キー', keys: [{ text: '※' }] } };

async function setup(patch: { text?: string } = {}) {
	const text = patch.text ?? serializeBundle(buildBundle(manifest, files));
	const entry = toRegistryEntry(manifest, 'community', {
		sha256: await sha256Hex(text),
		size: new TextEncoder().encode(text).length
	});
	return { text, entry };
}

const ok = (body: string, headers: Record<string, string> = {}) =>
	new Response(body, { status: 200, headers });

describe('fetchBundle', () => {
	it('SHA-256 が一致し、マニフェストが一覧と合えば取得できる', async () => {
		const { text, entry } = await setup();
		const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => ok(text));
		const result = await fetchBundle(entry, fetchFn);
		expect(result.manifest.id).toBe('my-pack');
		expect(result.sha256).toBe(entry.sha256);
		expect(result.content.assistKeys[0].keys[0].text).toBe('※');
		const init = fetchFn.mock.calls[0][1] as RequestInit;
		expect(init.credentials).toBe('omit');
		expect(init.redirect).toBe('error');
	});

	it('SHA-256 が違えば拒否する(改ざん・差し替え)', async () => {
		const { text, entry } = await setup();
		await expect(fetchBundle(entry, async () => ok(text.replace('※', '＊')))).rejects.toMatchObject(
			{ kind: 'integrity' }
		);
	});

	it('ハッシュが合っても、マニフェストが不正なら拒否する', async () => {
		const bad = { ...manifest, permissions: { network: ['evil.example.com'] } };
		const text = serializeBundle(buildBundle(bad, files));
		const { entry } = await setup({ text });
		await expect(fetchBundle(entry, async () => ok(text))).rejects.toMatchObject({
			kind: 'format'
		});
	});

	it('一覧の ID・版とバンドルが食い違えば拒否する', async () => {
		const other = serializeBundle(buildBundle({ ...manifest, version: '9.9.9' }, files));
		const entry = toRegistryEntry(manifest, 'community', {
			sha256: await sha256Hex(other),
			size: other.length
		});
		await expect(fetchBundle(entry, async () => ok(other))).rejects.toMatchObject({
			kind: 'integrity'
		});
	});

	it('許可されない取得先・公式(バンドル無し)は取得しない', async () => {
		const { entry } = await setup();
		const fetchFn = vi.fn();
		await expect(
			fetchBundle(
				{ ...entry, bundle: 'https://evil.example.com/extensions-registry/a.json' },
				fetchFn
			)
		).rejects.toMatchObject({ kind: 'blocked' });
		await expect(fetchBundle({ ...entry, bundle: null }, fetchFn)).rejects.toBeInstanceOf(
			RegistryError
		);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('ネットワークの失敗・HTTP エラー・大きすぎる応答', async () => {
		const { entry } = await setup();
		await expect(
			fetchBundle(entry, async () => {
				throw new TypeError('Failed to fetch');
			})
		).rejects.toMatchObject({ kind: 'offline' });
		await expect(
			fetchBundle(entry, async () => new Response('', { status: 404 }))
		).rejects.toMatchObject({ kind: 'http' });
		await expect(
			fetchBundle(entry, async () => ok('x'.repeat(2 * 1024 * 1024)))
		).rejects.toMatchObject({ kind: 'format' });
	});
});

describe('fetchRegistryIndex', () => {
	it('一覧を取得して検証する', async () => {
		const { entry } = await setup();
		const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
			ok(JSON.stringify({ indexVersion: 1, extensions: [entry] }))
		);
		const index = await fetchRegistryIndex(fetchFn);
		expect(index.extensions).toHaveLength(1);
		expect(fetchFn.mock.calls[0][0]).toBe(REGISTRY_INDEX_URL);
	});

	it('壊れた JSON・形式の違いでも例外は RegistryError', async () => {
		await expect(fetchRegistryIndex(async () => ok('<html>'))).rejects.toMatchObject({
			kind: 'format'
		});
		await expect(
			fetchRegistryIndex(async () => ok(JSON.stringify({ indexVersion: 7, extensions: [] })))
		).rejects.toMatchObject({ kind: 'format' });
		await expect(
			fetchRegistryIndex(async () => {
				throw new Error('offline');
			})
		).rejects.toMatchObject({ kind: 'offline' });
	});
});
