export type EditorFont =
	| 'yu-gothic'
	| 'gen-shin-mincho'
	| 'hiragino-mincho'
	| 'noto-sans'
	| 'noto-serif'
	| 'hannari-mincho'
	| 'sawarabi-mincho'
	| 'sawarabi-gothic'
	/** デスクトップ版限定: インストール済みフォント名(`system:フォント名`) */
	| `system:${string}`;

/**
 * この端末の Firestore へのアクセス状態
 * - owner: 新ルールで、この端末がオーナー登録済み
 * - legacy: 旧ルール(認証済みなら従来コレクションを全開放)のまま。共有機能は使えない
 * - needs-owner: 新ルールで、この端末は未登録(オーナー端末の設定コードが必要)
 * - unknown: 判定できていない(通信エラーなど)
 */
export type AccessMode = 'owner' | 'legacy' | 'needs-owner' | 'unknown';

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
	/** オーナー鍵(設定コード由来、または初回登録で生成したもの)。設定コードの生成と2台目の登録に使う */
	ownerKey?: string;
	/** 直近に判定できたアクセスモード(オフライン起動時のキャッシュ) */
	accessMode?: AccessMode;
	/** 共有プロジェクトで他のメンバーに見せる名前(参加時のメンバー一覧と在席表示に使う)。未設定ならオーナー/ゲスト-xxxx */
	displayName?: string;
	/** 初回の Firebase 設定の案内に答え済み(設定した、または同期なしで始めた) */
	setupCompleted?: boolean;
	/** チュートリアルの案内を閉じた、または終えた */
	tutorialDismissed?: boolean;
	/** 組み込みテーマ ID(light など)かカスタムテーマ ID(custom-*)。'auto' はシステム設定に従う */
	theme: string;
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
