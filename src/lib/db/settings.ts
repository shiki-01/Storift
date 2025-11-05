import { db } from './schema';
import type { AppSettings, FirebaseConfig } from '$lib/types';

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
	shortcuts: {
		save: 'Ctrl+S',
		undo: 'Ctrl+Z',
		redo: 'Ctrl+Y',
		find: 'Ctrl+F',
		replace: 'Ctrl+H',
		newChapter: 'Ctrl+Shift+N',
		newScene: 'Ctrl+Alt+N'
	},
	autoSave: true,
	autoSaveInterval: 30000, // 30秒
	syncEnabled: true,
	conflictResolution: 'manual',
	updatedAt: Date.now()
};

export const settingsDB = {
	async get(): Promise<AppSettings> {
		const settings = await db.settings.get('app-settings');
		return settings || DEFAULT_SETTINGS;
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
