/**
 * リポジトリの extensions/ を読み込んで検証する(validate-extensions.ts と build-registry.ts が使う)。
 *
 * アプリのビルドには依存しない。検証は src/lib/extensions/ の manifest.ts・pack.ts と同じ実装を使う
 * (アプリがインストール時に行う検証と、PR の CI が行う検証が食い違わないように)。
 * bun で実行する(`bun scripts/validate-extensions.ts`)。
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
	OFFICIAL_EXTENSION_IDS,
	validateManifest,
	type ExtensionManifest
} from '../../src/lib/extensions/manifest';
import {
	ALLOWED_LICENSES,
	PACK_LIMITS,
	buildBundle,
	contributionPaths,
	serializeBundle,
	validatePackContent,
	type PackBundle
} from '../../src/lib/extensions/pack';
import { sha256Hex, type RegistrySource } from '../../src/lib/extensions/registryIndex';

/** extensions/ の直下に置けるディレクトリ名のひな形 */
export const TEMPLATE_DIR = '_template';
/** 置いてよいファイルの拡張子 */
export const ALLOWED_EXTENSIONS = ['.json', '.md', '.png', '.svg'] as const;
const IMAGE_EXTENSIONS = ['.png', '.svg'];
const MAX_DEPTH = 3;
const MAX_FILES = 40;
const DIR_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface LoadedExtension {
	/** extensions/ 直下のディレクトリ名 */
	dir: string;
	manifest: ExtensionManifest;
	source: RegistrySource;
	/** コンテンツ(パスは manifest.json からの相対。パックのみ) */
	files: Record<string, unknown>;
	/** パックのバンドル(パックのみ。検証に通ったもの) */
	bundle?: { data: PackBundle; text: string; sha256: string; size: number };
}

export interface LoadResult {
	extensions: LoadedExtension[];
	/** `ファイル:メッセージ` の形のエラー */
	errors: string[];
}

interface FoundFile {
	/** ディレクトリからの相対パス("/" 区切り) */
	rel: string;
	abs: string;
	size: number;
}

/** ディレクトリ配下のファイルを集める。シンボリックリンク・隠しファイル・深すぎる階層はエラーにする */
async function walk(
	abs: string,
	root: string,
	label: string,
	errors: string[],
	depth = 1
): Promise<FoundFile[]> {
	const out: FoundFile[] = [];
	for (const entry of await readdir(abs, { withFileTypes: true })) {
		const path = join(abs, entry.name);
		const rel = relative(root, path).split(sep).join('/');
		const where = `${label}/${rel}`;
		if (entry.name.startsWith('.')) {
			errors.push(`${where}:隠しファイルは置けません`);
			continue;
		}
		const stat = await lstat(path);
		if (stat.isSymbolicLink()) {
			errors.push(`${where}:シンボリックリンクは置けません`);
		} else if (stat.isDirectory()) {
			if (depth >= MAX_DEPTH) errors.push(`${where}:階層が深すぎます(${MAX_DEPTH} 階層まで)`);
			else out.push(...(await walk(path, root, label, errors, depth + 1)));
		} else if (stat.isFile()) {
			out.push({ rel, abs: path, size: stat.size });
		} else {
			errors.push(`${where}:通常のファイルではありません`);
		}
	}
	return out;
}

function extensionOf(rel: string): string {
	const i = rel.lastIndexOf('.');
	return i < 0 ? '' : rel.slice(i).toLowerCase();
}

/** extensions/<dir>/ を 1 つ読み込んで検証する */
async function loadOne(
	root: string,
	dir: string,
	iconExists: (name: string) => Promise<boolean>
): Promise<{ loaded?: LoadedExtension; errors: string[] }> {
	const errors: string[] = [];
	const label = `extensions/${dir}`;
	const abs = join(root, dir);
	const isTemplate = dir === TEMPLATE_DIR;

	if (!isTemplate && !DIR_PATTERN.test(dir)) {
		errors.push(`${label}:ディレクトリ名は小文字英数字とハイフンで付けてください`);
		return { errors };
	}

	const found = await walk(abs, abs, label, errors);
	if (found.length > MAX_FILES) errors.push(`${label}:ファイルが多すぎます(${MAX_FILES} 個まで)`);
	for (const file of found) {
		const ext = extensionOf(file.rel);
		if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
			errors.push(
				`${label}/${file.rel}:置けないファイルです(許可: ${ALLOWED_EXTENSIONS.join(' / ')})`
			);
		} else if (IMAGE_EXTENSIONS.includes(ext) && file.size > PACK_LIMITS.imageBytes) {
			errors.push(
				`${label}/${file.rel}:画像は ${Math.round(PACK_LIMITS.imageBytes / 1024)}KB までです`
			);
		}
	}

	const manifestFile = found.find((f) => f.rel === 'manifest.json');
	if (!manifestFile) {
		errors.push(`${label}/manifest.json:ありません`);
		return { errors };
	}
	if (manifestFile.size > PACK_LIMITS.manifestBytes) {
		errors.push(
			`${label}/manifest.json:${Math.round(PACK_LIMITS.manifestBytes / 1024)}KB を超えています`
		);
		return { errors };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(manifestFile.abs, 'utf8'));
	} catch (error) {
		errors.push(`${label}/manifest.json:JSON として読み込めません(${(error as Error).message})`);
		return { errors };
	}
	const result = validateManifest(raw);
	if (!result.ok) {
		for (const message of result.errors) errors.push(`${label}/manifest.json:${message}`);
		return { errors };
	}
	const manifest = result.manifest;
	const at = (message: string) => errors.push(`${label}/manifest.json:${message}`);

	if (!isTemplate && manifest.id !== dir) {
		at(`id「${manifest.id}」がディレクトリ名「${dir}」と一致しません`);
	}
	const official = OFFICIAL_EXTENSION_IDS.includes(dir);
	if (official) {
		if (manifest.kind !== 'official') at('公式の拡張は kind: official です');
	} else {
		if (manifest.kind === 'official') at('kind: official は公式の拡張だけが使えます');
		else if (manifest.kind !== 'pack')
			at(`kind: ${manifest.kind} はまだ受け付けていません(現在は pack のみです)`);
		if (!manifest.license || !ALLOWED_LICENSES.includes(manifest.license)) {
			at(`license は次のいずれかにしてください: ${ALLOWED_LICENSES.join(' / ')}`);
		}
		if (!(await iconExists(manifest.icon))) {
			at(
				`icon「${manifest.icon}」は、アプリのアイコン(src/lib/components/editor/icons)にありません`
			);
		}
	}

	// パックのコンテンツ
	const files: Record<string, unknown> = {};
	if (manifest.kind === 'pack') {
		const declared = contributionPaths(manifest.contributions);
		for (const path of declared) {
			const file = found.find((f) => f.rel === path);
			if (!file) {
				errors.push(`${label}/${path}:ありません(contributions に書かれています)`);
				continue;
			}
			if (file.size > PACK_LIMITS.fileBytes) {
				errors.push(
					`${label}/${path}:${Math.round(PACK_LIMITS.fileBytes / 1024)}KB を超えています`
				);
				continue;
			}
			try {
				files[path] = JSON.parse(await readFile(file.abs, 'utf8'));
			} catch (error) {
				errors.push(`${label}/${path}:JSON として読み込めません(${(error as Error).message})`);
			}
		}
		for (const file of found) {
			if (file.rel === 'manifest.json' || extensionOf(file.rel) !== '.json') continue;
			if (!declared.includes(file.rel)) {
				errors.push(`${label}/${file.rel}:contributions に書かれていない JSON は置けません`);
			}
		}
		if (errors.length === 0) {
			const content = validatePackContent(manifest.contributions, files);
			if (!content.ok) for (const message of content.errors) errors.push(`${label}/${message}`);
		}
	} else {
		for (const file of found) {
			if (file.rel !== 'manifest.json' && extensionOf(file.rel) === '.json') {
				errors.push(
					`${label}/${file.rel}:パック以外の拡張には、マニフェスト以外の JSON は置けません`
				);
			}
		}
	}

	if (errors.length > 0) return { errors };

	const loaded: LoadedExtension = {
		dir,
		manifest,
		source: official ? 'official' : 'community',
		files
	};
	if (manifest.kind === 'pack') {
		const data = buildBundle(manifest, files);
		const text = serializeBundle(data);
		const size = new TextEncoder().encode(text).length;
		if (size > PACK_LIMITS.bundleBytes) {
			return {
				errors: [`${label}:バンドルが ${Math.round(PACK_LIMITS.bundleBytes / 1024)}KB を超えます`]
			};
		}
		loaded.bundle = { data, text, size, sha256: await sha256Hex(text) };
	}
	return { loaded, errors };
}

/** extensions/ の全体を検証する。リポジトリの規則: id の重複なし・ディレクトリ以外は置かない */
export async function loadExtensions(repoRoot: string): Promise<LoadResult> {
	const root = join(repoRoot, 'extensions');
	const errors: string[] = [];
	const extensions: LoadedExtension[] = [];
	const iconExists = async (name: string) => {
		try {
			return (
				await lstat(join(repoRoot, 'src/lib/components/editor/icons', `${name}.svg`))
			).isFile();
		} catch {
			return false;
		}
	};

	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return { extensions, errors: ['extensions:ディレクトリがありません'] };
	}
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory()) {
			if (entry.name !== 'README.md') {
				errors.push(`extensions/${entry.name}:直下にはディレクトリ(拡張ごと)だけを置けます`);
			}
			continue;
		}
		const one = await loadOne(root, entry.name, iconExists);
		errors.push(...one.errors);
		if (one.loaded) extensions.push(one.loaded);
	}
	return { extensions, errors };
}
