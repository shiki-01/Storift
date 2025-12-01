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

/**
 * エクスポート時のルビ・傍点変換パターン
 */
export interface ExportFormatPattern {
	id: string;
	name: string;
	description?: string;
	// ルビ変換: $1=親文字, $2=ルビ文字
	rubyPattern: string;
	// 傍点変換: $1=傍点テキスト
	boutenPattern: string;
	// 縦棒付きルビ変換: $1=親文字, $2=ルビ文字
	rubyWithBarPattern: string;
}

export interface EditorFormatting {
	fontSize: number; // px
	lineHeight: number; // 倍率
	letterSpacing: number; // em
	paragraphSpacing: number; // px
}

export interface AppSettings {
	id: 'app-settings';
	firebase?: FirebaseConfig;
	theme: 'light' | 'dark' | 'auto';
	autoTheme: boolean;
	editorFont?: EditorFont;
	editorFormatting: EditorFormatting;
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
	exportPatterns: ExportFormatPattern[];
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
