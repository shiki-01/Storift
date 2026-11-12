/**
 * 拡張「Monolog. 連携」。執筆している間の時間を Monolog.(時間記録アプリ)に記録する。
 * 仕様は docs/EXTENSIONS.md を参照。
 */
import manifestJson from '$extensions/monolog/manifest.json';
import { isDesktop } from '$lib/desktop/platform';
import { parseManifest } from '../../manifest';
import type { Extension, ExtensionContext } from '../../types';
import MonologBadge from './MonologBadge.svelte';
import MonologPanel from './MonologPanel.svelte';
import { MonologSessionManager } from './session';
import { monologSettings } from './settings.svelte';
import {
	completeAuthorization,
	AuthFlowError,
	isDesktopCallback,
	monologClient,
	monologControl,
	monologState,
	monologTokens,
	refreshConnection
} from './service.svelte';

let manager: MonologSessionManager | null = null;
let teardown: Array<() => void> = [];

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
	// 名前・説明・権限・扱う情報は、extensions/monolog/manifest.json が単一の情報源
	manifest: parseManifest(manifestJson, 'monolog'),

	toolbar: {
		id: 'monolog',
		label: 'Monolog.',
		icon: 'clock',
		panel: MonologPanel,
		// 計測中は、アイコンにドットを出す
		badge: () => monologState.sessionActive,
		// スマホの上部バーの「計測中」表示
		status: MonologBadge
	},

	settings: () => import('./MonologSettings.svelte'),

	async activate(ctx) {
		const session = new MonologSessionManager({
			client: monologClient,
			getSettings: () => monologSettings.value,
			notify: ctx.notify,
			// 未接続のときは記録を始めない(メモリ上の状態を見るだけ)
			isConnected: () => !['unknown', 'disconnected', 'reauth'].includes(monologState.connection),
			ensureTokenFresh: (margin) => monologTokens.ensureFresh(margin),
			onActiveChange: (active) => {
				monologState.sessionActive = active;
			}
		});
		manager = session;
		monologControl.snapshot = () => session.snapshot();
		// 「いま終了して記録する」: Monolog. への記録を終え、本体の執筆セッションも終了する
		// (先に記録を始めるので、このあと届く session:end では二重に記録しない)
		monologControl.endNow = () => {
			const outcome = session.finish('manual');
			ctx.session.endNow();
			return outcome;
		};
		// 連携の解除の前など、Monolog. への記録だけを終える(本体の執筆セッションは続く)
		monologControl.finishRecording = () => session.finish('manual');

		// 本体の執筆セッション(開始・経過・終了。ページを閉じる/隠れるときの終了を含む)を購読する
		teardown.push(session.attach(ctx.events));

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
		monologControl.snapshot = () => null;
		monologControl.endNow = async () => 'none';
		monologControl.finishRecording = async () => 'none';
		monologState.sessionActive = false;
		await session?.dispose();
	}
};
