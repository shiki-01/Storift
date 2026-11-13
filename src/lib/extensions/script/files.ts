/**
 * スクリプト拡張のファイル(バンドルの files・拡張フォルダの読み取り結果)の検証。
 * 置けるのは、マニフェストの entry で指定した 1 ファイル(文字列)だけ。静的な検査(lint.ts)も通す。
 */
import type { ExtensionManifest } from '../manifest';
import { lintScript } from './lint';

export type ScriptFilesValidation =
	| { ok: true; source: string; warnings: string[] }
	| { ok: false; errors: string[] };

export function validateScriptFiles(
	manifest: Pick<ExtensionManifest, 'entry' | 'permissions'>,
	files: Record<string, unknown>
): ScriptFilesValidation {
	const entry = manifest.entry;
	if (!entry) return { ok: false, errors: ['entry がありません'] };
	const errors: string[] = [];
	for (const path of Object.keys(files)) {
		if (path !== entry)
			errors.push(`${path}: スクリプトに含められるのは ${entry} の 1 ファイルだけです`);
	}
	const source = Object.hasOwn(files, entry) ? files[entry] : undefined;
	if (typeof source !== 'string') {
		errors.push(`${entry}: スクリプトの本体がありません`);
		return { ok: false, errors };
	}
	const lint = lintScript(source, manifest.permissions.network ?? []);
	errors.push(...lint.errors.map((e) => `${entry}: ${e}`));
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, source, warnings: lint.warnings.map((w) => `${entry}: ${w}`) };
}
