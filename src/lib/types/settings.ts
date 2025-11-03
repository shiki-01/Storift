export interface AppSettings {
	id: 'app-settings';
	firebase?: FirebaseConfig;
	theme: 'light' | 'dark' | 'auto';
	autoTheme: boolean;
	shortcuts: {
		save: string;
		undo: string;
		redo: string;
		find: string;
		replace: string;
		newChapter: string;
		newScene: string;
	};
	autoSave: boolean;
	autoSaveInterval: number;
	syncEnabled: boolean;
	updatedAt: number;
}

export interface FirebaseConfig {
	apiKey: string;
	authDomain: string;
	projectId: string;
	storageBucket: string;
	messagingSenderId: string;
	appId: string;
}

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'conflict' | 'error';
