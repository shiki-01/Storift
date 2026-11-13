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
import { lintScript } from '../../src/lib/extensions/script/lint';
import { SCRIPT_LIMITS } from '../../src/lib/extensions/script/limits';
import {
	readRevoked,
	sha256Hex,
	type RegistrySource,
	type RevokedEntry
} from '../../src/lib/extensions/registryIndex';

/** extensions/ の直下に置けるディレクトリ名のひな形(パック用・スクリプト用) */
export const TEMPLATE_DIR = '_template';
export const SCRIPT_TEMPLATE_DIR = '_template-script';
export const isTemplateDir = (dir: string) => dir === TEMPLATE_DIR || dir === SCRIPT_TEMPLATE_DIR;
/** 失効(キルスイッチ)の一覧のファイル名(extensions/ の直下) */
export const REVOKED_FILE = 'revoked.json';
/** 置いてよいファイルの拡張子(.js はスクリプトの本体 1 つだけ。.ts はひな形の sdk.d.ts だけ) */
export const ALLOWED_EXTENSIONS = ['.json', '.md', '.png', '.svg', '.js'] as const;
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
	/** `ファイル:メッセージ` の形の警告(PR で人が見る。難読化・圧縮の疑いなど) */
	warnings: string[];
	/** 失効(キルスイッチ)の一覧 */
	revoked: RevokedEntry[];
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
): Promise<{ loaded?: LoadedExtension; errors: string[]; warnings: string[] }> {
	const errors: string[] = [];
	const warnings: string[] = [];
	const label = `extensions/${dir}`;
	const abs = join(root, dir);
	const isTemplate = isTemplateDir(dir);

	if (!isTemplate && !DIR_PATTERN.test(dir)) {
		errors.push(`${label}:ディレクトリ名は小文字英数字とハイフンで付けてください`);
		return { errors, warnings };
	}

	const found = await walk(abs, abs, label, errors);
	if (found.length > MAX_FILES) errors.push(`${label}:ファイルが多すぎます(${MAX_FILES} 個まで)`);
	for (const file of found) {
		const ext = extensionOf(file.rel);
		// ひな形(スクリプト)には、型定義 sdk.d.ts を置く
		if (dir === SCRIPT_TEMPLATE_DIR && file.rel === 'sdk.d.ts') continue;
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
		return { errors, warnings };
	}
	if (manifestFile.size > PACK_LIMITS.manifestBytes) {
		errors.push(
			`${label}/manifest.json:${Math.round(PACK_LIMITS.manifestBytes / 1024)}KB を超えています`
		);
		return { errors, warnings };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(manifestFile.abs, 'utf8'));
	} catch (error) {
		errors.push(`${label}/manifest.json:JSON として読み込めません(${(error as Error).message})`);
		return { errors, warnings };
	}
	const result = validateManifest(raw);
	if (!result.ok) {
		for (const message of result.errors) errors.push(`${label}/manifest.json:${message}`);
		return { errors, warnings };
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
		else if (manifest.kind !== 'pack' && manifest.kind !== 'script')
			at(`kind: ${manifest.kind} は受け付けていません(pack か script です)`);
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
			if (extensionOf(file.rel) === '.js') {
				errors.push(`${label}/${file.rel}:パックにはコード(.js)を置けません`);
			}
			if (file.rel === 'manifest.json' || extensionOf(file.rel) !== '.json') continue;
			if (!declared.includes(file.rel)) {
				errors.push(`${label}/${file.rel}:contributions に書かれていない JSON は置けません`);
			}
		}
		if (errors.length === 0) {
			const content = validatePackContent(manifest.contributions, files);
			if (!content.ok) for (const message of content.errors) errors.push(`${label}/${message}`);
		}
	} else if (manifest.kind === 'script') {
		// スクリプトの本体: entry の 1 ファイルだけ(.js はほかに置けない)
		for (const file of found) {
			if (extensionOf(file.rel) === '.json' && file.rel !== 'manifest.json') {
				errors.push(`${label}/${file.rel}:スクリプトには、マニフェスト以外の JSON は置けません`);
			}
			if (extensionOf(file.rel) === '.js' && file.rel !== manifest.entry) {
				errors.push(
					`${label}/${file.rel}:スクリプトは 1 ファイルだけです(entry: ${manifest.entry})。別のファイルは置けません`
				);
			}
		}
		const entryFile = found.find((f) => f.rel === manifest.entry);
		if (!entryFile) {
			errors.push(`${label}/${manifest.entry}:ありません(manifest.json の entry に書かれています)`);
		} else if (entryFile.size > SCRIPT_LIMITS.sourceBytes) {
			errors.push(
				`${label}/${manifest.entry}:${Math.round(SCRIPT_LIMITS.sourceBytes / 1024)}KB を超えています`
			);
		} else {
			const source = await readFile(entryFile.abs, 'utf8');
			const lint = lintScript(source, manifest.permissions.network ?? []);
			for (const message of lint.errors) errors.push(`${label}/${manifest.entry}:${message}`);
			for (const message of lint.warnings) warnings.push(`${label}/${manifest.entry}:${message}`);
			files[manifest.entry!] = source;
		}
	} else {
		for (const file of found) {
			if (extensionOf(file.rel) === '.js') {
				errors.push(`${label}/${file.rel}:スクリプト(kind: script)以外にはコード(.js)を置けません`);
			}
			if (file.rel !== 'manifest.json' && extensionOf(file.rel) === '.json') {
				errors.push(
					`${label}/${file.rel}:パック以外の拡張には、マニフェスト以外の JSON は置けません`
				);
			}
		}
	}

	if (errors.length > 0) return { errors, warnings };

	const loaded: LoadedExtension = {
		dir,
		manifest,
		source: official ? 'official' : 'community',
		files
	};
	if (manifest.kind === 'pack' || manifest.kind === 'script') {
		const data = buildBundle(manifest, files);
		const text = serializeBundle(data);
		const size = new TextEncoder().encode(text).length;
		if (size > PACK_LIMITS.bundleBytes) {
			return {
				errors: [`${label}:バンドルが ${Math.round(PACK_LIMITS.bundleBytes / 1024)}KB を超えます`],
				warnings
			};
		}
		loaded.bundle = { data, text, size, sha256: await sha256Hex(text) };
	}
	return { loaded, errors, warnings };
}

/** extensions/ の全体を検証する。リポジトリの規則: id の重複なし・ディレクトリ以外は置かない */
export async function loadExtensions(repoRoot: string): Promise<LoadResult> {
	const root = join(repoRoot, 'extensions');
	const errors: string[] = [];
	const warnings: string[] = [];
	const extensions: LoadedExtension[] = [];
	const revoked = await loadRevoked(root, errors);
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
		return { extensions, errors: ['extensions:ディレクトリがありません'], warnings, revoked };
	}
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory()) {
			if (entry.name !== 'README.md' && entry.name !== REVOKED_FILE) {
				errors.push(`extensions/${entry.name}:直下にはディレクトリ(拡張ごと)だけを置けます`);
			}
			continue;
		}
		const one = await loadOne(root, entry.name, iconExists);
		errors.push(...one.errors);
		warnings.push(...one.warnings);
		if (one.loaded) extensions.push(one.loaded);
	}
	return { extensions, errors, warnings, revoked };
}

/** extensions/revoked.json(失効の一覧)を読む。無ければ空。形が正しくなければエラー */
export async function loadRevoked(root: string, errors: string[]): Promise<RevokedEntry[]> {
	const label = `extensions/${REVOKED_FILE}`;
	let text: string;
	try {
		text = await readFile(join(root, REVOKED_FILE), 'utf8');
	} catch {
		return [];
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		errors.push(`${label}:JSON として読み込めません(${(error as Error).message})`);
		return [];
	}
	if (!Array.isArray(raw)) {
		errors.push(`${label}:配列で書いてください([{ id, versions, reason, at }])`);
		return [];
	}
	const out: RevokedEntry[] = [];
	raw.forEach((item, i) => {
		const entry = readRevoked(item);
		if (!entry) {
			errors.push(
				`${label}:[${i}] が正しくありません(id・versions(版の配列か "*")・reason(300 文字まで)・at(YYYY-MM-DD)が必要です)`
			);
		} else {
			out.push(entry);
		}
	});
	return out;
}
