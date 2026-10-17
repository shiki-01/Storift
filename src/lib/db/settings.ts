import { db } from './schema';
import type { AppSettings, FirebaseConfig } from '$lib/types';
import { DEFAULT_SHORTCUTS, migrateShortcuts, normalizeAutoSaveMs } from '$lib/utils/shortcuts';

const DEFAULT_SETTINGS: AppSettings = {
	id: 'app-settings',
	theme: 'auto',
	autoTheme: true,
	editorFormatting: {
		fontSize: 16,
		lineHeight: 2,
		letterSpacing: 0,
		paragraphSpacing: 16
	},
	shortcuts: { ...DEFAULT_SHORTCUTS },
	autoSave: true,
	autoSaveInterval: 30000, // 30秒
	syncEnabled: true,
	conflictResolution: 'manual',
	exportPatterns: [],
	updatedAt: Date.now()
};

export const settingsDB = {
	async get(): Promise<AppSettings> {
		const settings = await db.settings.get('app-settings');
		if (!settings) return { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SHORTCUTS } };
		// 旧バージョンの保存値を新しい仕様へそろえる(保存データ自体は書き換えない)
		return {
			...settings,
			shortcuts: migrateShortcuts(settings.shortcuts),
			autoSaveInterval: normalizeAutoSaveMs(settings.autoSaveInterval)
		};
	},

	async update(changes: Partial<AppSettings>): Promise<void> {
		const existing = await this.get();
		await db.settings.put({
			...existing,
			...changes,
			id: 'app-settings',
			updatedAt: Date.now()
		});
	},

	async setFirebaseConfig(config: FirebaseConfig): Promise<void> {
		await this.update({ firebase: config });
	},

	async getFirebaseConfig(): Promise<FirebaseConfig | undefined> {
		const settings = await this.get();
		return settings.firebase;
	},

	async clearFirebaseConfig(): Promise<void> {
		await this.update({ firebase: undefined });
	}
};
