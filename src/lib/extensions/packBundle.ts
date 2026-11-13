/**
 * バンドル(.storiftext.json)の文字列を、パックとして読み込める形に検証する。
 * レジストリから取得したもの・「ファイルから追加」で選んだものの両方が、必ずここを通る。
 */
import type { ExtensionManifest } from './manifest';
import { validateManifest } from './manifest';
import {
	PACK_LIMITS,
	byteLength,
	checkBundleShape,
	emptyContent,
	validatePackContent,
	type PackContent
} from './pack';
import { validateScriptFiles } from './script/files';

export interface ParsedBundle {
	manifest: ExtensionManifest;
	files: Record<string, unknown>;
	content: PackContent;
	/** バンドルのバイト数 */
	size: number;
	/** スクリプト(kind: script)のソース。検査済み */
	script?: string;
}

export type BundleParse = { ok: true; bundle: ParsedBundle } | { ok: false; errors: string[] };

/** バンドルの文字列を検証する。マニフェスト(kind: pack)・コンテンツ・サイズのすべてを見る */
export function parseBundleText(text: string): BundleParse {
	const size = byteLength(text);
	if (size > PACK_LIMITS.bundleBytes) {
		return {
			ok: false,
			errors: [`ファイルが大きすぎます(${Math.round(PACK_LIMITS.bundleBytes / 1024)}KB まで)`]
		};
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return { ok: false, errors: ['JSON として読み込めません'] };
	}
	const shape = checkBundleShape(data);
	if (!shape.ok) return shape;
	const manifest = validateManifest(shape.bundle.manifest);
	if (!manifest.ok) return { ok: false, errors: manifest.errors.map((e) => `manifest: ${e}`) };
	if (manifest.manifest.kind === 'script') {
		const script = validateScriptFiles(manifest.manifest, shape.bundle.files);
		if (!script.ok) return script;
		return {
			ok: true,
			bundle: {
				manifest: manifest.manifest,
				files: shape.bundle.files,
				content: emptyContent(),
				size,
				script: script.source
			}
		};
	}
	if (manifest.manifest.kind !== 'pack') {
		return {
			ok: false,
			errors: ['パック(kind: pack)かスクリプト(kind: script)以外は、追加できません']
		};
	}
	const content = validatePackContent(manifest.manifest.contributions, shape.bundle.files);
	if (!content.ok) return content;
	return {
		ok: true,
		bundle: {
			manifest: manifest.manifest,
			files: shape.bundle.files,
			content: content.content,
			size
		}
	};
}

/** 保存済みのレコード(マニフェストとコンテンツ)を、読み込むたびに検証し直す */
export function reviveRecord(
	manifest: unknown,
	files: unknown
): { ok: true; bundle: Omit<ParsedBundle, 'size'> } | { ok: false; errors: string[] } {
	const m = validateManifest(manifest);
	if (!m.ok) return m;
	if (m.manifest.kind !== 'pack' && m.manifest.kind !== 'script')
		return { ok: false, errors: ['パックでもスクリプトでもありません'] };
	if (typeof files !== 'object' || files === null || Array.isArray(files)) {
		return { ok: false, errors: ['コンテンツがありません'] };
	}
	if (m.manifest.kind === 'script') {
		// 保存済みのものも、読み込むたびに検査し直す
		const script = validateScriptFiles(m.manifest, files as Record<string, unknown>);
		if (!script.ok) return script;
		return {
			ok: true,
			bundle: {
				manifest: m.manifest,
				files: files as Record<string, unknown>,
				content: emptyContent(),
				script: script.source
			}
		};
	}
	const content = validatePackContent(m.manifest.contributions, files as Record<string, unknown>);
	if (!content.ok) return content;
	return {
		ok: true,
		bundle: {
			manifest: m.manifest,
			files: files as Record<string, unknown>,
			content: content.content
		}
	};
}
