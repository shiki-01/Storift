/**
 * 拡張の有効状態と、activate / deactivate の管理。
 *
 * 有効/無効は端末ごとに localStorage へ保存する。Dexie・Firestore 同期・バックアップ・エクスポートには含めない
 * (端末ごとに、拡張が使えるか・使いたいかが違うため)。読み書きは失敗しても動作を止めない。
 */
import { SvelteSet } from 'svelte/reactivity';
import { projectsDB } from '$lib/db/projects';
import { toast } from '$lib/stores/toast.svelte';
import { extensionEvents, type ExtensionEvents } from './events';
import { EXTENSIONS, currentPlatform, isSupported, toolbarItemId } from './registry';
import type {
	Extension,
	ExtensionContext,
	ExtensionPlatform,
	ExtensionToolbarContribution
} from './types';

/** ツールバーに出す、有効な拡張の項目 */
export interface ActiveToolbarItem extends ExtensionToolbarContribution {
	/** 設定に保存する項目 ID(`ext:<拡張 ID>`) */
	itemId: string;
	extensionId: string;
}

export const ENABLED_STORAGE_KEY = 'storift:extensions:enabled';

export interface ExtensionHostDeps {
	extensions: readonly Extension[];
	platform: ExtensionPlatform;
	events: ExtensionEvents;
	storage: Pick<Storage, 'getItem' | 'setItem'> | null;
	getProjectTitle(projectId: string): Promise<string | undefined>;
	notify: ExtensionContext['notify'];
}

function defaultStorage(): ExtensionHostDeps['storage'] {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

export class ExtensionHost {
	private enabled: SvelteSet<string>;
	private active = new SvelteSet<string>();
	private started = false;

	constructor(private deps: ExtensionHostDeps) {
		this.enabled = new SvelteSet(this.load());
	}

	private load(): string[] {
		try {
			const raw = this.deps.storage?.getItem(ENABLED_STORAGE_KEY);
			if (!raw) return [];
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
		} catch {
			return [];
		}
	}

	private save(): void {
		try {
			this.deps.storage?.setItem(ENABLED_STORAGE_KEY, JSON.stringify([...this.enabled]));
		} catch (error) {
			console.warn('拡張機能の有効状態を保存できませんでした:', error);
		}
	}

	get extensions(): readonly Extension[] {
		return this.deps.extensions;
	}

	get platform(): ExtensionPlatform {
		return this.deps.platform;
	}

	/** 利用者が有効にしているか(非対応のプラットフォームでも、保存された値は残る) */
	isEnabled(id: string): boolean {
		return this.enabled.has(id);
	}

	/** このプラットフォームで使えるか */
	isSupported(id: string): boolean {
		const ext = this.deps.extensions.find((e) => e.manifest.id === id);
		return !!ext && isSupported(ext.manifest, this.deps.platform);
	}

	/** 実際に activate 済みか */
	isActive(id: string): boolean {
		return this.active.has(id);
	}

	/**
	 * ツールバーに出す項目の一覧(拡張の登録順)。
	 * 利用者が有効にしていて、このプラットフォームに対応する拡張だけ。activate の完了は待たない
	 * (無効にしたら即座に消え、有効にしたら即座に現れる)
	 */
	get toolbarItems(): ActiveToolbarItem[] {
		const items: ActiveToolbarItem[] = [];
		for (const ext of this.deps.extensions) {
			const id = ext.manifest.id;
			if (!ext.toolbar || !this.enabled.has(id) || !this.isSupported(id)) continue;
			items.push({ ...ext.toolbar, itemId: toolbarItemId(id), extensionId: id });
		}
		return items;
	}

	private createContext(): ExtensionContext {
		return {
			platform: this.deps.platform,
			// 購読だけを渡す(emit を拡張に見せない)
			events: { on: (name, handler) => this.deps.events.on(name, handler) },
			getProjectTitle: (id) => this.deps.getProjectTitle(id),
			notify: this.deps.notify
		};
	}

	private async activate(ext: Extension): Promise<void> {
		const id = ext.manifest.id;
		if (this.active.has(id) || !isSupported(ext.manifest, this.deps.platform)) return;
		// 失敗しても残らないよう、先に印を付けて例外時に戻す(二重 activate の防止)
		this.active.add(id);
		try {
			await ext.activate(this.createContext());
		} catch (error) {
			console.error(`拡張機能 ${id} を開始できませんでした:`, error);
			this.active.delete(id);
			try {
				await ext.deactivate();
			} catch {
				// 後始末の失敗は無視する
			}
			this.deps.notify.error(`拡張機能「${ext.manifest.name}」を開始できませんでした`);
		}
	}

	private async deactivate(ext: Extension): Promise<void> {
		const id = ext.manifest.id;
		if (!this.active.has(id)) return;
		this.active.delete(id);
		try {
			await ext.deactivate();
		} catch (error) {
			console.error(`拡張機能 ${id} を停止できませんでした:`, error);
		}
	}

	/** 起動時に呼ぶ。有効で、このプラットフォームに対応する拡張だけ activate する */
	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		for (const ext of this.deps.extensions) {
			if (this.enabled.has(ext.manifest.id)) await this.activate(ext);
		}
	}

	/** 有効/無効を切り替える。保存し、起動済みなら即時に activate / deactivate する */
	async setEnabled(id: string, value: boolean): Promise<void> {
		const ext = this.deps.extensions.find((e) => e.manifest.id === id);
		if (!ext) return;
		if (value) {
			if (!isSupported(ext.manifest, this.deps.platform)) return;
			this.enabled.add(id);
			this.save();
			if (this.started) await this.activate(ext);
		} else {
			this.enabled.delete(id);
			this.save();
			await this.deactivate(ext);
		}
	}

	/** 全部止める(テストや終了処理用。有効状態は変えない) */
	async stop(): Promise<void> {
		for (const ext of this.deps.extensions) await this.deactivate(ext);
		this.started = false;
	}
}

export const extensionHost = new ExtensionHost({
	extensions: EXTENSIONS,
	platform: currentPlatform(),
	events: extensionEvents,
	storage: defaultStorage(),
	async getProjectTitle(projectId) {
		try {
			return (await projectsDB.getById(projectId))?.title;
		} catch {
			return undefined;
		}
	},
	notify: {
		success: (m) => void toast.success(m),
		error: (m) => void toast.error(m),
		info: (m) => void toast.info(m)
	}
});
