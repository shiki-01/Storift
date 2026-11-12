/**
 * 拡張向けのイベント。型付きの小さなイベントエミッタ。
 * 発行側(`src/lib/db/scenes.ts` など)は購読者がいなければ何もしない。
 * 拡張に公開するのは購読(`on`)だけで、発行(`emit`)は本体だけが行う。
 */

import type { PageId } from './pages';

/**
 * 本文の変更が、誰(何)によるものか。
 * - user: 利用者がエディタで書いた変更(入力・貼り付け・執筆支援・校正の反映・元に戻す)
 * - ai: AI の提案を適用した変更
 * - collab-local: 共有プロジェクト(共同編集)のシーンで、利用者自身が書いた変更
 *
 * 他の人の変更の取り込み・同期・復元・検索置換・インポートでは、イベントを発行しない(docs/EXTENSIONS.md)
 */
export type SceneChangeOrigin = 'user' | 'ai' | 'collab-local';

/** 本文が実際に変わって保存されたとき */
export interface SceneUpdatedEvent {
	sceneId: string;
	chapterId: string;
	projectId: string;
	/** 保存後の文字数 */
	characterCount: number;
	/** 保存前の文字数 */
	previousCharacterCount: number;
	/**
	 * この origin による文字数の増減。増減を数えるときは、これを使う。
	 * 共同編集では他の人の変更が同じ保存に混ざるため、`characterCount - previousCharacterCount` とは一致しない
	 */
	delta: number;
	origin: SceneChangeOrigin;
}

export interface SceneCreatedEvent {
	sceneId: string;
	chapterId: string;
	projectId: string;
}

/** 執筆セッションが終わった理由。idle=無操作 / manual=利用者の操作 / pagehide=ページを閉じた・隠れた */
export type SessionEndReason = 'idle' | 'manual' | 'pagehide';

/** 執筆セッションのイベント(session:start / session:update / session:end)の payload */
export interface WritingSessionEvent {
	sessionId: string;
	/** 開始時刻(最初の編集。Unix ミリ秒) */
	startedAt: number;
	/** 最後の編集の時刻(Unix ミリ秒) */
	lastEditAt: number;
	/** 終了時刻(Unix ミリ秒)。終了していなければ null。無操作による終了では、最後の編集の時刻 */
	endedAt: number | null;
	/** 増減した文字数の合計(利用者が書いた分だけ。AI の適用・他の人の変更は含まない) */
	netChars: number;
	/** セッションを始めた作品 */
	projectId: string;
	/** 作品名。権限 `project:title` を宣言した拡張にだけ渡す(読み込みが終わるまでは undefined) */
	projectTitle?: string;
	/** 終了理由(session:end のときだけ) */
	reason?: SessionEndReason;
}

/** 開いている画面が変わった(起動時の最初の画面を含む)。作品の画面なら projectId が付く */
export interface PageChangeEvent {
	page: PageId;
	projectId?: string;
}

/** アプリの表示状態が変わった(別のウィンドウに移った・最小化した・戻った) */
export interface AppVisibilityEvent {
	visible: boolean;
}

export interface ExtensionEventMap {
	'page:change': PageChangeEvent;
	'app:visibility': AppVisibilityEvent;
	'scene:updated': SceneUpdatedEvent;
	'scene:created': SceneCreatedEvent;
	'session:start': WritingSessionEvent;
	'session:update': WritingSessionEvent;
	'session:end': WritingSessionEvent;
}

export type ExtensionEventName = keyof ExtensionEventMap;

/** 拡張に見せる購読専用の窓口 */
export interface ExtensionEvents {
	on<K extends ExtensionEventName>(
		name: K,
		handler: (payload: ExtensionEventMap[K]) => void | Promise<void>
	): () => void;
}

type Handler<T> = (payload: T) => void | Promise<void>;

export class EventEmitter implements ExtensionEvents {
	private handlers = new Map<ExtensionEventName, Set<Handler<never>>>();
	private watchers = new Set<() => void>();

	on<K extends ExtensionEventName>(name: K, handler: Handler<ExtensionEventMap[K]>): () => void {
		let set = this.handlers.get(name);
		if (!set) {
			set = new Set();
			this.handlers.set(name, set);
		}
		const entry = handler as Handler<never>;
		set.add(entry);
		this.notifyWatchers();
		return () => {
			if (set.delete(entry)) this.notifyWatchers();
		};
	}

	/**
	 * 購読者の増減を知らせる(本体用)。執筆セッションの追跡のように、
	 * 購読者がいる間だけ動かしたい処理が使う。返り値で解除
	 */
	watchListeners(callback: () => void): () => void {
		this.watchers.add(callback);
		return () => {
			this.watchers.delete(callback);
		};
	}

	private notifyWatchers(): void {
		for (const callback of [...this.watchers]) {
			try {
				callback();
			} catch (error) {
				console.error('拡張のイベントの購読状態を処理できませんでした:', error);
			}
		}
	}

	/** 購読者がいるか。発行側が、いなければ payload の組み立てごと省くために使う */
	hasListeners(name: ExtensionEventName): boolean {
		return (this.handlers.get(name)?.size ?? 0) > 0;
	}

	listenerCount(name: ExtensionEventName): number {
		return this.handlers.get(name)?.size ?? 0;
	}

	/**
	 * 発行する。待たない(執筆の保存を遅くしない)。
	 * 購読者の例外は握りつぶして他の購読者・発行元に影響させない
	 */
	emit<K extends ExtensionEventName>(name: K, payload: ExtensionEventMap[K]): void {
		const set = this.handlers.get(name);
		if (!set || set.size === 0) return;
		for (const handler of [...set]) {
			try {
				const result = (handler as Handler<ExtensionEventMap[K]>)(payload);
				if (result && typeof result.catch === 'function') {
					result.catch((error) =>
						console.error(`拡張のイベント処理に失敗しました (${name}):`, error)
					);
				}
			} catch (error) {
				console.error(`拡張のイベント処理に失敗しました (${name}):`, error);
			}
		}
	}

	clear(): void {
		this.handlers.clear();
		this.notifyWatchers();
	}
}

/** アプリ全体で共有するエミッタ */
export const extensionEvents = new EventEmitter();
