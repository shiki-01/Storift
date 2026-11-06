import { db, settingsDB } from '$lib/db';
import { settingsStore } from '$lib/stores/settings.svelte';
import { themeStore } from '$lib/stores/theme.svelte';
import { DEFAULT_SHORTCUTS } from '$lib/utils/shortcuts';
import type { AppSettings } from '$lib/types/settings';

/**
 * 設定画面の各セクションが共有する、編集中の設定と保存・読み込み。
 * セクションは 1 つずつ表示するため、切り替えても値が残るよう、ページ側で 1 つだけ作って渡す
 */
export class SettingsForm {
	settings = $state<Omit<AppSettings, 'id' | 'updatedAt'>>({
		theme: themeStore.theme.id as 'light' | 'dark' | 'auto',
		autoTheme: themeStore.isAutoTheme,
		autoSave: true,
		autoSaveInterval: 30000,
		syncEnabled: true,
		conflictResolution: 'manual',
		editorFormatting: {
			fontSize: 16,
			lineHeight: 2,
			letterSpacing: 0,
			paragraphSpacing: 16
		},
		shortcuts: { ...DEFAULT_SHORTCUTS },
		exportPatterns: []
	});

	/** 自動保存の最大待ち時間は画面では秒で扱う */
	autoSaveSeconds = $state(30);

	/** 設定の保存 */
	save = async () => {
		try {
			// 既存の設定を取得してFirebase設定を保持
			const existing = await db.settings.get('app-settings');

			// 既存の設定(エディタのフォントなど、この画面で扱わない項目)を保ったまま上書きする。
			// Svelte のリアクティブなプロパティは、プレーンな値に変換してから保存する
			const plainSettings = {
				...existing,
				id: 'app-settings' as const,
				theme: this.settings.theme,
				autoTheme: this.settings.autoTheme,
				autoSave: this.settings.autoSave,
				autoSaveInterval: this.settings.autoSaveInterval,
				syncEnabled: this.settings.syncEnabled,
				conflictResolution: this.settings.conflictResolution,
				editorFormatting: { ...this.settings.editorFormatting },
				shortcuts: { ...this.settings.shortcuts },
				exportPatterns: existing?.exportPatterns || [],
				updatedAt: Date.now()
			} as AppSettings;

			await db.settings.put(plainSettings);
			// 他の画面(エディタなど)にもすぐ反映する
			settingsStore.settings = { ...settingsStore.settings, ...plainSettings };
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	};

	/** 設定の読み込み */
	load = async () => {
		try {
			const raw = await db.settings.get('app-settings');
			if (raw) {
				// 旧バージョンの値は settingsDB.get() で新しい仕様にそろえる
				const saved = await settingsDB.get();
				this.settings.theme = saved.theme;
				this.settings.autoTheme = saved.autoTheme;
				this.settings.autoSave = saved.autoSave;
				this.settings.autoSaveInterval = saved.autoSaveInterval;
				this.autoSaveSeconds = Math.round(saved.autoSaveInterval / 1000);
				this.settings.syncEnabled = saved.syncEnabled;
				this.settings.conflictResolution = saved.conflictResolution || 'manual';
				this.settings.editorFormatting = saved.editorFormatting || this.settings.editorFormatting;
				this.settings.shortcuts = { ...saved.shortcuts };
			}
		} catch (error) {
			console.error('Failed to load settings:', error);
		}
	};
}
