/**
 * extensions/ の全拡張を検証する。PR の CI(.github/workflows/validate-extensions.yml)と、
 * 手元の `bun run validate:extensions` が使う。エラーは `ファイル:メッセージ` の形で出し、あれば非ゼロで終了する。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExtensions } from './lib/extensions';

export async function validateExtensions(repoRoot: string): Promise<string[]> {
	const { extensions, errors } = await loadExtensions(repoRoot);
	// 拡張どうしの重複(ひな形は除く)
	const seen = new Map<string, string>();
	for (const ext of extensions) {
		if (ext.dir === '_template') continue;
		const first = seen.get(ext.manifest.id);
		if (first)
			errors.push(
				`extensions/${ext.dir}/manifest.json:id「${ext.manifest.id}」が ${first} と重複しています`
			);
		else seen.set(ext.manifest.id, `extensions/${ext.dir}`);
	}
	return errors;
}

async function main(): Promise<void> {
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const errors = await validateExtensions(repoRoot);
	if (errors.length > 0) {
		for (const error of errors) console.error(error);
		console.error(`\n${errors.length} 件の問題があります`);
		process.exit(1);
	}
	const { extensions } = await loadExtensions(repoRoot);
	console.log(`extensions: ${extensions.length} 件を検証しました(問題なし)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main();
}
