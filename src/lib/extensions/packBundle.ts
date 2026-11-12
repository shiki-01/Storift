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
	validatePackContent,
	type PackContent
} from './pack';

export interface ParsedBundle {
	manifest: ExtensionManifest;
	files: Record<string, unknown>;
	content: PackContent;
	/** バンドルのバイト数 */
	size: number;
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
	if (manifest.manifest.kind !== 'pack') {
		return { ok: false, errors: ['パック(kind: pack)以外の拡張は、追加できません'] };
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
	if (m.manifest.kind !== 'pack') return { ok: false, errors: ['パックではありません'] };
	if (typeof files !== 'object' || files === null || Array.isArray(files)) {
		return { ok: false, errors: ['コンテンツがありません'] };
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
