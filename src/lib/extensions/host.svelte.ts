/**
 * 拡張の有効状態・同意の記録と、activate / deactivate の管理。
 *
 * 有効/無効と同意の記録は、端末ごとに localStorage へ保存する。Dexie・Firestore 同期・バックアップ・
 * エクスポートには含めない(端末ごとに、拡張が使えるか・使いたいかが違うため)。読み書きは失敗しても動作を止めない。
 *
 * 同意: 拡張を有効にするには、マニフェストの permissions / privacy(扱う情報)への同意が要る。
 * 同意したときの版と内容を記録し、あとでマニフェストが変わったら、もう一度確認を求める(consentStatus)。
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { projectsDB } from '$lib/db/projects';
import { scenesDB } from '$lib/db/scenes';
import { toast } from '$lib/stores/toast.svelte';
import {
	extensionEvents,
	type ExtensionEventMap,
	type ExtensionEventName,
	type ExtensionEvents,
	type PageChangeEvent,
	type WritingSessionEvent
} from './events';
import { consentFingerprint, type PermissionEvent } from './manifest';
import { isRevokedVersion, type RevokedEntry } from './registryIndex';
import { EXTENSIONS, currentPlatform, isSupported, toolbarItemId } from './registry';
import { WritingSessionTracker } from './session';
import { sessionSettings } from './sessionSettings.svelte';
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
export const CONSENT_STORAGE_KEY = 'storift:extensions:consent';
/** 失効(キルスイッチ)の最新の一覧。オフラインで再起動しても、失効した拡張を動かさないために保存する */
export const REVOKED_STORAGE_KEY = 'storift:extensions:revoked';

/** 同意の記録(拡張ごと) */
export interface ConsentRecord {
	/** 同意したときのマニフェストの版 */
	version: string;
	/** 同意したときの permissions / privacy(consentFingerprint) */
	fingerprint: string;
	/** 同意した時刻(Unix ミリ秒) */
	at: number;
}

/**
 * 同意の状態。
 * - current: いまのマニフェストに同意済み
 * - none: 同意の記録が無い(同意画面ができる前から有効にしていた場合を含む)
 * - version-changed: 同意したあとに版だけが変わった(扱う情報は同じ)
 * - changed: 同意したあとに、扱う情報(permissions / privacy)が変わった
 */
export type ConsentStatus = 'current' | 'none' | 'version-changed' | 'changed';

const SESSION_EVENT_NAMES: readonly ExtensionEventName[] = [
	'session:start',
	'session:update',
	'session:end'
];

/** 作品名を除いたセッションの情報(権限 project:title が無い拡張に渡す) */
function withoutTitle(event: WritingSessionEvent): WritingSessionEvent {
	const copy = { ...event };
	delete copy.projectTitle;
	return copy;
}

export interface ExtensionHostDeps {
	extensions: readonly Extension[];
	platform: ExtensionPlatform;
	events: ExtensionEvents;
	/** 執筆セッション(本体の追跡)。省略すると、セッションは常に無い */
	session?: {
		current(): WritingSessionEvent | null;
		end(reason: 'manual'): boolean;
	};
	storage: Pick<Storage, 'getItem' | 'setItem'> | null;
	now?: () => number;
	getProjectTitle(projectId: string): Promise<string | undefined>;
	getProjectCharCount?(projectId: string): Promise<number | undefined>;
	/** アプリの状態(開いている画面・前面にあるか)。省略すると、画面は不明で前面にある */
	app?: ExtensionContext['app'];
	notify: ExtensionContext['notify'];
}

function defaultStorage(): ExtensionHostDeps['storage'] {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** 後から足し引きできる拡張(パックとスクリプト。公式は同梱のみ) */
function isAddable(ext: Extension): boolean {
	return ext.manifest.kind === 'pack' || ext.manifest.kind === 'script';
}

export class ExtensionHost {
	private enabled: SvelteSet<string>;
	private active = new SvelteSet<string>();
	private consents: SvelteMap<string, ConsentRecord>;
	/** 扱う情報が変わったため、確認されるまで動かしていない拡張 */
	private suspended = new SvelteSet<string>();
	private started = false;
	/** 運営が失効させた拡張(最後に取得できた一覧)。該当する版は有効にできない */
	private revoked: RevokedEntry[] = $state.raw([]);
	/** 拡張の一覧。同梱の拡張(公式)に加えて、パックを後から足し引きできる */
	private list: Extension[] = $state.raw([]);

	constructor(private deps: ExtensionHostDeps) {
		this.list = [...deps.extensions];
		this.enabled = new SvelteSet(this.load());
		this.consents = new SvelteMap(this.loadConsents());
		this.revoked = this.loadRevoked();
	}

	private loadRevoked(): RevokedEntry[] {
		try {
			const raw = this.deps.storage?.getItem(REVOKED_STORAGE_KEY);
			if (!raw) return [];
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(
				(e): e is RevokedEntry =>
					!!e &&
					typeof e.id === 'string' &&
					typeof e.reason === 'string' &&
					(e.versions === '*' || Array.isArray(e.versions))
			);
		} catch {
			return [];
		}
	}

	/** この拡張の、いまの版に当てはまる失効(無ければ undefined)。公式の拡張は失効の対象にしない */
	revocationOf(id: string): RevokedEntry | undefined {
		const ext = this.find(id);
		if (ext?.manifest.kind === 'official') return undefined;
		const version = ext?.manifest.version;
		return this.revoked.find(
			(e) =>
				e.id === id && (version === undefined ? e.versions === '*' : isRevokedVersion(e, version))
		);
	}

	/**
	 * 失効の一覧を反映する(取得に成功したときだけ呼ぶ)。該当する有効な拡張は、すぐ無効にする。
	 * 一覧は保存して、次の起動でも失効した版を動かさない。無効にした拡張の名前と理由を返す
	 */
	async applyRevocations(
		list: readonly RevokedEntry[]
	): Promise<{ name: string; reason: string }[]> {
		this.revoked = list.filter((e) => e.id).slice(0, 1000);
		try {
			this.deps.storage?.setItem(REVOKED_STORAGE_KEY, JSON.stringify(this.revoked));
		} catch (error) {
			console.warn('失効の一覧を保存できませんでした:', error);
		}
		const disabled: { name: string; reason: string }[] = [];
		for (const ext of [...this.list]) {
			const entry = this.revocationOf(ext.manifest.id);
			if (!entry || !this.enabled.has(ext.manifest.id)) continue;
			await this.setEnabled(ext.manifest.id, false);
			disabled.push({ name: ext.manifest.name, reason: entry.reason });
		}
		return disabled;
	}

	private loadConsents(): [string, ConsentRecord][] {
		try {
			const raw = this.deps.storage?.getItem(CONSENT_STORAGE_KEY);
			if (!raw) return [];
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
			const entries: [string, ConsentRecord][] = [];
			for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
				const v = value as Partial<ConsentRecord> | null;
				if (v && typeof v.version === 'string' && typeof v.fingerprint === 'string') {
					entries.push([
						id,
						{
							version: v.version,
							fingerprint: v.fingerprint,
							at: typeof v.at === 'number' ? v.at : 0
						}
					]);
				}
			}
			return entries;
		} catch {
			return [];
		}
	}

	private saveConsents(): void {
		try {
			this.deps.storage?.setItem(
				CONSENT_STORAGE_KEY,
				JSON.stringify(Object.fromEntries(this.consents))
			);
		} catch (error) {
			console.warn('拡張機能への同意の記録を保存できませんでした:', error);
		}
	}

	private find(id: string): Extension | undefined {
		return this.list.find((e) => e.manifest.id === id);
	}

	/** いまのマニフェストに対する、同意の状態 */
	consentStatus(id: string): ConsentStatus {
		const ext = this.find(id);
		const record = this.consents.get(id);
		if (!ext || !record) return 'none';
		if (record.fingerprint !== consentFingerprint(ext.manifest)) return 'changed';
		return record.version === ext.manifest.version ? 'current' : 'version-changed';
	}

	/**
	 * 有効にしている拡張で、利用者の確認が要るか(設定画面で確認を促す)。
	 * 同意画面ができる前から有効にしていた場合と、マニフェストが同意のあとに変わった場合
	 */
	needsReview(id: string): boolean {
		return this.enabled.has(id) && this.isSupported(id) && this.consentStatus(id) !== 'current';
	}

	/** 扱う情報が変わったため、確認されるまで動かしていないか */
	isSuspended(id: string): boolean {
		return this.suspended.has(id);
	}

	/**
	 * いまのマニフェスト(版と、扱う情報)に同意したことを記録する。同意画面で「同意」を押したときに呼ぶ。
	 * 確認待ちで止めていた拡張は、ここで動かす
	 */
	async grantConsent(id: string): Promise<void> {
		const ext = this.find(id);
		if (!ext) return;
		this.consents.set(id, {
			version: ext.manifest.version,
			fingerprint: consentFingerprint(ext.manifest),
			at: (this.deps.now ?? Date.now)()
		});
		this.saveConsents();
		if (this.suspended.delete(id) && this.started && this.enabled.has(id)) {
			await this.activate(ext);
		}
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
		return this.list;
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
		const ext = this.find(id);
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
		for (const ext of this.list) {
			const id = ext.manifest.id;
			if (!ext.toolbar || !this.enabled.has(id) || !this.isSupported(id)) continue;
			if (this.suspended.has(id)) continue;
			items.push({ ...ext.toolbar, itemId: toolbarItemId(id), extensionId: id });
		}
		return items;
	}

	/** 拡張ごとの API。マニフェストで宣言した権限の範囲だけを渡す */
	private createContext(ext: Extension): ExtensionContext {
		const { permissions, id } = ext.manifest;
		const allowedEvents: readonly PermissionEvent[] = permissions.events ?? [];
		const canReadTitle = permissions.read?.includes('project:title') ?? false;
		const canReadChars = permissions.read?.includes('project:chars') ?? false;
		const source = this.deps.events;
		const session = this.deps.session;

		const on = <K extends ExtensionEventName>(
			name: K,
			handler: (payload: ExtensionEventMap[K]) => void | Promise<void>
		): (() => void) => {
			if (!allowedEvents.includes(name)) {
				throw new Error(
					`拡張機能 ${id} は、イベント ${name} の購読を宣言していません(manifest.json の permissions.events)`
				);
			}
			// 作品名は、宣言した拡張にだけ渡す
			if (!canReadTitle && SESSION_EVENT_NAMES.includes(name)) {
				return source.on(name, (payload) =>
					handler(withoutTitle(payload as WritingSessionEvent) as ExtensionEventMap[K])
				);
			}
			return source.on(name, handler);
		};

		return {
			platform: this.deps.platform,
			// 購読だけを渡す(emit を拡張に見せない)
			events: { on },
			session: {
				current: () => {
					const current = session?.current() ?? null;
					return current && !canReadTitle ? withoutTitle(current) : current;
				},
				endNow: () => session?.end('manual') ?? false
			},
			app: this.deps.app ?? { page: () => null, visible: () => true },
			getProjectTitle: (projectId) =>
				canReadTitle ? this.deps.getProjectTitle(projectId) : Promise.resolve(undefined),
			getProjectCharCount: (projectId) =>
				canReadChars && this.deps.getProjectCharCount
					? this.deps.getProjectCharCount(projectId)
					: Promise.resolve(undefined),
			notify: this.deps.notify
		};
	}

	private async activate(ext: Extension): Promise<void> {
		const id = ext.manifest.id;
		if (this.active.has(id) || !isSupported(ext.manifest, this.deps.platform)) return;
		// 失敗しても残らないよう、先に印を付けて例外時に戻す(二重 activate の防止)
		this.active.add(id);
		try {
			await ext.activate(this.createContext(ext));
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

	/**
	 * 起動時に呼ぶ。有効で、このプラットフォームに対応する拡張だけ activate する。
	 * - 同意の記録が無い(同意画面ができる前から有効だった)、または版だけが変わった拡張は、そのまま動かす
	 *   (勝手に止めない。設定画面で確認を促す)
	 * - 同意のあとに扱う情報(permissions / privacy)が変わった拡張は、確認されるまで動かさず、通知する
	 */
	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		for (const ext of [...this.list]) {
			const id = ext.manifest.id;
			if (!this.enabled.has(id) || !isSupported(ext.manifest, this.deps.platform)) continue;
			// 運営が失効させた版は、動かさずに無効にする
			if (this.revocationOf(id)) {
				await this.setEnabled(id, false);
				continue;
			}
			if (this.consentStatus(id) === 'changed') {
				this.suspended.add(id);
				this.deps.notify.info(
					`拡張機能「${ext.manifest.name}」が扱う情報が変わりました。設定の「拡張機能」で確認すると再開します`
				);
				continue;
			}
			await this.activate(ext);
		}
	}

	/**
	 * 有効/無効を切り替える。保存し、起動済みなら即時に activate / deactivate する。
	 * 有効にできるのは、いまのマニフェストに同意済み(grantConsent)のときだけ。できなければ false。
	 * 無効にすると、同意の記録も消す(次に有効にするとき、もう一度確認する)
	 */
	async setEnabled(id: string, value: boolean): Promise<boolean> {
		const ext = this.find(id);
		if (!ext) return false;
		if (value) {
			if (!isSupported(ext.manifest, this.deps.platform)) return false;
			if (this.revocationOf(id)) return false;
			if (this.consentStatus(id) !== 'current') return false;
			this.enabled.add(id);
			this.save();
			this.suspended.delete(id);
			if (this.started) await this.activate(ext);
			return true;
		}
		this.enabled.delete(id);
		this.save();
		this.suspended.delete(id);
		if (this.consents.delete(id)) this.saveConsents();
		await this.deactivate(ext);
		return true;
	}

	/** 全部止める(テストや終了処理用。有効状態は変えない) */
	async stop(): Promise<void> {
		for (const ext of this.list) await this.deactivate(ext);
		this.started = false;
	}

	/**
	 * パック・スクリプトを追加する(同じ ID のものがあれば置き換える)。公式の拡張は置き換えられない。
	 * 有効にしていて起動済みなら、すぐ activate する。置き換えで扱う情報(permissions / privacy)が
	 * 変わり、同意のときと違えば、確認されるまで動かさない(start と同じ扱い)
	 */
	async addExtension(ext: Extension): Promise<boolean> {
		const id = ext.manifest.id;
		const prev = this.find(id);
		if (!isAddable(ext) || (prev && !isAddable(prev))) return false;
		if (prev) await this.deactivate(prev);
		this.list = prev ? this.list.map((e) => (e.manifest.id === id ? ext : e)) : [...this.list, ext];
		if (!this.started || !this.enabled.has(id) || !isSupported(ext.manifest, this.deps.platform)) {
			return true;
		}
		if (this.consentStatus(id) === 'changed') {
			this.suspended.add(id);
			this.deps.notify.info(
				`拡張機能「${ext.manifest.name}」が扱う情報が変わりました。設定の「拡張機能」で確認すると再開します`
			);
			return true;
		}
		await this.activate(ext);
		return true;
	}

	/** パック・スクリプトを取り除く(有効/無効・同意の記録も消す)。公式の拡張は取り除けない */
	async removeExtension(id: string): Promise<boolean> {
		const ext = this.find(id);
		if (!ext || !isAddable(ext)) return false;
		await this.setEnabled(id, false);
		this.list = this.list.filter((e) => e.manifest.id !== id);
		return true;
	}
}

async function readProjectTitle(projectId: string): Promise<string | undefined> {
	try {
		return (await projectsDB.getById(projectId))?.title;
	} catch {
		return undefined;
	}
}

async function readProjectCharCount(projectId: string): Promise<number | undefined> {
	try {
		const scenes = await scenesDB.getByProjectId(projectId);
		return scenes.reduce((sum, scene) => sum + (scene.characterCount ?? 0), 0);
	} catch {
		return undefined;
	}
}

/** 開いている画面と前面かどうかの最新値(本体が `page:change` / `app:visibility` を発行するたびに更新する) */
let currentPage: PageChangeEvent | null = null;
let appVisible = true;

/** ルートの変化・表示状態の変化を知らせる(ルートの +layout.svelte から呼ぶ。購読者がいなければ値を覚えるだけ) */
export function publishPage(info: PageChangeEvent): void {
	if (currentPage?.page === info.page && currentPage.projectId === info.projectId) return;
	currentPage = info;
	extensionEvents.emit('page:change', info);
}

export function publishVisibility(visible: boolean): void {
	if (appVisible === visible) return;
	appVisible = visible;
	extensionEvents.emit('app:visibility', { visible });
}

/** 執筆セッションの追跡(本体)。セッションのイベントを購読する拡張がいる間だけ動く */
export const sessionTracker = new WritingSessionTracker({
	events: extensionEvents,
	getIdleMinutes: () => sessionSettings.value.idleMinutes,
	getProjectTitle: readProjectTitle
});
sessionTracker.attach();

export const extensionHost = new ExtensionHost({
	extensions: EXTENSIONS,
	platform: currentPlatform(),
	events: extensionEvents,
	session: {
		current: () => sessionTracker.current(),
		end: (reason) => sessionTracker.end(reason)
	},
	storage: defaultStorage(),
	getProjectTitle: readProjectTitle,
	getProjectCharCount: readProjectCharCount,
	app: { page: () => currentPage, visible: () => appVisible },
	notify: {
		success: (m) => void toast.success(m),
		error: (m) => void toast.error(m),
		info: (m) => void toast.info(m)
	}
});
