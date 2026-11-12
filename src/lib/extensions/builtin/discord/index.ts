/**
 * 拡張「Discord Rich Presence」(デスクトップ版のみ)。アプリを開いている間、この端末の Discord クライアントに
 * いま開いている画面と経過時間を表示し、執筆中は増減した文字数も表示する。仕様は docs/EXTENSIONS.md と docs/DESKTOP.md を参照。
 *
 * Web 版では一覧に「デスクトップ版のみ」と出るだけなので、このファイルはマニフェスト以外を読み込まない。
 * 本体(表示の制御・設定・Tauri の呼び出し)は、有効にしたときに動的に読み込む。
 */
import manifestJson from '$extensions/discord/manifest.json';
import { parseManifest } from '../../manifest';
import type { Extension } from '../../types';

let teardown: Array<() => void | Promise<void>> = [];

export const discordExtension: Extension = {
	// 名前・説明・権限・扱う情報は、extensions/discord/manifest.json が単一の情報源
	manifest: parseManifest(manifestJson, 'discord'),

	settings: () => import('./DiscordSettings.svelte'),

	async activate(ctx) {
		const [{ DiscordPresenceController }, { discordSettings, discordState }, { invoke }] =
			await Promise.all([
				import('./controller'),
				import('./settings.svelte'),
				import('@tauri-apps/api/core')
			]);

		const controller = new DiscordPresenceController({
			transport: {
				set: (applicationId, activity) =>
					invoke<boolean>('discord_set_activity', { applicationId, activity }),
				clear: async () => {
					await invoke('discord_clear_activity');
				}
			},
			getSettings: () => discordSettings.value,
			getProjectTitle: (id) => ctx.getProjectTitle(id),
			getProjectCharCount: (id) => ctx.getProjectCharCount(id),
			onStatusChange: (status) => {
				discordState.status = status;
			}
		});

		teardown.push(controller.attach(ctx.events));
		discordSettings.onChange = () => controller.settingsChanged();
		teardown.push(() => {
			discordSettings.onChange = null;
		});
		// 無効化のとき: 表示を消して、Discord との接続を閉じる
		teardown.push(() => controller.stop());

		// 有効にした時点の画面・セッションから表示を始める
		controller.start({
			page: ctx.app.page(),
			visible: ctx.app.visible(),
			session: ctx.session.current()
		});
	},

	async deactivate() {
		const fns = teardown;
		teardown = [];
		for (const fn of fns) {
			try {
				await fn();
			} catch (error) {
				console.error('Discord Rich Presence の後始末に失敗しました:', error);
			}
		}
	}
};
