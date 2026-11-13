import { describe, expect, it } from 'vitest';
import { parseBundleText, reviveRecord } from './packBundle';

const manifest = (patch: Record<string, unknown> = {}) => ({
	id: 'my-script',
	name: 'S',
	description: 'd',
	version: '1.0.0',
	author: 'a',
	kind: 'script',
	apiVersion: 1,
	platforms: ['web'],
	icon: 'puzzle',
	license: 'MIT',
	updatedAt: '2026-11-12',
	entry: 'main.js',
	permissions: { ui: true },
	privacy: { sends: [], stores: [], onDisable: 'x' },
	...patch
});
const bundle = (m: unknown, files: Record<string, unknown>) =>
	JSON.stringify({ format: 'storift-extension-bundle', bundleVersion: 1, manifest: m, files });

describe('スクリプトのバンドル', () => {
	it('ソースを検査して読み込む', () => {
		const r = parseBundleText(bundle(manifest(), { 'main.js': 'storift.ui.set("panel", null);' }));
		expect(r.ok && r.bundle.script).toContain('storift.ui.set');
	});

	it('eval を含む・本体が無い・余計なファイルがある・文字列でない、は拒否する', () => {
		for (const files of [
			{ 'main.js': 'eval("1")' },
			{},
			{ 'main.js': '1', 'other.js': '1' },
			{ 'main.js': { not: 'a string' } }
		])
			expect(parseBundleText(bundle(manifest(), files)).ok, JSON.stringify(files)).toBe(false);
	});

	it('マニフェストの検証にも通す(通信先の整合など)', () => {
		const m = manifest({ permissions: { network: ['a.example.com'] } });
		expect(parseBundleText(bundle(m, { 'main.js': '1' })).ok).toBe(false);
	});

	it('保存済みのレコードも、読み込むたびに検査し直す', () => {
		expect(reviveRecord(manifest(), { 'main.js': '1' }).ok).toBe(true);
		expect(reviveRecord(manifest(), { 'main.js': 'importScripts("x")' }).ok).toBe(false);
		expect(reviveRecord(manifest(), null).ok).toBe(false);
	});
});
