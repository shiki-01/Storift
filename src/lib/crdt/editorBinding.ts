import * as Y from 'yjs';
import { applyEditToYText, diffText, type TextDiff } from './diff';
import { ORIGIN_AI, ORIGIN_PROGRAM } from './doc';

/**
 * エディタ(contenteditable)と Y.Text の結合のコア。DOM には依存しない(アダプタ経由で読み書きする)。
 *
 * - ローカル→Y: input のたびに、DOM の直前の本文(domBase)と今の本文の差分を Y へ反映する(origin は 'local')。
 * - IME: 変換中(compositionstart〜compositionend)は DOM→Y もリモート→DOM も保留する。
 *   開始時のキャレットを Y.RelativePosition で覚え、確定時に「確定した差分」を現在の Y の座標へ写して適用する。
 * - Y→DOM: リモートなどの変更は requestAnimationFrame でまとめて DOM に書く。書く前の選択範囲は、
 *   保留中の変更(delta)を通して新しい座標へ写して復元する。
 * - undo/redo: Y.UndoManager(自分の編集だけを対象にする)へ回す。
 */

/** 本文上の選択範囲(文字インデックス。innerText と同じ数え方) */
export interface TextSelection {
	start: number;
	end: number;
}

export interface EditorAdapter {
	/** DOM 側の本文(innerText 相当) */
	getText(): string;
	/** DOM の本文を置き換える */
	setText(text: string): void;
	/** 選択範囲。エディタの中に選択が無ければ null */
	getSelection(): TextSelection | null;
	setSelection(start: number, end: number): void;
	/** DOM が付いているか(プレビューのみの表示などで外れている間は false) */
	isAttached?(): boolean;
}

export interface Scheduler {
	/** callback を次の描画の前に 1 回呼ぶ。返り値で取り消す */
	request(callback: () => void): () => void;
}

export const frameScheduler: Scheduler = {
	request(callback) {
		if (typeof requestAnimationFrame === 'function') {
			const id = requestAnimationFrame(() => callback());
			return () => cancelAnimationFrame(id);
		}
		const id = setTimeout(callback, 16);
		return () => clearTimeout(id);
	}
};

export interface BindingDoc {
	readonly ytext: Y.Text;
	readonly ydoc: Y.Doc;
	readonly readOnly: boolean;
}

export interface EditorBindingOptions {
	doc: BindingDoc;
	adapter: EditorAdapter;
	scheduler?: Scheduler;
	/** ローカルの編集の origin(既定 'local')。UndoManager の対象もこれだけ */
	origin?: string;
	/** undo の単位をまとめる時間(ms) */
	captureTimeout?: number;
	/** Y の本文が変わるたびに呼ぶ(ストアへの反映など) */
	onText?: (text: string) => void;
}

type DeltaOp = { retain?: number; insert?: unknown; delete?: number };

/** old 座標のインデックスを、delta を適用したあとの座標へ写す。assoc>=0 は同じ位置への挿入の後ろ側に留まる */
function mapThroughDelta(index: number, delta: DeltaOp[], assoc: number): number {
	let oldPos = 0;
	let shift = 0;
	for (const op of delta) {
		if (op.retain !== undefined) {
			oldPos += op.retain;
		} else if (op.insert !== undefined) {
			const length = typeof op.insert === 'string' ? op.insert.length : 1;
			if (oldPos < index || (oldPos === index && assoc >= 0)) shift += length;
		} else if (op.delete !== undefined) {
			if (index > oldPos) shift -= Math.min(op.delete, index - oldPos);
			oldPos += op.delete;
		}
	}
	return index + shift;
}

/** 連続した変更(delta の列)を通して、最初の座標のインデックスを最後の座標へ写す */
export function mapIndexThrough(index: number, deltas: DeltaOp[][], assoc = 1): number {
	let result = index;
	for (const delta of deltas) result = mapThroughDelta(result, delta, assoc);
	return result;
}

/** delta が示す「変更のあった場所」(挿入の直後、または削除した位置)。変更が無ければ null */
export function caretFromDelta(delta: DeltaOp[]): number | null {
	let pos = 0;
	let caret: number | null = null;
	for (const op of delta) {
		if (op.retain !== undefined) {
			pos += op.retain;
		} else if (op.insert !== undefined) {
			pos += typeof op.insert === 'string' ? op.insert.length : 1;
			caret = pos;
		} else if (op.delete !== undefined) {
			caret = pos;
		}
	}
	return caret;
}

interface CompositionState {
	/** compositionstart の時点の DOM の本文 */
	base: string;
	/** そのときの選択範囲(base の座標) */
	selection: TextSelection;
	relStart: Y.RelativePosition;
	relEnd: Y.RelativePosition;
}

export class EditorBinding {
	readonly undoManager: Y.UndoManager;
	private readonly ytext: Y.Text;
	private readonly ydoc: Y.Doc;
	private readonly adapter: EditorAdapter;
	private readonly scheduler: Scheduler;
	private readonly origin: string;
	private readonly doc: BindingDoc;
	private readonly onText?: (text: string) => void;

	/** DOM に最後に反映した(または DOM から読んだ)本文 */
	private domBase = '';
	/** domBase から今の Y までの間に入った、自分以外の変更(DOM にまだ書いていないもの) */
	private pending: DeltaOp[][] = [];
	private composing = false;
	private composition: CompositionState | null = null;
	private selfWriting = false;
	private cancelFrame: (() => void) | null = null;
	private destroyed = false;

	constructor(options: EditorBindingOptions) {
		this.doc = options.doc;
		this.ytext = options.doc.ytext;
		this.ydoc = options.doc.ydoc;
		this.adapter = options.adapter;
		this.scheduler = options.scheduler ?? frameScheduler;
		this.origin = options.origin ?? 'local';
		this.onText = options.onText;
		this.undoManager = new Y.UndoManager(this.ytext, {
			// AI の提案の適用・検索置換などの書き換えも、利用者が元に戻せるようにする
			trackedOrigins: new Set([this.origin, ORIGIN_AI, ORIGIN_PROGRAM]),
			captureTimeout: options.captureTimeout ?? 500,
			doc: this.ydoc
		});
		this.ytext.observe(this.onYChange);
		this.resync();
	}

	// ---------- 状態 ----------

	/** Y の本文 */
	get text(): string {
		return this.ytext.toString();
	}

	get isComposing(): boolean {
		return this.composing;
	}

	get readOnly(): boolean {
		return this.doc.readOnly;
	}

	/** DOM に反映されていない、自分以外の変更があるか */
	get hasPendingRemote(): boolean {
		return this.pending.length > 0 || this.cancelFrame !== null;
	}

	// ---------- DOM が付け替わったとき ----------

	/** DOM を Y の本文に合わせる(最初の表示・DOM が作り直されたとき) */
	resync(): void {
		if (this.destroyed || !this.attached()) return;
		this.pending = [];
		this.cancelScheduled();
		const text = this.ytext.toString();
		if (this.adapter.getText() !== text) this.adapter.setText(text);
		this.domBase = this.adapter.getText();
	}

	// ---------- Y→DOM ----------

	private onYChange = (event: Y.YTextEvent): void => {
		if (this.destroyed) return;
		if (!this.selfWriting) {
			this.pending.push(event.delta as DeltaOp[]);
			this.scheduleSync();
		}
		this.onText?.(this.ytext.toString());
	};

	private attached(): boolean {
		return this.adapter.isAttached ? this.adapter.isAttached() : true;
	}

	private scheduleSync(): void {
		if (this.composing || this.cancelFrame || this.destroyed) return;
		this.cancelFrame = this.scheduler.request(() => {
			this.cancelFrame = null;
			this.syncDom();
		});
	}

	private cancelScheduled(): void {
		this.cancelFrame?.();
		this.cancelFrame = null;
	}

	/** 保留中のリモートの変更を今すぐ DOM に反映する(テスト・離脱前用) */
	flushRemote(): void {
		this.cancelScheduled();
		this.syncDom();
	}

	/**
	 * DOM を Y の本文にそろえる。変換中は何もしない(確定後に行う)。
	 * selection を渡せばそれを、無ければ今の選択を保留中の変更に合わせて写して復元する。
	 */
	private syncDom(selection?: TextSelection | null): void {
		if (this.destroyed || this.composing || !this.attached()) return;
		// まだ取り込んでいない DOM 側の編集があれば、先に Y へ入れる(リモートの反映で消さないため)
		if (this.adapter.getText() !== this.domBase) this.handleInput();

		const text = this.ytext.toString();
		let next: TextSelection | null;
		if (selection !== undefined) {
			next = selection;
		} else {
			const current = this.adapter.getSelection();
			next = current
				? {
						start: mapIndexThrough(current.start, this.pending, 1),
						end: mapIndexThrough(current.end, this.pending, -1)
					}
				: null;
		}
		this.pending = [];

		if (this.adapter.getText() !== text) this.adapter.setText(text);
		this.domBase = this.adapter.getText();
		if (next) {
			const start = clamp(next.start, 0, text.length);
			const end = clamp(Math.max(next.end, next.start), 0, text.length);
			this.adapter.setSelection(start, end);
		}
	}

	// ---------- ローカル→Y ----------

	/** input イベント: DOM の本文の変化を Y へ反映する */
	handleInput(): void {
		if (this.destroyed || this.composing || !this.attached()) return;
		const domText = this.adapter.getText();
		if (domText === this.domBase) return;

		if (this.doc.readOnly) {
			// 読み取り専用では書かせない: DOM を Y に戻す
			this.pending = [];
			this.adapter.setText(this.ytext.toString());
			this.domBase = this.adapter.getText();
			return;
		}
		const edit = diffText(this.domBase, domText);
		this.commitEdit(edit, (p) => mapIndexThrough(p, this.pending, 1), domText, {
			strict: false,
			domUpdated: true
		});
	}

	/**
	 * DOM の本文 domBase に対する編集 edit を、mapPos で Y の座標へ写して Y に適用する。
	 * domUpdated: DOM が既に編集後の本文(domText)になっているか(false なら DOM はこの後に書き換える)。
	 */
	private commitEdit(
		edit: TextDiff,
		mapPos: (position: number) => number,
		domText: string,
		options: { strict: boolean; domUpdated: boolean }
	): void {
		const yText = this.ytext.toString();
		let start = clamp(mapPos(edit.index), 0, yText.length);
		let end = clamp(mapPos(edit.index + edit.deleteCount), 0, yText.length);
		if (end < start) end = start;
		if (options.strict && end > start) {
			// 置き換える範囲の中身が違うなら(リモートの編集が入った)、削除はせず挿入だけにする
			const expected = this.domBase.slice(edit.index, edit.index + edit.deleteCount);
			if (yText.slice(start, end) !== expected) end = start;
		}
		// サロゲートペアの途中で切らない
		start = adjustToBoundary(yText, start);
		end = adjustToBoundary(yText, end);

		const selection = options.domUpdated && this.attached() ? this.adapter.getSelection() : null;
		this.selfWriting = true;
		try {
			applyEditToYText(
				this.ytext,
				{ index: start, deleteCount: end - start, insert: edit.insert },
				this.origin
			);
		} finally {
			this.selfWriting = false;
		}

		if (options.domUpdated && this.ytext.toString() === domText) {
			// 普通の入力: DOM と Y が一致している
			this.domBase = domText;
			this.pending = [];
			return;
		}

		// リモートの変更が DOM に入っていない(または DOM がまだ古い): 今すぐ DOM を Y に合わせる
		let caret: TextSelection | null;
		if (!options.domUpdated) {
			// 貼り付けなど: DOM はまだ編集前。挿入した文字列の直後にキャレットを置く
			const at = start + edit.insert.length;
			caret = { start: at, end: at };
		} else if (selection) {
			caret = {
				start: this.caretAfter(selection.start, edit, mapPos, start, end),
				end: this.caretAfter(selection.end, edit, mapPos, start, end)
			};
		} else {
			caret = null;
		}
		if (options.domUpdated) this.domBase = domText;
		this.syncDom(caret);
	}

	/** 編集後の DOM のキャレット位置 c を、Y の座標へ写す */
	private caretAfter(
		c: number,
		edit: TextDiff,
		mapPos: (position: number) => number,
		yStart: number,
		yEnd: number
	): number {
		if (c <= edit.index) return mapPos(c);
		if (c >= edit.index + edit.insert.length) {
			const before = c - edit.insert.length + edit.deleteCount;
			return mapPos(before) - (yEnd - yStart) + edit.insert.length;
		}
		return yStart + (c - edit.index);
	}

	// ---------- IME ----------

	compositionStart(): void {
		if (this.destroyed || this.composing) return;
		// 取り込んでいない編集があれば先に入れておく
		if (this.attached() && this.adapter.getText() !== this.domBase) this.handleInput();

		const base = this.domBase;
		const selection = this.adapter.getSelection() ?? { start: base.length, end: base.length };
		const length = this.ytext.length;
		const yStart = clamp(mapIndexThrough(selection.start, this.pending, 1), 0, length);
		const yEnd = clamp(
			Math.max(mapIndexThrough(selection.end, this.pending, -1), yStart),
			0,
			length
		);
		this.composition = {
			base,
			selection,
			relStart: Y.createRelativePositionFromTypeIndex(this.ytext, yStart, 0),
			relEnd: Y.createRelativePositionFromTypeIndex(this.ytext, yEnd, -1)
		};
		this.composing = true;
	}

	compositionEnd(): void {
		if (this.destroyed || !this.composing) return;
		this.composing = false;
		const composition = this.composition;
		this.composition = null;
		if (!composition || !this.attached()) {
			if (this.pending.length > 0) this.scheduleSync();
			return;
		}

		const domText = this.adapter.getText();
		if (domText === composition.base) {
			// 変換を取り消した。保留していたリモートの変更を反映する
			if (this.pending.length > 0) this.syncDom();
			return;
		}
		if (this.doc.readOnly) {
			this.syncDom(null);
			return;
		}

		const edit = diffText(composition.base, domText);
		const length = this.ytext.length;
		const absolute = (rel: Y.RelativePosition): number | null =>
			Y.createAbsolutePositionFromRelativePosition(rel, this.ydoc)?.index ?? null;
		const yStart = clamp(absolute(composition.relStart) ?? composition.selection.start, 0, length);
		const yEnd = Math.max(
			yStart,
			clamp(absolute(composition.relEnd) ?? composition.selection.end, 0, length)
		);
		const s0 = composition.selection.start;
		const e0 = composition.selection.end;
		// キャレット領域を基準に、差分の位置を現在の Y の座標へ写す(キャレットより前のリモートの挿入・削除に追従する)
		const mapPos = (p: number): number => {
			if (p <= s0) return yStart - (s0 - p);
			if (p >= e0) return yEnd + (p - e0);
			return yStart + (p - s0);
		};
		this.commitEdit(edit, mapPos, domText, { strict: true, domUpdated: true });
	}

	// ---------- beforeinput・貼り付け・ドロップ ----------

	/**
	 * beforeinput を処理する。true なら既定の動作を止める(preventDefault する)。
	 * 履歴操作は UndoManager へ回し、読み取り専用では入力を止める。
	 */
	handleBeforeInput(inputType: string): boolean {
		if (inputType === 'historyUndo') {
			this.undo();
			return true;
		}
		if (inputType === 'historyRedo') {
			this.redo();
			return true;
		}
		return this.doc.readOnly;
	}

	/** 選択範囲をテキストで置き換える(貼り付け)。DOM は Y の反映後に書く */
	insertText(text: string): boolean {
		if (this.destroyed || this.composing || this.doc.readOnly || !this.attached()) return false;
		if (this.adapter.getText() !== this.domBase) this.handleInput();
		const base = this.domBase;
		const selection = this.adapter.getSelection() ?? { start: base.length, end: base.length };
		const edit: TextDiff = {
			index: selection.start,
			deleteCount: selection.end - selection.start,
			insert: text
		};
		const domText = base.slice(0, selection.start) + text + base.slice(selection.end);
		this.undoManager.stopCapturing();
		this.commitEdit(edit, (p) => mapIndexThrough(p, this.pending, 1), domText, {
			strict: false,
			domUpdated: false
		});
		this.undoManager.stopCapturing();
		return true;
	}

	/**
	 * ドロップされたテキストを index(DOM の座標)に挿入する。moveFrom があれば、その範囲を移動する
	 * (元の範囲から削除してから挿入)。挿入先が移動元の範囲内なら何もしない。
	 */
	dropText(text: string, index: number, moveFrom?: TextSelection): boolean {
		if (this.destroyed || this.composing || this.doc.readOnly || !this.attached()) return false;
		if (this.adapter.getText() !== this.domBase) this.handleInput();
		const move = moveFrom && moveFrom.end > moveFrom.start ? moveFrom : null;
		if (move && index > move.start && index < move.end) return false;

		const mapPos = (p: number) => mapIndexThrough(p, this.pending, 1);
		const length = this.ytext.length;
		const yText = this.ytext.toString();
		const at = clamp(mapPos(index), 0, length);
		let removeStart = 0;
		let removeEnd = 0;
		if (move) {
			removeStart = clamp(mapPos(move.start), 0, length);
			removeEnd = Math.max(removeStart, clamp(mapPos(move.end), 0, length));
		}

		this.undoManager.stopCapturing();
		this.selfWriting = true;
		let caret = at;
		try {
			this.ydoc.transact(() => {
				// 後ろにある編集から先に行い、前の位置がずれないようにする
				if (move && removeStart < at) {
					applyEditToYText(
						this.ytext,
						{ index: adjustToBoundary(yText, at), deleteCount: 0, insert: text },
						this.origin
					);
					applyEditToYText(
						this.ytext,
						{
							index: adjustToBoundary(yText, removeStart),
							deleteCount: removeEnd - removeStart,
							insert: ''
						},
						this.origin
					);
					caret = at + text.length - (removeEnd - removeStart);
				} else {
					if (move) {
						applyEditToYText(
							this.ytext,
							{
								index: adjustToBoundary(yText, removeStart),
								deleteCount: removeEnd - removeStart,
								insert: ''
							},
							this.origin
						);
					}
					applyEditToYText(
						this.ytext,
						{ index: adjustToBoundary(yText, at), deleteCount: 0, insert: text },
						this.origin
					);
					caret = at + text.length;
				}
			}, this.origin);
		} finally {
			this.selfWriting = false;
		}
		this.undoManager.stopCapturing();
		this.syncDom({ start: caret, end: caret });
		return true;
	}

	// ---------- undo / redo ----------

	undo(): boolean {
		return this.runHistory(() => this.undoManager.undo());
	}

	redo(): boolean {
		return this.runHistory(() => this.undoManager.redo());
	}

	canUndo(): boolean {
		return this.undoManager.canUndo();
	}

	canRedo(): boolean {
		return this.undoManager.canRedo();
	}

	private runHistory(run: () => unknown): boolean {
		if (this.destroyed || this.composing || this.doc.readOnly) return false;
		if (this.attached() && this.adapter.getText() !== this.domBase) this.handleInput();
		const before = this.pending.length;
		if (!run()) return false;
		// 元に戻した場所にキャレットを置く
		const last = this.pending.length > before ? this.pending[this.pending.length - 1] : null;
		const caret = last ? caretFromDelta(last) : null;
		this.cancelScheduled();
		this.syncDom(caret !== null ? { start: caret, end: caret } : undefined);
		return true;
	}

	// ---------- 外部からの本文の置き換え ----------

	/**
	 * エディタ以外(執筆支援・校正など)が本文を書き換えた。Y に差分を入れ、DOM を更新する。
	 * AI の提案の適用は origin に ORIGIN_AI を渡す(利用者が書いた分として数えないため)
	 */
	setExternalText(text: string, origin: unknown = this.origin): boolean {
		if (this.destroyed || this.doc.readOnly) return false;
		if (this.ytext.toString() === text) return false;
		const edit = diffText(this.ytext.toString(), text);
		applyEditToYText(this.ytext, edit, origin);
		return true;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.cancelScheduled();
		this.ytext.unobserve(this.onYChange);
		this.undoManager.destroy();
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** 下位サロゲートの手前(ペアの途中)なら 1 つ前へ寄せる */
function adjustToBoundary(text: string, index: number): number {
	if (index <= 0 || index >= text.length) return index;
	const code = text.charCodeAt(index);
	const prev = text.charCodeAt(index - 1);
	return code >= 0xdc00 && code <= 0xdfff && prev >= 0xd800 && prev <= 0xdbff ? index - 1 : index;
}
