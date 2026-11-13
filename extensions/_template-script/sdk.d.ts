/**
 * Storift スクリプト拡張の SDK(型定義)。仕様は docs/SCRIPT_API.md。
 *
 * スクリプトは、隔離された Web Worker の中で動きます。グローバルに `storift` があり、
 * DOM(`document`・`window`)・アプリの保存領域・ネットワーク(宣言したホストへの fetch 以外)には触れません。
 * エディタに型を効かせるには、スクリプトの先頭に `/// <reference path="./sdk.d.ts" />` を書きます。
 */

/** manifest.json の permissions.events に宣言したものだけ購読できます */
type StoriftEventName =
	| 'page:change'
	| 'app:visibility'
	| 'scene:updated'
	| 'scene:created'
	| 'session:start'
	| 'session:update'
	| 'session:end';

/** 執筆セッションのイベント(session:start / session:update / session:end)。本文は含みません */
interface StoriftSessionEvent {
	/** 開始時刻(最初の編集。Unix ミリ秒) */
	startedAt: number;
	/** 最後の編集の時刻(Unix ミリ秒) */
	lastEditAt: number;
	/** 終了時刻(Unix ミリ秒)。終了していなければ null */
	endedAt: number | null;
	/** 増減した文字数の合計(自分が書いた分だけ) */
	netChars: number;
	/** 終了の理由(session:end のみ) */
	reason?: 'idle' | 'manual' | 'pagehide';
	/** 作品名。permissions.read に project:title を宣言したときだけ入ります */
	projectTitle?: string;
	/** 作品の総文字数。permissions.read に project:chars を宣言したときだけ入ります */
	projectChars?: number;
}

interface StoriftEventMap {
	'page:change': { page: string };
	'app:visibility': { visible: boolean };
	'scene:updated': {
		characterCount: number;
		previousCharacterCount: number;
		delta: number;
		origin: 'user' | 'ai' | 'collab-local';
	};
	'scene:created': Record<string, never>;
	'session:start': StoriftSessionEvent;
	'session:update': StoriftSessionEvent;
	'session:end': StoriftSessionEvent;
}

/** 画面の要素(宣言的な UI 記述)。文字はすべてテキストとして描画されます(HTML は解釈されません) */
type StoriftUiNode =
	| { type: 'heading'; text: string }
	| { type: 'text'; text: string; tone?: 'normal' | 'muted' | 'warning' | 'error' }
	| {
			type: 'button';
			id: string;
			label: string;
			variant?: 'primary' | 'secondary' | 'danger';
			disabled?: boolean;
	  }
	| {
			type: 'toggle';
			id: string;
			label: string;
			value: boolean;
			description?: string;
			disabled?: boolean;
	  }
	| {
			type: 'input';
			id: string;
			label: string;
			value?: string;
			placeholder?: string;
			/** true で伏せ字(パスワード欄)にします */
			secret?: boolean;
			description?: string;
			disabled?: boolean;
	  }
	| {
			type: 'select';
			id: string;
			label: string;
			value: string;
			options: { value: string; label: string }[];
			description?: string;
			disabled?: boolean;
	  }
	| { type: 'list'; items: (string | { text: string; detail?: string })[] }
	| { type: 'progress'; value: number; label?: string }
	| { type: 'divider' }
	/** https の URL だけ。押すと、ホストが「外部サイトを開きます」と確認します */
	| { type: 'link'; label: string; url: string };

interface StoriftUiEvent {
	/** 操作された要素の id */
	id: string;
	/** button は 'press'、toggle / input / select は 'change' */
	kind: 'press' | 'change';
	/** toggle は boolean、input / select は string。press は undefined */
	value?: string | boolean;
}

interface Storift {
	/** この SDK の版 */
	readonly apiVersion: 1;
	readonly events: {
		/**
		 * イベントを購読します。manifest.json の permissions.events に宣言していないイベントは拒否されます(Promise が reject)。
		 * 返り値の関数で解除できます。
		 */
		on<K extends StoriftEventName>(
			name: K,
			handler: (payload: StoriftEventMap[K]) => void | Promise<void>
		): Promise<() => void>;
	};
	/** 端末内のストレージ(拡張ごと。合計 256KB まで)。permissions.storage: true が必要です。値は JSON で表せるもの */
	readonly storage: {
		get(key: string): Promise<unknown>;
		set(key: string, value: unknown): Promise<void>;
		delete(key: string): Promise<void>;
		list(prefix?: string): Promise<string[]>;
	};
	readonly ui: {
		/**
		 * 画面を更新します。permissions.ui: true が必要です。
		 * target: 'panel' はツールバーのポップアップ、'settings' は設定画面のカードの設定欄。nodes に null を渡すと消えます。
		 */
		set(
			target: 'panel' | 'settings',
			nodes: StoriftUiNode[] | null,
			options?: { badge?: boolean }
		): Promise<void>;
		/** 画面の操作(ボタンを押した・値を変えた)を受け取ります。1 つだけ登録できます */
		onEvent(handler: (event: StoriftUiEvent) => void): void;
	};
	/** 通知(トースト)を出します。permissions.notify: true が必要です。1 分に 5 回、200 文字までです */
	notify(message: string): Promise<void>;
}

declare const storift: Storift;
