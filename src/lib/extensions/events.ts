/**
 * 拡張向けのイベント。型付きの小さなイベントエミッタ。
 * 発行側(`src/lib/db/scenes.ts` など)は購読者がいなければ何もしない。
 * 拡張に公開するのは購読(`on`)だけで、発行(`emit`)は本体だけが行う。
 */

/** 本文が実際に変わって保存されたとき。自分が書いた変更だけで、同期・復元・インポート・共同編集の取り込みでは発行しない */
export interface SceneUpdatedEvent {
	sceneId: string;
	chapterId: string;
	projectId: string;
	/** 保存後の文字数 */
	characterCount: number;
	/** 保存前の文字数 */
	previousCharacterCount: number;
}

export interface SceneCreatedEvent {
	sceneId: string;
	chapterId: string;
	projectId: string;
}

export interface ExtensionEventMap {
	'scene:updated': SceneUpdatedEvent;
	'scene:created': SceneCreatedEvent;
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

	on<K extends ExtensionEventName>(name: K, handler: Handler<ExtensionEventMap[K]>): () => void {
		let set = this.handlers.get(name);
		if (!set) {
			set = new Set();
			this.handlers.set(name, set);
		}
		const entry = handler as Handler<never>;
		set.add(entry);
		return () => {
			set.delete(entry);
		};
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
	}
}

/** アプリ全体で共有するエミッタ */
export const extensionEvents = new EventEmitter();
