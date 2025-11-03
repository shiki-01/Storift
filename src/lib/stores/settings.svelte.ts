import type { AppSettings } from '$lib/types';

let settings = $state<AppSettings>({
	id: 'app-settings',
	theme: 'auto',
	shortcuts: {},
	autoSave: true,
	autoSaveInterval: 30000,
	syncEnabled: true,
	updatedAt: Date.now()
});

export const settingsStore = {
	get settings() {
		return settings;
	},
	set settings(value: AppSettings) {
		settings = value;
	},
	get theme() {
		return settings.theme;
	},
	set theme(value: AppSettings['theme']) {
		settings.theme = value;
	},
	get hasFirebaseConfig() {
		return settings.firebase !== undefined;
	}
};
