import type { ExtensionEvents } from './events';

/** 拡張が動作するプラットフォーム。web は Web 版(PWA)、desktop はデスクトップ版(Tauri) */
export type ExtensionPlatform = 'web' | 'desktop';

export interface ExtensionManifest {
	/** 一意な ID。有効状態の保存キーにもなる(英小文字・数字・ハイフン) */
	id: string;
	/** 設定画面に出す名前 */
	name: string;
	/** 設定画面に出す説明(1 〜 2 文) */
	description: string;
	/** 動作するプラットフォーム。含まれない環境では無効表示になり、activate もされない */
	platforms: ExtensionPlatform[];
}

/** 拡張に渡す通知(トースト)。UI の実装には依存させない */
export interface ExtensionNotifier {
	success(message: string): void;
	error(message: string): void;
	info(message: string): void;
}

/**
 * 拡張に渡す API。拡張は DB に直接触れず、ここにあるものだけを使う。
 * イベントは購読のみ。読み取りは必要最小限(作品名の取得など)にとどめる
 */
export interface ExtensionContext {
	platform: ExtensionPlatform;
	/** イベントの購読(`on` の返り値で解除) */
	events: ExtensionEvents;
	/** 作品名の読み取り(読み取り専用)。見つからなければ undefined */
	getProjectTitle(projectId: string): Promise<string | undefined>;
	notify: ExtensionNotifier;
}

export interface Extension {
	manifest: ExtensionManifest;
	/** 有効化されたとき(起動時に有効な場合を含む)に呼ばれる */
	activate(ctx: ExtensionContext): void | Promise<void>;
	/** 無効化されたときに呼ばれる。購読・タイマー・リスナーをすべて解除する */
	deactivate(): void | Promise<void>;
}
