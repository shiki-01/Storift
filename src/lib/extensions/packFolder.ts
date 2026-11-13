/**
 * デスクトップ版の「拡張フォルダ」。指定したフォルダの直下にある `<id>/manifest.json` を持つフォルダを、パックとして読み込む。
 *
 * ファイルの読み取りは Rust 側(src-tauri/src/extensions.rs)が行う。読み取り専用で、拡張フォルダの外は読まず、
 * シンボリックリンクはたどらない。ここ(TypeScript 側)は、読み取った文字列を組み立てて、レジストリと同じ検証にかける。
 * マニフェストが参照できるのは、isSafeContentPath を通った相対パスだけ(`..`・絶対パス・バックスラッシュは検証で拒否される)。
 */
import { validateManifest } from './manifest';
import {
	PACK_LIMITS,
	contributionPaths,
	emptyContent,
	validatePackContent,
	byteLength
} from './pack';
import { validateScriptFiles } from './script/files';
import { SCRIPT_LIMITS } from './script/limits';
import type { ParsedBundle } from './packBundle';

/** Rust が返す、フォルダ 1 つ分の読み取り結果 */
export interface FolderScanEntry {
	/** フォルダ名 */
	dir: string;
	/** フォルダ内の JSON ファイル(フォルダからの相対パス → 文字列) */
	files: Record<string, string>;
	/** 読み取れなかった理由(あれば files は空) */
	error?: string;
}

export interface FolderScanResult {
	/** 読み取ったフォルダの絶対パス */
	root: string;
	packs: FolderScanEntry[];
}

export type FolderPack =
	| { ok: true; dir: string; bundle: ParsedBundle }
	| { ok: false; dir: string; errors: string[] };

/** 読み取った 1 フォルダを、パックとして検証する */
export function assembleFolderPack(entry: FolderScanEntry): FolderPack {
	const fail = (...errors: string[]): FolderPack => ({ ok: false, dir: entry.dir, errors });
	if (entry.error) return fail(entry.error);
	const manifestText = entry.files['manifest.json'];
	if (manifestText === undefined) return fail('manifest.json がありません');
	if (byteLength(manifestText) > PACK_LIMITS.manifestBytes) {
		return fail('manifest.json が大きすぎます');
	}
	let raw: unknown;
	try {
		raw = JSON.parse(manifestText);
	} catch {
		return fail('manifest.json を JSON として読み込めません');
	}
	const m = validateManifest(raw);
	if (!m.ok) return fail(...m.errors.map((e) => `manifest.json: ${e}`));
	const manifest = m.manifest;
	if (manifest.kind !== 'pack' && manifest.kind !== 'script')
		return fail('パック(kind: pack)かスクリプト(kind: script)以外は読み込めません');
	if (manifest.id !== entry.dir) {
		return fail(`id「${manifest.id}」がフォルダ名「${entry.dir}」と一致しません`);
	}

	if (manifest.kind === 'script') {
		const path = manifest.entry!;
		const text = Object.hasOwn(entry.files, path) ? entry.files[path] : undefined;
		if (text === undefined) return fail(`${path}: ファイルがありません`);
		if (byteLength(text) > SCRIPT_LIMITS.sourceBytes)
			return fail(`${path}: スクリプトが大きすぎます`);
		// 宣言した 1 ファイルだけを見る(それ以外のファイルは読み取っても使わない)
		const script = validateScriptFiles(manifest, { [path]: text });
		if (!script.ok) return fail(...script.errors);
		return {
			ok: true,
			dir: entry.dir,
			bundle: {
				manifest,
				files: { [path]: text },
				content: emptyContent(),
				size: byteLength(manifestText) + byteLength(text),
				script: script.source
			}
		};
	}

	// 宣言されたパスだけを引く(検証済みの安全なパス)。それ以外のファイルは見ない
	const files: Record<string, unknown> = {};
	let size = byteLength(manifestText);
	for (const path of contributionPaths(manifest.contributions)) {
		const text = Object.hasOwn(entry.files, path) ? entry.files[path] : undefined;
		if (text === undefined) return fail(`${path}: ファイルがありません`);
		size += byteLength(text);
		try {
			files[path] = JSON.parse(text);
		} catch {
			return fail(`${path}: JSON として読み込めません`);
		}
	}
	const content = validatePackContent(manifest.contributions, files);
	if (!content.ok) return fail(...content.errors);
	return { ok: true, dir: entry.dir, bundle: { manifest, files, content: content.content, size } };
}
