import { describe, expect, it } from 'vitest';
import { assembleFolderPack } from './packFolder';

const manifest = (patch: Record<string, unknown> = {}) => ({
	id: 'my-pack',
	name: 'P',
	description: 'd',
	version: '1.0.0',
	author: 'a',
	kind: 'pack',
	apiVersion: 1,
	platforms: ['desktop'],
	icon: 'puzzle',
	license: 'MIT',
	updatedAt: '2026-11-12',
	permissions: {},
	privacy: { sends: [], stores: [], onDisable: '止まる' },
	contributions: { assistKeys: ['contents/k.json'] },
	...patch
});
const keys = JSON.stringify({ id: 'k', name: 'キー', keys: [{ text: '※' }] });

const entry = (m: unknown, files: Record<string, string> = {}, dir = 'my-pack') => ({
	dir,
	files: { 'manifest.json': JSON.stringify(m), ...files }
});

describe('assembleFolderPack', () => {
	it('宣言されたファイルを読み、検証して返す', () => {
		const r = assembleFolderPack(entry(manifest(), { 'contents/k.json': keys }));
		expect(r.ok).toBe(true);
		expect(r.ok && r.bundle.content.assistKeys).toHaveLength(1);
	});

	it('パストラバーサルを狙う宣言は拒否し、フォルダ外のファイルを引かない', () => {
		for (const path of [
			'../secret.json',
			'contents/../../secret.json',
			'/etc/passwd.json',
			'..\\secret.json',
			'C:\\x.json'
		]) {
			const files = { [path]: keys };
			const r = assembleFolderPack(
				entry(manifest({ contributions: { assistKeys: [path] } }), files)
			);
			expect(r.ok, path).toBe(false);
		}
	});

	it('宣言されていないファイルは、中身があっても使わない', () => {
		const r = assembleFolderPack(
			entry(manifest(), { 'contents/k.json': keys, 'contents/extra.json': '{"x":1}' })
		);
		expect(r.ok).toBe(true);
		expect(r.ok && Object.keys(r.bundle.files)).toEqual(['contents/k.json']);
	});

	it('ID がフォルダ名と違う・マニフェストが無い・壊れている・kind が違う', () => {
		const files = { 'contents/k.json': keys };
		expect(assembleFolderPack(entry(manifest(), files, 'other')).ok).toBe(false);
		expect(assembleFolderPack({ dir: 'x', files: {} }).ok).toBe(false);
		expect(assembleFolderPack({ dir: 'x', files: { 'manifest.json': '{' } }).ok).toBe(false);
		expect(assembleFolderPack(entry(manifest({ kind: 'script' }), files)).ok).toBe(false);
		expect(assembleFolderPack(entry(manifest({ id: 'monolog' }), files, 'monolog')).ok).toBe(false);
		expect(
			assembleFolderPack(entry(manifest({ permissions: { network: ['a.example.com'] } }), files)).ok
		).toBe(false);
	});

	it('Rust 側が読めなかった理由をそのまま返す', () => {
		const r = assembleFolderPack({ dir: 'x', files: {}, error: '大きすぎます' });
		expect(!r.ok && r.errors).toEqual(['大きすぎます']);
	});

	it('Object.prototype のキーを引かない', () => {
		const r = assembleFolderPack(
			entry(manifest({ contributions: { assistKeys: ['constructor.json'] } }), {})
		);
		expect(r.ok).toBe(false);
	});
});

describe('assembleFolderPack(スクリプト)', () => {
	const script = (patch: Record<string, unknown> = {}) =>
		manifest({
			id: 'my-script',
			kind: 'script',
			entry: 'main.js',
			contributions: undefined,
			permissions: { ui: true },
			...patch
		});

	it('entry の 1 ファイルを読み、検査して返す', () => {
		const r = assembleFolderPack(
			entry(script(), { 'main.js': 'storift.ui.set("panel", []);' }, 'my-script')
		);
		expect(r.ok && r.bundle.script).toContain('storift.ui.set');
	});

	it('eval を含む・本体が無い・大きすぎる・別のファイルは拒否し、余計なファイルは読まない', () => {
		expect(assembleFolderPack(entry(script(), { 'main.js': 'eval("1")' }, 'my-script')).ok).toBe(
			false
		);
		expect(assembleFolderPack(entry(script(), {}, 'my-script')).ok).toBe(false);
		expect(
			assembleFolderPack(entry(script(), { 'main.js': 'x'.repeat(210 * 1024) }, 'my-script')).ok
		).toBe(false);
		const r = assembleFolderPack(
			entry(script(), { 'main.js': '1', 'other.js': 'eval(1)' }, 'my-script')
		);
		expect(r.ok && Object.keys(r.bundle.files)).toEqual(['main.js']);
	});
});
