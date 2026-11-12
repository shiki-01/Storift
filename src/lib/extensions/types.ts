import type { Component } from 'svelte';
import type { ExtensionEvents, PageChangeEvent, WritingSessionEvent } from './events';

import type { ExtensionManifest, ExtensionOrigin, ExtensionPlatform } from './manifest';
import type { PackContent } from './pack';

export type { ExtensionManifest, ExtensionOrigin, ExtensionPlatform } from './manifest';

/** 拡張に渡す通知(トースト)。UI の実装には依存させない */
export interface ExtensionNotifier {
	success(message: string): void;
	error(message: string): void;
	info(message: string): void;
}

/** 拡張から見た執筆セッション */
export interface ExtensionSessionApi {
	/** 進行中のセッション(無ければ null)。作品名は、権限 `project:title` を宣言した拡張にだけ入る */
	current(): WritingSessionEvent | null;
	/** 進行中のセッションを、利用者の操作として終了する(session:end の reason は 'manual')。無ければ false */
	endNow(): boolean;
}

/** 拡張から見たアプリの状態 */
export interface ExtensionAppApi {
	/** いま開いている画面(`page:change` の最新の値)。まだ分からなければ null */
	page(): PageChangeEvent | null;
	/** アプリが前面にあるか */
	visible(): boolean;
}

/**
 * 拡張に渡す API。拡張は DB に直接触れず、ここにあるものだけを使う。
 * イベントは購読のみで、マニフェストの `permissions.events` に宣言したものだけを購読できる。
 * 作品名は、`permissions.read` に `project:title` を宣言した拡張にだけ渡す
 */
export interface ExtensionContext {
	platform: ExtensionPlatform;
	/** イベントの購読(`on` の返り値で解除)。宣言していないイベントを購読すると例外になる */
	events: ExtensionEvents;
	session: ExtensionSessionApi;
	app: ExtensionAppApi;
	/** 作品名の読み取り(読み取り専用)。見つからない、または権限が無ければ undefined */
	getProjectTitle(projectId: string): Promise<string | undefined>;
	/** 作品の総文字数(読み取り専用)。見つからない、または権限 `project:chars` が無ければ undefined */
	getProjectCharCount(projectId: string): Promise<number | undefined>;
	notify: ExtensionNotifier;
}

/** ポップアップ(モバイルでは下から出るシート)の中身に渡す props。拡張に見せるのはこれだけ */
export interface ExtensionPanelProps {
	/** ポップアップを閉じる */
	close: () => void;
}

/**
 * 拡張が執筆画面のツールバーに出す項目。アイコンを押すとポップアップで panel を開く。
 * 有効で、現在のプラットフォームに対応する拡張の項目だけが現れる(並べ替え・三点メニューの対象にもなる)
 */
export interface ExtensionToolbarContribution {
	/** 拡張の中で一意な ID。設定に保存する項目 ID は `ext:<拡張 ID>` になる(1 拡張につき 1 項目) */
	id: string;
	/** ボタンの名前(ツールチップ・設定の一覧・メニューに出る) */
	label: string;
	/** Icon.svelte の名前(src/lib/components/editor/icons の SVG) */
	icon: string;
	/** ポップアップの中身 */
	panel: Component<ExtensionPanelProps>;
	/** true の間、アイコンに小さなインジケータ(ドット)を出す。リアクティブな状態だけを読むこと */
	badge?: () => boolean;
	/**
	 * スマホの上部バー(シーン名の下の状態の行)に出す小さな表示(任意)。props は受け取らない。
	 * 出すものが無いときは、何も描画しないこと
	 */
	status?: Component;
}

export interface Extension {
	manifest: ExtensionManifest;
	/** 出所。省略は公式(アプリに同梱) */
	origin?: ExtensionOrigin;
	/** パックのコンテンツ(検証済み。パックのみ) */
	content?: PackContent;
	/** ツールバーに出す項目(任意) */
	toolbar?: ExtensionToolbarContribution;
	/**
	 * 設定画面の拡張のカードに出す、拡張固有の設定(任意。公式の拡張は Svelte コンポーネント)。
	 * 有効で、このプラットフォームに対応しているときだけ読み込む(props は受け取らない)
	 */
	settings?: () => Promise<{ default: Component }>;
	/** 有効化されたとき(起動時に有効な場合を含む)に呼ばれる */
	activate(ctx: ExtensionContext): void | Promise<void>;
	/** 無効化されたときに呼ばれる。購読・タイマー・リスナーをすべて解除する */
	deactivate(): void | Promise<void>;
}
