/**
 * 拡張の一覧(紹介サイト用)。リポジトリ直下の `extensions/<id>/manifest.json` を読み、
 * アプリ(src/lib/extensions/manifest.ts)と同じ検証を通す。アプリと同じファイルが単一の情報源で、
 * サイトにだけ書く説明は持たない。検証に通らないマニフェストがあれば、ビルドを失敗させる
 */
import { parseManifest, type ExtensionManifest } from '$manifest';

const modules = import.meta.glob('../../../extensions/*/manifest.json', {
	eager: true,
	import: 'default'
}) as Record<string, unknown>;

export const extensions: ExtensionManifest[] = Object.entries(modules)
	.map(([path, json]) => {
		const manifest = parseManifest(json, path);
		const folder = path.split('/').at(-2);
		if (folder !== manifest.id) {
			throw new Error(`マニフェストの id とフォルダ名が違います: ${path} (id: ${manifest.id})`);
		}
		return manifest;
	})
	.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

export function findExtension(id: string): ExtensionManifest | undefined {
	return extensions.find((e) => e.id === id);
}
