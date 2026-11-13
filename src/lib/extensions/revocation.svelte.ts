/**
 * 失効(キルスイッチ)の確認。
 *
 * 運営が失効させた拡張(extensions/revoked.json → レジストリの index.json の `revoked`)を取得して、該当する拡張を
 * すぐ無効にし、理由を表示する。確認するのは次のときだけ:
 *  (a) 設定の「拡張機能」を開いたとき
 *  (b) 「更新を確認」を押したとき
 *  (c) スクリプト拡張を 1 つでも有効にしている場合に限り、アプリの起動時に 1 日 1 回まで
 *      (設定「失効リストを自動で確認」。既定はオン。オフにすると (c) は行わない)
 * 取得先は storift.shiki-01.com に固定(registryClient.ts)。取得に失敗しても何も壊さない(何もしない)。
 * スクリプトを有効にしていない利用者は、起動時に通信しない。
 */
import { toast } from '$lib/stores/toast.svelte';
import { extensionHost } from './host.svelte';
import { fetchRegistryIndex } from './registryClient';
import type { RevokedEntry } from './registryIndex';

export const REVOCATION_AUTO_KEY = 'storift:extensions:revocation:auto';
export const REVOCATION_LAST_KEY = 'storift:extensions:revocation:last';
/** 起動時の自動確認の間隔 */
export const REVOCATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// 保存できなくても、動作は続ける
	}
}

/** 起動時の自動確認をするか(既定はオン。'0' のときだけオフ) */
export function readAutoCheck(): boolean {
	return read(REVOCATION_AUTO_KEY) !== '0';
}

/** 起動時に確認すべきか(純関数。テスト用に分けてある) */
export function shouldCheckOnStartup(options: {
	auto: boolean;
	hasEnabledScript: boolean;
	lastCheckedAt: number;
	now: number;
}): boolean {
	if (!options.auto || !options.hasEnabledScript) return false;
	return options.now - options.lastCheckedAt >= REVOCATION_INTERVAL_MS;
}

class RevocationState {
	auto = $state(readAutoCheck());
	lastCheckedAt = $state(Number(read(REVOCATION_LAST_KEY)) || 0);
	checking = $state(false);
	/** 直近の確認が失敗したか(表示用。何も壊さない) */
	failed = $state(false);
	private inflight: Promise<void> | null = null;

	setAuto(value: boolean): void {
		this.auto = value;
		write(REVOCATION_AUTO_KEY, value ? '1' : '0');
	}

	/** 取得した失効の一覧を反映する。無効にしたものは、理由つきで知らせる */
	async apply(list: readonly RevokedEntry[]): Promise<number> {
		const disabled = await extensionHost.applyRevocations(list);
		for (const { name, reason } of disabled) {
			toast.error(`「${name}」は運営により失効されたため、無効にしました: ${reason}`, {
				duration: 12_000
			});
		}
		this.lastCheckedAt = Date.now();
		write(REVOCATION_LAST_KEY, String(this.lastCheckedAt));
		return disabled.length;
	}

	/** 失効の一覧を取得して反映する(取得中に再度呼ばれたら、同じ取得を待つ)。失敗しても例外にしない */
	check(): Promise<void> {
		if (this.inflight) return this.inflight;
		this.checking = true;
		this.inflight = (async () => {
			try {
				const index = await fetchRegistryIndex();
				this.failed = false;
				await this.apply(index.revoked);
			} catch {
				// 取得できなくても、何も壊さない(いまの状態のまま)
				this.failed = true;
			} finally {
				this.checking = false;
				this.inflight = null;
			}
		})();
		return this.inflight;
	}

	/** 起動時: スクリプトを有効にしているときだけ、1 日 1 回まで確認する */
	async checkOnStartup(): Promise<void> {
		const hasEnabledScript = extensionHost.extensions.some(
			(e) =>
				e.manifest.kind === 'script' &&
				extensionHost.isEnabled(e.manifest.id) &&
				extensionHost.isSupported(e.manifest.id)
		);
		if (
			!shouldCheckOnStartup({
				auto: this.auto,
				hasEnabledScript,
				lastCheckedAt: this.lastCheckedAt,
				now: Date.now()
			})
		)
			return;
		await this.check();
	}
}

export const revocation = new RevocationState();
