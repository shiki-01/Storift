import type { AppSettings, EditorFont } from '$lib/types';

let settings = $state<AppSettings>({
	id: 'app-settings',
	theme: 'auto',
	autoTheme: true,
	editorFont: 'yu-gothic',
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
		newChapter: 'Ctrl+Shift+C',
		newScene: 'Ctrl+Shift+S'
	},
	autoSave: true,
	autoSaveInterval: 30000,
	syncEnabled: true,
	conflictResolution: 'manual',
	exportPatterns: [],
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
	get editorFont() {
		return settings.editorFont || 'yu-gothic';
	},
	set editorFont(value: EditorFont) {
		settings.editorFont = value;
	},
	get editorFormatting() {
		return settings.editorFormatting;
	},
	set editorFormatting(value: AppSettings['editorFormatting']) {
		settings.editorFormatting = value;
	},
	get hasFirebaseConfig() {
		return settings.firebase !== undefined;
	}
};
