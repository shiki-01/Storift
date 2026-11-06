import * as Y from 'yjs';
import type { PresenceCursor } from './presencePolicy';

/**
 * 他者のカーソル/選択範囲の表示(段階 4)の純粋なロジック。DOM には依存しない。
 * - 位置の送受信: 文字インデックスを Y.RelativePosition の JSON にして presence に載せ、受け取った側は
 *   現在の Y.Text の絶対インデックスへ戻す(そのあいだに編集が入っても、同じ文字の隣に留まる)。
 * - 書き込みの間引き: 選択の変化は 3 秒以上あけて書く(最後の位置は必ず送る)。
 * - インデックス → DOM 位置: contenteditable の数え方(<br> と 2 つ目以降の <div> は改行 1 文字)に合わせる。
 */

/** カーソルを書き込む最小の間隔(ms)。Spark の書き込み上限への配慮(docs/SYNC_OPTIMIZATION.md) */
export const CURSOR_SEND_INTERVAL_MS = 3_000;
/** フォーカスを失ってから cursor を消すまでの猶予(ms)。ツールバー操作などの一瞬の外れを無視する */
export const CURSOR_BLUR_DELAY_MS = 600;
/** 名前ラベルをはっきり見せる時間(ms)。位置が変わってからこの間だけ濃く出す */
export const CURSOR_LABEL_SHOW_MS = 2_000;

// ---------- 相対位置のシリアライズ ----------

/** 本文上の選択範囲 [start, end) を presence の cursor にする(向きは持たず、anchor=start・head=end) */
export function encodeCursor(
	ytext: Y.Text,
	selection: { start: number; end: number }
): PresenceCursor {
	const length = ytext.length;
	const clampIndex = (i: number) => Math.min(Math.max(0, Math.floor(i)), length);
	// relativePositionToJSON は item に ID クラスのインスタンスを入れるので、Firestore に書けるよう素のオブジェクトにする
	const toJSON = (i: number) =>
		JSON.parse(
			JSON.stringify(
				Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, clampIndex(i)))
			)
		) as Record<string, unknown>;
	return { anchor: toJSON(selection.start), head: toJSON(selection.end) };
}

/**
 * presence の cursor を、今の Y.Text 上の絶対インデックスにする。
 * 位置が復元できない(形が違う・別の文書・まだ届いていない更新を指している)ときは null。
 */
export function decodeCursor(
	ydoc: Y.Doc,
	ytext: Y.Text,
	cursor: PresenceCursor
): { anchor: number; head: number } | null {
	const resolve = (json: Record<string, unknown>): number | null => {
		try {
			const abs = Y.createAbsolutePositionFromRelativePosition(
				Y.createRelativePositionFromJSON(json),
				ydoc
			);
			if (!abs || abs.type !== ytext) return null;
			return Math.min(abs.index, ytext.length);
		} catch {
			return null;
		}
	};
	const anchor = resolve(cursor.anchor);
	const head = resolve(cursor.head);
	if (anchor === null || head === null) return null;
	return { anchor, head };
}

/** cursor の同一性判定用キー(null は 'null')。変化の検知と書き込みの省略に使う */
export function cursorKey(cursor: PresenceCursor | null): string {
	return cursor ? JSON.stringify([cursor.anchor, cursor.head]) : 'null';
}

// ---------- 書き込みの間引き ----------

export interface CursorThrottleOptions {
	intervalMs?: number;
	send(cursor: PresenceCursor | null): void;
	now?: () => number;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

export interface CursorThrottle {
	/** 送りたい最新の cursor。間隔があいていれば即送り、そうでなければ間隔が空いた時点で(trailing)送る */
	push(cursor: PresenceCursor | null): void;
	/** 別の経路(定期書き込み・シーン切り替え)で cursor を送った。以後はそれを送信済みとして扱う */
	markSent(cursor: PresenceCursor | null): void;
	/** 送る予定、または送信済みの最新の値 */
	readonly latest: PresenceCursor | null;
	dispose(): void;
}

/** 同じ内容は書かず、書き込みの間隔を intervalMs 以上あける。trailing で最後の位置は必ず送る */
export function createCursorThrottle(options: CursorThrottleOptions): CursorThrottle {
	const interval = options.intervalMs ?? CURSOR_SEND_INTERVAL_MS;
	const now = options.now ?? Date.now;
	const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
	const clearTimer =
		options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

	let latest: PresenceCursor | null = null;
	let sentKey = cursorKey(null);
	let lastSentAt = Number.NEGATIVE_INFINITY;
	let timer: unknown = null;
	let disposed = false;

	const cancel = () => {
		if (timer !== null) clearTimer(timer);
		timer = null;
	};
	const sendLatest = () => {
		cancel();
		if (disposed || cursorKey(latest) === sentKey) return;
		sentKey = cursorKey(latest);
		lastSentAt = now();
		options.send(latest);
	};

	return {
		push(cursor) {
			if (disposed) return;
			latest = cursor;
			if (cursorKey(cursor) === sentKey) {
				cancel();
				return;
			}
			if (timer !== null) return;
			const wait = interval - (now() - lastSentAt);
			if (wait <= 0) sendLatest();
			else timer = setTimer(sendLatest, wait);
		},
		markSent(cursor) {
			latest = cursor;
			sentKey = cursorKey(cursor);
			lastSentAt = now();
			cancel();
		},
		get latest() {
			return latest;
		},
		dispose() {
			disposed = true;
			cancel();
		}
	};
}

// ---------- 表示の判定 ----------

/** 名前ラベルを濃く出すか(位置が変わった直後の showMs だけ) */
export function isLabelEmphasized(
	changedAt: number,
	now: number,
	showMs: number = CURSOR_LABEL_SHOW_MS
): boolean {
	return now - changedAt < showMs;
}

// ---------- インデックス → DOM 位置 ----------

/** DOM の Node のうち、位置の計算に使う部分(テストでは同じ形のオブジェクトで代用できる) */
export interface NodeLike {
	readonly nodeType: number;
	readonly nodeName: string;
	readonly textContent: string | null;
	readonly childNodes: ArrayLike<NodeLike>;
}

export interface TextPosition {
	/** テキストノード(offset は文字数)、または要素(offset は子の番号) */
	node: NodeLike;
	offset: number;
}

const TEXT_NODE = 3;

/**
 * 本文の文字インデックスを、contenteditable 内の DOM 位置にする。
 * 数え方は $lib/utils/memos の textOffsetAt と同じ(<br> と 2 つ目以降の <div> は改行 1 文字)。
 * 行の途中・行末はテキストノード内の位置、空行は <br> の手前(親要素, 子の番号)になる。
 * 本文より後ろ(DOM が Y より短い一瞬など)は末尾に丸める。
 */
export function locateTextOffset(root: NodeLike, rawIndex: number): TextPosition {
	const index = Math.max(0, rawIndex);
	let count = 0;
	let found: TextPosition | null = null;

	const walk = (parent: NodeLike): void => {
		const children = parent.childNodes;
		for (let i = 0; i < children.length && !found; i++) {
			const node = children[i];
			if (node.nodeType === TEXT_NODE) {
				const length = node.textContent?.length ?? 0;
				if (index <= count + length) found = { node, offset: Math.max(0, index - count) };
				count += length;
			} else if (node.nodeName === 'BR') {
				if (index <= count) found = { node: parent, offset: i };
				count += 1;
			} else {
				if (node.nodeName === 'DIV' && i > 0) {
					if (index <= count) {
						found = { node: parent, offset: i };
						return;
					}
					count += 1;
				}
				walk(node);
			}
		}
	};
	walk(root);
	return found ?? { node: root, offset: root.childNodes.length };
}
