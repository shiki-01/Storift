/**
 * 拡張の一覧(紹介サイト用)。リポジトリ直下の `extensions/<id>/manifest.json` を読み、
 * アプリ(src/lib/extensions/manifest.ts)と同じ検証を通す。アプリと同じファイルが単一の情報源で、
 * サイトにだけ書く説明は持たない。検証に通らないマニフェストがあれば、ビルドを失敗させる。
 * ひな形(extensions/_template)は含めない。
 *
 * 同じデータから、レジストリ(/extensions-registry/index.json)も作る(scripts/build-registry.ts)。
 */
import { OFFICIAL_EXTENSION_IDS, parseManifest, type ExtensionManifest } from '$manifest';

const modules = import.meta.glob(
	['../../../extensions/*/manifest.json', '!../../../extensions/_template/manifest.json'],
	{
		eager: true,
		import: 'default'
	}
) as Record<string, unknown>;

/** 公式(アプリに同梱)か、コミュニティ(リポジトリに PR で追加されたもの)か */
export type ExtensionSource = 'official' | 'community';

export interface SiteExtension extends ExtensionManifest {
	source: ExtensionSource;
}

export const extensions: SiteExtension[] = Object.entries(modules)
	.map(([path, json]) => {
		const manifest = parseManifest(json, path);
		const folder = path.split('/').at(-2);
		if (folder !== manifest.id) {
			throw new Error(`マニフェストの id とフォルダ名が違います: ${path} (id: ${manifest.id})`);
		}
		const official = OFFICIAL_EXTENSION_IDS.includes(manifest.id);
		if (official !== (manifest.kind === 'official')) {
			throw new Error(`公式の拡張(kind: official)は、同梱の拡張だけです: ${path}`);
		}
		return { ...manifest, source: official ? 'official' : 'community' } as SiteExtension;
	})
	.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

export function findExtension(id: string): SiteExtension | undefined {
	return extensions.find((e) => e.id === id);
}

/** パックのバンドル(ファイルから追加するときに使う)の URL(サイト内の絶対パス) */
export function bundleUrl(ext: Pick<ExtensionManifest, 'id' | 'version'>): string {
	return `/extensions-registry/${ext.id}/${ext.version}.storiftext.json`;
}

/** リポジトリ上の、その拡張のディレクトリ */
export function sourceUrl(id: string): string {
	return `https://github.com/shiki-01/Storift/tree/main/extensions/${id}`;
}
