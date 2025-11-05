export type EditorFont = 
	| 'yu-gothic'
	| 'gen-shin-mincho'
	| 'hiragino-mincho'
	| 'noto-sans'
	| 'noto-serif'
	| 'hannari-mincho'
	| 'sawarabi-mincho'
	| 'sawarabi-gothic';

export type ConflictResolutionPolicy = 'local' | 'remote' | 'manual';

export interface AppSettings {
	id: 'app-settings';
	firebase?: FirebaseConfig;
	theme: 'light' | 'dark' | 'auto';
	autoTheme: boolean;
	editorFont?: EditorFont;
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
	conflictResolution: ConflictResolutionPolicy;
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
