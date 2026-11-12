/**
 * パックの導入・更新・削除と、起動時の読み込み。
 *
 * 出所は 3 つ。レジストリから入れたもの(コミュニティ)・「ファイルから追加」(個人追加・未審査)は
 * 別の IndexedDB(packStore.ts)に保存する。デスクトップ版の「拡張フォルダ」(個人フォルダ・未審査)は
 * 保存せず、起動時と「再読み込み」で読み直す。どの出所も、同じ検証(parseBundleText / assembleFolderPack)を通る。
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { isDesktop } from '$lib/desktop/platform';
import { themeStore } from '$lib/stores/theme.svelte';
import { extensionHost } from './host.svelte';
import { consentFingerprint, type ExtensionOrigin } from './manifest';
import { createPackExtension } from './packExtension';
import { assembleFolderPack, type FolderPack, type FolderScanResult } from './packFolder';
import { parseBundleText, reviveRecord, type ParsedBundle } from './packBundle';
import {
	deleteInstalledPack,
	listInstalledPacks,
	requestPersistence,
	saveInstalledPack,
	type InstalledPackRecord
} from './packStore';
import { fetchBundle, RegistryError } from './registryClient';
import { compareVersions, type RegistryEntry } from './registryIndex';

/** 拡張フォルダのパスの保存先(端末内)。空は既定のフォルダ */
export const FOLDER_PATH_KEY = 'storift:extensions:folder';
const PERSIST_ASKED_KEY = 'storift:extensions:persist-asked';

/** 導入済みのパックの情報(一覧に出す) */
export interface InstalledPackInfo {
	id: string;
	origin: Exclude<ExtensionOrigin, 'official'>;
	version: string;
	size: number;
	installedAt: number;
}

export interface InstallResult {
	id: string;
	/** 更新で、すでに同意していた内容(権限・プライバシー)から変わったか */
	reconsent: boolean;
	/** 置き換えた(すでに入っていた) */
	replaced: boolean;
}

export class PackInstallError extends Error {}

function readStorage(key: string): string {
	try {
		return localStorage.getItem(key) ?? '';
	} catch {
		return '';
	}
}

function writeStorage(key: string, value: string): void {
	try {
		if (value) localStorage.setItem(key, value);
		else localStorage.removeItem(key);
	} catch {
		// 保存できなくても、動作は続ける
	}
}

class PackManager {
	/** 導入済み(保存したもの + 拡張フォルダから読み込んだもの) */
	private infos = new SvelteMap<string, InstalledPackInfo>();
	loaded = $state(false);
	/** 拡張フォルダの読み込み結果(デスクトップ版) */
	folderRoot = $state('');
	folderErrors = $state<{ dir: string; errors: string[] }[]>([]);
	folderBusy = $state(false);
	/** 拡張フォルダから読み込んだパックの ID */
	private folderIds = new SvelteSet<string>();
	private initPromise: Promise<void> | null = null;

	get installed(): InstalledPackInfo[] {
		return [...this.infos.values()];
	}

	info(id: string): InstalledPackInfo | undefined {
		return this.infos.get(id);
	}

	get folderPath(): string {
		return readStorage(FOLDER_PATH_KEY);
	}

	/** 保存済みのパックと、拡張フォルダのパックを読み込んで、拡張として登録する(起動時に 1 回) */
	init(): Promise<void> {
		this.initPromise ??= this.load();
		return this.initPromise;
	}

	private async load(): Promise<void> {
		try {
			for (const record of await listInstalledPacks()) {
				const revived = reviveRecord(record.manifest, record.files);
				if (!revived.ok) {
					console.warn(`保存済みのパック ${record.id} を読み込めませんでした:`, revived.errors);
					continue;
				}
				await this.register(revived.bundle, record.origin, record.size, record.installedAt);
			}
		} catch (error) {
			// IndexedDB が使えない環境でも、アプリは動かす
			console.warn('インストール済みの拡張機能を読み込めませんでした:', error);
		}
		if (isDesktop()) await this.reloadFolder();
		this.loaded = true;
	}

	private async register(
		bundle: Omit<ParsedBundle, 'size'>,
		origin: Exclude<ExtensionOrigin, 'official'>,
		size: number,
		installedAt: number
	): Promise<boolean> {
		const ok = await extensionHost.addExtension(
			createPackExtension(bundle.manifest, bundle.content, origin)
		);
		if (ok) {
			this.infos.set(bundle.manifest.id, {
				id: bundle.manifest.id,
				origin,
				version: bundle.manifest.version,
				size,
				installedAt
			});
		}
		return ok;
	}

	/** 同じ ID のものがすでに入っていて、出所が違うときは、上書きしない */
	private checkConflict(id: string, origin: ExtensionOrigin): void {
		const existing = this.infos.get(id);
		if (existing && existing.origin !== origin) {
			throw new PackInstallError(
				`同じ ID「${id}」の拡張が、別の出所(${existing.origin})で入っています。先にアンインストールしてください`
			);
		}
		if (!existing && extensionHost.extensions.some((e) => e.manifest.id === id)) {
			throw new PackInstallError(`ID「${id}」は、Storift に同梱の拡張が使っています`);
		}
	}

	private async persist(record: InstalledPackRecord): Promise<void> {
		// 初回のインストールで、ブラウザに保存先を消さないよう頼む(断られても続行)
		if (!readStorage(PERSIST_ASKED_KEY)) {
			writeStorage(PERSIST_ASKED_KEY, '1');
			void requestPersistence();
		}
		await saveInstalledPack(record);
	}

	private async install(
		bundle: ParsedBundle,
		origin: 'community' | 'personal-file',
		sha256?: string
	): Promise<InstallResult> {
		const { manifest } = bundle;
		this.checkConflict(manifest.id, origin);
		const previous = extensionHost.extensions.find((e) => e.manifest.id === manifest.id);
		const reconsent =
			!!previous &&
			extensionHost.isEnabled(manifest.id) &&
			consentFingerprint(previous.manifest) !== consentFingerprint(manifest);
		const installedAt = Date.now();
		await this.persist({
			id: manifest.id,
			manifest,
			files: bundle.files,
			origin,
			size: bundle.size,
			installedAt,
			...(sha256 ? { sha256 } : {})
		});
		await this.register(bundle, origin, bundle.size, installedAt);
		return { id: manifest.id, reconsent, replaced: !!previous };
	}

	/** レジストリから取得して入れる(SHA-256・マニフェストの検証は fetchBundle が行う)。同意と有効化は呼び出し側 */
	async installFromRegistry(entry: RegistryEntry): Promise<InstallResult> {
		const fetched = await fetchBundle(entry);
		return this.install(fetched, 'community', fetched.sha256);
	}

	/** 「ファイルから追加」。レジストリと同じ検証を通す。同意と有効化は呼び出し側 */
	async installFromText(text: string): Promise<InstallResult> {
		const parsed = parseBundleText(text);
		if (!parsed.ok) {
			throw new PackInstallError(`追加できません: ${parsed.errors.slice(0, 3).join(' / ')}`);
		}
		return this.install(parsed.bundle, 'personal-file');
	}

	async uninstall(id: string): Promise<void> {
		const info = this.infos.get(id);
		if (!info) return;
		await extensionHost.removeExtension(id);
		if (info.origin !== 'personal-folder') await deleteInstalledPack(id);
		this.infos.delete(id);
		this.folderIds.delete(id);
		await themeStore.syncPackThemes();
	}

	/** 登録の新しい版があるか(同じ ID が入っていて、版が上のものだけ) */
	updateAvailable(entry: RegistryEntry): boolean {
		const info = this.infos.get(entry.id);
		return (
			!!info && info.origin === 'community' && compareVersions(entry.version, info.version) > 0
		);
	}

	// ---- 拡張フォルダ(デスクトップ版) ----

	setFolderPath(path: string): void {
		writeStorage(FOLDER_PATH_KEY, path.trim());
	}

	/** 拡張フォルダを読み直す(起動時と「再読み込み」)。フォルダから消えたパックは取り除く */
	async reloadFolder(): Promise<void> {
		if (!isDesktop()) return;
		this.folderBusy = true;
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			const result = await invoke<FolderScanResult>('extension_folder_scan', {
				path: this.folderPath || null
			});
			this.folderRoot = result.root;
			const errors: { dir: string; errors: string[] }[] = [];
			const seen = new SvelteSet<string>();
			for (const entry of result.packs) {
				const pack: FolderPack = assembleFolderPack(entry);
				if (!pack.ok) {
					errors.push({ dir: pack.dir, errors: pack.errors });
					continue;
				}
				const id = pack.bundle.manifest.id;
				const existing = this.infos.get(id);
				if (existing && existing.origin !== 'personal-folder') {
					errors.push({
						dir: pack.dir,
						errors: [`同じ ID の拡張が、別の出所(${existing.origin})で入っているため読み込みません`]
					});
					continue;
				}
				if (!existing && extensionHost.extensions.some((e) => e.manifest.id === id)) {
					errors.push({ dir: pack.dir, errors: ['同梱の拡張と同じ ID のため読み込みません'] });
					continue;
				}
				if (await this.register(pack.bundle, 'personal-folder', pack.bundle.size, Date.now())) {
					seen.add(id);
				}
			}
			for (const id of [...this.folderIds]) {
				if (!seen.has(id)) await this.uninstallFolderPack(id);
			}
			this.folderIds = seen;
			this.folderErrors = errors;
		} catch (error) {
			this.folderErrors = [
				{ dir: '(拡張フォルダ)', errors: [error instanceof Error ? error.message : String(error)] }
			];
		} finally {
			this.folderBusy = false;
		}
	}

	private async uninstallFolderPack(id: string): Promise<void> {
		await extensionHost.removeExtension(id);
		this.infos.delete(id);
		await themeStore.syncPackThemes();
	}

	/** 拡張フォルダをファイルマネージャーで開く */
	async openFolder(): Promise<void> {
		if (!isDesktop()) return;
		const { invoke } = await import('@tauri-apps/api/core');
		await invoke('extension_folder_open', { path: this.folderPath || null });
	}
}

export const packManager = new PackManager();

/** 起動時に呼ぶ: パックを読み込み、拡張を開始し、パックのテーマの設定を確定する */
export async function startExtensions(): Promise<void> {
	await packManager.init();
	await extensionHost.start();
	await themeStore.settlePackThemes();
}

export { RegistryError };
