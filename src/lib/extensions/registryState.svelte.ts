/**
 * 「拡張機能を探す」で取得した一覧の状態(この画面を開いている間だけ保持する)。
 * 一覧は、利用者が画面を開いたとき・「更新を確認」を押したときにだけ取得する。起動時には取得しない。
 */
import { RegistryError, fetchRegistryIndex } from './registryClient';
import type { RegistryEntry, RegistryIndex } from './registryIndex';

export type RegistryStatus = 'idle' | 'loading' | 'ready' | 'error';

class RegistryState {
	status = $state<RegistryStatus>('idle');
	index = $state<RegistryIndex | null>(null);
	error = $state('');
	/** 失敗の種類。offline はオフライン表示にする */
	errorKind = $state<RegistryError['kind'] | null>(null);
	private inflight: Promise<void> | null = null;

	/** 一覧を取得する(取得中に再度呼ばれたら、同じ取得を待つ)。失敗しても例外にしない */
	load(): Promise<void> {
		if (this.inflight) return this.inflight;
		this.status = 'loading';
		this.error = '';
		this.errorKind = null;
		this.inflight = (async () => {
			try {
				this.index = await fetchRegistryIndex();
				this.status = 'ready';
			} catch (error) {
				this.status = 'error';
				this.errorKind = error instanceof RegistryError ? error.kind : 'format';
				this.error =
					error instanceof RegistryError ? error.message : '拡張の一覧を取得できませんでした';
			} finally {
				this.inflight = null;
			}
		})();
		return this.inflight;
	}

	entry(id: string): RegistryEntry | undefined {
		return this.index?.extensions.find((e) => e.id === id);
	}
}

export const registryState = new RegistryState();
