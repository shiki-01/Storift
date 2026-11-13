/**
 * 拡張のレジストリ(一覧とバンドル)を生成する。紹介サイトのビルドの前に実行する。
 *
 *   bun scripts/build-registry.ts [出力先]   既定: site/static/extensions-registry
 *
 * - index.json: 公式を含む全拡張の一覧(ひな形は含めない)
 * - <id>/<version>.storiftext.json: パック・スクリプトのバンドル
 * - index.json の revoked: 失効(キルスイッチ)。extensions/revoked.json から作る
 * 出力は入力だけで決まる(コミット日時・実行時刻を使わない)ので、何度作っても同じバイト列になる。
 * 生成物はコミットしない(site/.gitignore)。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTemplateDir, loadExtensions } from './lib/extensions';
import {
	REGISTRY_INDEX_VERSION,
	bundlePath,
	toRegistryEntry,
	type RegistryIndex
} from '../src/lib/extensions/registryIndex';

export interface BuildResult {
	index: RegistryIndex;
	files: string[];
}

export async function buildRegistry(repoRoot: string, outDir: string): Promise<BuildResult> {
	const { extensions, errors, revoked } = await loadExtensions(repoRoot);
	if (errors.length > 0) {
		throw new Error(`extensions に問題があるため、レジストリを作れません:\n${errors.join('\n')}`);
	}
	const targets = extensions
		.filter((e) => !isTemplateDir(e.dir))
		.sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1));

	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	const files: string[] = [];
	const index: RegistryIndex = { indexVersion: REGISTRY_INDEX_VERSION, extensions: [], revoked };

	for (const ext of targets) {
		const bundle = ext.bundle ? { sha256: ext.bundle.sha256, size: ext.bundle.size } : null;
		index.extensions.push(toRegistryEntry(ext.manifest, ext.source, bundle));
		if (ext.bundle) {
			// bundlePath は "/extensions-registry/<id>/<version>.storiftext.json"。出力先は outDir 直下に合わせる
			const rel = bundlePath(ext.manifest.id, ext.manifest.version).replace(
				/^\/extensions-registry\//,
				''
			);
			await mkdir(dirname(join(outDir, rel)), { recursive: true });
			await writeFile(join(outDir, rel), ext.bundle.text);
			files.push(rel);
		}
	}
	await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, '\t')}\n`);
	files.push('index.json');
	return { index, files };
}

async function main(): Promise<void> {
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const outDir = resolve(process.argv[2] ?? join(repoRoot, 'site/static/extensions-registry'));
	try {
		const { index, files } = await buildRegistry(repoRoot, outDir);
		console.log(
			`extensions-registry: ${index.extensions.length} 件の一覧と ${files.length} ファイルを生成しました(${outDir})`
		);
	} catch (error) {
		console.error((error as Error).message);
		process.exit(1);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main();
}
