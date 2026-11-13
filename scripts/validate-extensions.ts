/**
 * extensions/ の全拡張を検証する。PR の CI(.github/workflows/validate-extensions.yml)と、
 * 手元の `bun run validate:extensions` が使う。エラーは `ファイル:メッセージ` の形で出し、あれば非ゼロで終了する。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTemplateDir, loadExtensions } from './lib/extensions';

export async function validateExtensions(repoRoot: string): Promise<string[]> {
	return (await validateExtensionsDetailed(repoRoot)).errors;
}

/** エラーと警告(難読化・圧縮の疑いなど。PR で人が見る)を返す */
export async function validateExtensionsDetailed(
	repoRoot: string
): Promise<{ errors: string[]; warnings: string[] }> {
	const { extensions, errors, warnings } = await loadExtensions(repoRoot);
	// 拡張どうしの重複(ひな形は除く)
	const seen = new Map<string, string>();
	for (const ext of extensions) {
		if (isTemplateDir(ext.dir)) continue;
		const first = seen.get(ext.manifest.id);
		if (first)
			errors.push(
				`extensions/${ext.dir}/manifest.json:id「${ext.manifest.id}」が ${first} と重複しています`
			);
		else seen.set(ext.manifest.id, `extensions/${ext.dir}`);
	}
	return { errors, warnings };
}

async function main(): Promise<void> {
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const { errors, warnings } = await validateExtensionsDetailed(repoRoot);
	// 警告は失敗にしない。GitHub Actions では、PR の注釈(annotation)として表示する
	for (const warning of warnings) {
		const [file, ...rest] = warning.split(':');
		console.warn(
			process.env.GITHUB_ACTIONS ? `::warning file=${file}::${rest.join(':')}` : `警告 ${warning}`
		);
	}
	if (errors.length > 0) {
		for (const error of errors) console.error(error);
		console.error(`\n${errors.length} 件の問題があります`);
		process.exit(1);
	}
	const { extensions } = await loadExtensions(repoRoot);
	console.log(
		`extensions: ${extensions.length} 件を検証しました(問題なし${warnings.length > 0 ? `。警告 ${warnings.length} 件` : ''})`
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main();
}
