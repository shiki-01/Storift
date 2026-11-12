/**
 * 拡張「Monolog. 連携」。執筆している間の時間を Monolog.(時間記録アプリ)に記録する。
 * 仕様は docs/EXTENSIONS.md を参照。
 */
import { isDesktop } from '$lib/desktop/platform';
import type { Extension, ExtensionContext } from '../../types';
import { MonologSessionManager } from './session';
import { monologSettings } from './settings.svelte';
import {
	completeAuthorization,
	AuthFlowError,
	isDesktopCallback,
	monologClient,
	monologState,
	monologTokens,
	refreshConnection
} from './service.svelte';

let manager: MonologSessionManager | null = null;
let teardown: Array<() => void> = [];

/** 開いているセッションの終了。設定画面の「いま終了して記録する」から使う */
export function endMonologSessionNow() {
	return manager?.finish('manual') ?? Promise.resolve('none' as const);
}

async function listenDeepLinks(ctx: ExtensionContext): Promise<() => void> {
	const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link');
	const handle = async (urls: string[] | null) => {
		for (const url of urls ?? []) {
			if (!isDesktopCallback(url)) continue;
			try {
				await completeAuthorization(url);
				ctx.notify.success('Monolog. に接続しました');
			} catch (error) {
				// 手続きの記録が無い(同じ URL の重複配信など)ときは何もしない
				if (error instanceof AuthFlowError && error.kind === 'no-pending') continue;
				ctx.notify.error(error instanceof Error ? error.message : '接続に失敗しました');
			}
		}
	};
	// アプリが deep link で起動された場合の URL(起動後すぐに届く onOpenUrl とは別に取る)
	void getCurrent().then(handle, () => {});
	return await onOpenUrl((urls) => void handle(urls));
}

export const monologExtension: Extension = {
	manifest: {
		id: 'monolog',
		name: 'Monolog. 連携',
		description: '執筆している間の時間と増減した文字数を、時間記録アプリ Monolog. に記録します。',
		platforms: ['web', 'desktop']
	},

	async activate(ctx) {
		const session = new MonologSessionManager({
			client: monologClient,
			getSettings: () => monologSettings.value,
			getProjectTitle: ctx.getProjectTitle,
			notify: ctx.notify,
			ensureTokenFresh: (margin) => monologTokens.ensureFresh(margin),
			onActiveChange: (active) => {
				monologState.sessionActive = active;
			}
		});
		manager = session;

		teardown.push(
			ctx.events.on('scene:updated', (event) => {
				// 未接続のときは何もしない(メモリ上の状態を見るだけ)
				if (['unknown', 'disconnected', 'reauth'].includes(monologState.connection)) return;
				session.handleSceneUpdated(event);
			})
		);

		// ページを閉じる/隠れるとき、計測中なら終了を送る
		const onPageHide = () => session.flushOnHide();
		window.addEventListener('pagehide', onPageHide);
		teardown.push(() => window.removeEventListener('pagehide', onPageHide));

		if (isDesktop()) {
			try {
				teardown.push(await listenDeepLinks(ctx));
			} catch (error) {
				console.error('deep link を待ち受けられませんでした:', error);
			}
		}

		// 接続状態の確認は待たない(起動を遅らせない)。確認できるまでは未接続として扱う
		void refreshConnection();
	},

	async deactivate() {
		for (const fn of teardown) fn();
		teardown = [];
		const session = manager;
		manager = null;
		monologState.sessionActive = false;
		await session?.dispose();
	}
};
