import * as Y from 'yjs';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import type { CrdtDocRow } from '$lib/types';
import type { ProjectSharing } from '$lib/types/project';
import { isPermissionDeniedError } from '$lib/firebase/joinPolicy';
import { isReadOnlySharing, targetKeyForProject } from '$lib/firebase/syncTarget';
import { withTimeout } from '$lib/utils/asyncControl';
import { applyDiffToYText } from './diff';
import type { CrdtPersistence } from './persistence';
import {
	CrdtTooLargeError,
	type CrdtTransport,
	type RemoteUpdate,
	type SnapshotData
} from './transport';
import {
	listenSince,
	mergePending,
	retryDelay,
	selectDeletableUpdates,
	shouldCompact,
	type CompactTrigger
} from './policy';

/**
 * シーン本文の Y 文書マネージャ。
 * シーンごとに 1 つの Y 文書(Y.Text 'content')を持ち、開いている間は updates を購読し、
 * ローカルの変更をまとめて送り、ローカルに永続化し、Scene.content にミラーする。
 * 外部への依存(Firestore・Dexie・Scene の更新・通知)は CrdtDeps で注入する(テストで差し替えられる)。
 */

/** 書き込みの origin。それ以外の origin(エディタのバインディングや UndoManager)もローカルの変更として扱う */
export const ORIGIN_LOCAL = 'local';
export const ORIGIN_REMOTE = 'remote';
/** AI の提案を適用した書き込み(送信・ミラーはローカルの変更と同じ。利用者が書いた分としては数えない) */
export const ORIGIN_AI = 'ai';
/** プログラムによる書き換え(検索置換・履歴の復元・競合の解決)。ローカルの変更として送るが、執筆としては数えない */
export const ORIGIN_PROGRAM = 'program';
/** 永続化・snapshot からの復元(送信もミラーの対象外にもしない読み込み) */
const ORIGIN_RESTORE = 'restore';

const PERSIST_DELAY = 500;
const SEND_DELAY = 2500;
const MIRROR_DELAY = 1500;
/** 通信を伴う処理の打ち切り(オフラインで書き込みが宙に浮いたままにならないように) */
const PUSH_TIMEOUT = 20_000;
const CLOSE_TIMEOUT = 5_000;

export interface CrdtProjectInfo {
	id: string;
	sharing?: ProjectSharing;
}

export interface CrdtDeps {
	transport: CrdtTransport;
	persistence: CrdtPersistence;
	/** ターゲットの Firestore。使えない(未サインイン・未登録)場合は null */
	resolveDb(targetKey: string): Promise<Firestore | null>;
	getScene(sceneId: string): Promise<{ content: string; projectId: string } | undefined>;
	/** Scene.content に Y の文字列を反映する(characterCount などは scenesDB.update に任せる) */
	mirrorContent(
		sceneId: string,
		text: string,
		ctx: { projectId: string; readOnly: boolean; changes: LocalChanges }
	): Promise<void>;
	/** 上書きされる前のローカルの本文を historyDB に退避する */
	backupScene(sceneId: string): Promise<void>;
	currentUid(targetKey: string): string;
	/** 権限エラー(閲覧権限・アクセス失効)を受けたときの通知(UI 通知・revokeGuestAccess など) */
	onPermissionDenied(info: { pid: string; sceneId: string; targetKey: string }): void;
	/** 再試行できないエラーの通知 */
	onError(message: string): void;
	isOnline(): boolean;
	/** オンラインに戻ったときのコールバックを登録する。返り値で解除 */
	onOnline(callback: () => void): () => void;
	now(): number;
}

/** ある origin による、前回のミラー以降の変更 */
export interface OriginChange {
	/** 文字数の増減(挿入した文字数 - 削除した文字数) */
	delta: number;
	/** 変更があったか(増減が 0 でも、書き換えていれば true) */
	edited: boolean;
}

/**
 * 前回のミラー以降に、この端末で入れた変更の内訳(拡張向けイベントの origin の判定に使う)。
 * user は利用者が書いた分(エディタの入力・元に戻す)、ai は AI の提案を適用した分。
 * リモートの変更・復元・プログラムによる書き換え(ORIGIN_PROGRAM)は含まない
 */
export interface LocalChanges {
	user: OriginChange;
	ai: OriginChange;
}

const noChange = (): OriginChange => ({ delta: 0, edited: false });

export type CrdtOpenFailure =
	/** 共有プロジェクト(active)ではない */
	| 'not-shared'
	/** オフライン(または接続先を利用できない)で、保存済みの状態も無い */
	| 'offline'
	/** 閲覧権限で、CRDT 化されたスナップショットがまだ無い(編集者が一度開くまで本文は従来の content を使う) */
	| 'no-snapshot'
	/** 権限が無い */
	| 'denied'
	| 'unavailable';

export class CrdtOpenError extends Error {
	constructor(
		readonly reason: CrdtOpenFailure,
		message?: string
	) {
		super(message ?? `シーン本文の共同編集を開始できません(${reason})`);
		this.name = 'CrdtOpenError';
	}
}

export interface SceneDocHandle {
	readonly sceneId: string;
	readonly ydoc: Y.Doc;
	readonly ytext: Y.Text;
	/** 送信しない状態(閲覧権限・アクセス失効・書き込みが拒否された) */
	readonly readOnly: boolean;
	/** 本文を newText にする(最小差分を ytext に適用)。読み取り専用なら何もせず false */
	setText(newText: string, origin?: unknown): boolean;
	/** リモート(他端末)の変更で本文が変わった */
	onRemoteChange(callback: (text: string) => void): () => void;
	/** ローカルの変更で本文が変わった */
	onLocalChange(callback: (text: string) => void): () => void;
	onReadOnlyChange(callback: (readOnly: boolean) => void): () => void;
	/** 永続化・ミラー・送信を今すぐ行う(送信は通信できるときだけ) */
	flush(): Promise<void>;
	/** 参照を手放す。最後の参照なら、保存・送信・圧縮をして文書を破棄する */
	destroy(): Promise<void>;
}

export interface OpenOptions {
	/** updates を購読するか(既定 true)。開いていないシーンへの一時的な書き込みは false */
	listen?: boolean;
}

export interface DocManager {
	openScene(
		sceneId: string,
		project: CrdtProjectInfo,
		options?: OpenOptions
	): Promise<SceneDocHandle>;
	/** 開いているシーンがあれば、そのハンドルの代わりに内部の文字列を返す(開いていなければ undefined) */
	peekText(sceneId: string): string | undefined;
	isOpen(sceneId: string): boolean;
	/** 開いている全シーンの永続化を今すぐ行う(pagehide 用) */
	persistAll(): Promise<void>;
	/** 開いている全シーンの永続化・ミラー・送信を今すぐ行う(共有の停止の前に最新の本文をそろえるとき) */
	flushAll(): Promise<void>;
	/**
	 * シーンの共同編集の状態を捨てる(共有の停止・退出・失効、シーンの削除のとき)。
	 * 開いていれば、以後は購読・送信・保存・ミラーを一切しない。呼び出し側が crdtDocs の行も削除すること。
	 */
	discard(sceneId: string): void;
}

class SceneDocEntry {
	readonly ydoc = new Y.Doc();
	readonly ytext = this.ydoc.getText('content');
	refs = 0;
	readOnly: boolean;
	db: Firestore | null = null;

	private unsent: Uint8Array[] = [];
	private applied = new Set<string>();
	private lastSeen = 0;
	private snapshotRev = 0;
	private lastMirrored = '';
	private lastCreatedAt = 0;
	private retryAttempt = 0;
	private blocked = false;
	private destroyed = false;
	/** 捨てられた(共有の停止・退出・失効・シーンの削除)。通信・保存・ミラーをしない */
	private discarded = false;
	private listening = false;
	private unsubscribers: Unsubscribe[] = [];
	private offOnline: (() => void) | null = null;

	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	private sendTimer: ReturnType<typeof setTimeout> | null = null;
	private mirrorTimer: ReturnType<typeof setTimeout> | null = null;
	private sending: Promise<void> | null = null;
	private compacting = false;
	private mirrorChain: Promise<void> = Promise.resolve();
	/** 前回のミラー以降に、この端末で入れた変更の内訳 */
	private changes: LocalChanges = { user: noChange(), ai: noChange() };

	readonly remoteCallbacks = new Set<(text: string) => void>();
	readonly localCallbacks = new Set<(text: string) => void>();
	readonly readOnlyCallbacks = new Set<(readOnly: boolean) => void>();

	constructor(
		private readonly deps: CrdtDeps,
		readonly sceneId: string,
		readonly projectId: string,
		readonly pid: string,
		readonly targetKey: string,
		readOnly: boolean
	) {
		this.readOnly = readOnly;
		this.ydoc.on('update', (update: Uint8Array, origin: unknown) => this.onUpdate(update, origin));
		this.ytext.observe((event, transaction) => this.countChange(event, transaction.origin));
	}

	/** この端末で入れた変更を、origin ごとに数える(リモート・復元・プログラムによる書き換えは数えない) */
	private countChange(event: Y.YTextEvent, origin: unknown): void {
		if (origin === ORIGIN_REMOTE || origin === ORIGIN_RESTORE || origin === ORIGIN_PROGRAM) return;
		// 読み取り専用での変更は送らず、ミラーもしない(onUpdate)
		if (this.readOnly) return;
		const target = origin === ORIGIN_AI ? this.changes.ai : this.changes.user;
		for (const op of event.delta) {
			if (typeof op.insert === 'string') target.delta += op.insert.length;
			else if (typeof op.delete === 'number') target.delta -= op.delete;
		}
		target.edited = true;
	}

	// ---------- 開く ----------

	/** 保存済みの状態・サーバーの snapshot から文書を組み立てる。失敗したら CrdtOpenError */
	async bootstrap(): Promise<void> {
		const { deps, sceneId } = this;
		const scene = await deps.getScene(sceneId);
		if (!scene) throw new CrdtOpenError('unavailable', 'シーンが見つかりません');

		const stored = await deps.persistence.load(sceneId);
		const row = stored && stored.targetKey === this.targetKey ? stored : undefined;
		if (row) {
			Y.applyUpdate(this.ydoc, row.state, ORIGIN_RESTORE);
			if (row.pending) {
				Y.applyUpdate(this.ydoc, row.pending, ORIGIN_RESTORE);
				this.unsent = [row.pending];
			}
			this.lastSeen = row.lastSeen;
			this.applied = new Set(row.appliedIds ?? []);
			this.snapshotRev = row.snapshotRev ?? 0;
		}
		this.lastMirrored = scene.content;

		let db: Firestore | null = null;
		if (deps.isOnline()) {
			try {
				db = await deps.resolveDb(this.targetKey);
			} catch (error) {
				console.warn('CRDT: connection not ready:', error);
			}
		}
		this.db = db;

		if (db) {
			try {
				await this.loadFromServer(db, scene.content, !!row);
			} catch (error) {
				if (error instanceof CrdtOpenError) throw error;
				if (isPermissionDeniedError(error)) {
					this.notifyDenied();
					if (!row) throw new CrdtOpenError('denied');
				} else {
					console.warn('CRDT: failed to load snapshot:', error);
					if (!row) throw new CrdtOpenError('offline');
				}
			}
		} else if (!row) {
			throw new CrdtOpenError('offline');
		}

		// 書き込み(以降 reconcile は content を比較しない)を最初に確定させる
		await this.persistNow();

		// Y の本文とローカルの content が違えば、上書きの前に退避してからミラーする
		if (this.ytext.toString() !== scene.content) {
			if (scene.content !== '') await deps.backupScene(sceneId);
			this.scheduleMirror(0);
		}
	}

	private async loadFromServer(
		db: Firestore,
		localContent: string,
		hadRow: boolean
	): Promise<void> {
		const { deps, pid, sceneId } = this;
		let snapshot: SnapshotData | null = await deps.transport.getSnapshot(db, pid, sceneId);
		let created = false;

		if (!snapshot) {
			if (this.readOnly && !hadRow) throw new CrdtOpenError('no-snapshot');
			if (!this.readOnly) {
				// 最初に CRDT 化する端末。トランザクションで、無ければ作る(負けたら勝者の snapshot を読む)
				const result = await deps.transport.initSnapshotIfAbsent(db, pid, sceneId, () => {
					if (hadRow) return Y.encodeStateAsUpdate(this.ydoc);
					const seed = new Y.Doc();
					if (localContent) seed.getText('content').insert(0, localContent);
					return Y.encodeStateAsUpdate(seed);
				});
				snapshot = result.snapshot;
				created = result.created;
			}
		}

		if (snapshot) {
			// 自分が作った snapshot も、その state を適用して同じ項目(clientID)を共有する
			if (!hadRow || !created) Y.applyUpdate(this.ydoc, snapshot.state, ORIGIN_RESTORE);
			this.snapshotRev = Math.max(this.snapshotRev, snapshot.rev);
		}
	}

	// ---------- 購読・再接続 ----------

	/** 購読を始め、未送信があれば送る。オンラインに戻ったときにも呼ぶ(冪等) */
	async connect(): Promise<void> {
		if (this.destroyed || this.discarded) return;
		if (!this.offOnline) this.offOnline = this.deps.onOnline(() => void this.connect());
		if (!this.deps.isOnline()) return;

		if (!this.db) {
			try {
				this.db = await this.deps.resolveDb(this.targetKey);
			} catch (error) {
				console.warn('CRDT: connection not ready:', error);
			}
			if (!this.db) return;
		}
		this.startListening();
		// 未送信(オフライン中の編集・前回の送り残し)があれば、すぐ送る
		if (this.unsent.length > 0) this.scheduleSend(0);
	}

	startListening(): void {
		const db = this.db;
		if (!db || this.listening || this.destroyed) return;
		this.listening = true;
		const onError = (error: unknown) => this.onListenError(error);
		this.unsubscribers.push(
			this.deps.transport.listenUpdates(
				db,
				this.pid,
				this.sceneId,
				listenSince(this.lastSeen),
				(updates) => this.applyRemoteUpdates(updates),
				onError
			),
			this.deps.transport.listenSnapshot(
				db,
				this.pid,
				this.sceneId,
				(snapshot) => this.applyRemoteSnapshot(snapshot),
				onError
			)
		);
	}

	private stopListening(): void {
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		this.unsubscribers = [];
		this.listening = false;
	}

	private onListenError(error: unknown): void {
		this.stopListening();
		if (isPermissionDeniedError(error)) {
			this.notifyDenied();
			return;
		}
		// 一時的な失敗: オンラインに戻ったとき(connect)に張り直す
		console.warn('CRDT: listener error:', error);
	}

	private applyRemoteUpdates(updates: RemoteUpdate[]): void {
		let changed = false;
		for (const u of updates) {
			if (this.applied.has(u.id)) continue;
			try {
				Y.applyUpdate(this.ydoc, u.update, ORIGIN_REMOTE);
				this.applied.add(u.id);
				changed = true;
			} catch (error) {
				console.error(`CRDT: failed to apply update ${u.id}:`, error);
			}
			this.lastSeen = Math.max(this.lastSeen, u.createdAt);
		}
		if (changed) {
			this.schedulePersist();
			void this.maybeCompact('active');
		}
	}

	private applyRemoteSnapshot(snapshot: SnapshotData): void {
		if (snapshot.rev <= this.snapshotRev) return;
		this.snapshotRev = snapshot.rev;
		try {
			Y.applyUpdate(this.ydoc, snapshot.state, ORIGIN_REMOTE);
		} catch (error) {
			console.error('CRDT: failed to apply snapshot:', error);
		}
		this.schedulePersist();
	}

	// ---------- 変更の検知 ----------

	private onUpdate(update: Uint8Array, origin: unknown): void {
		if (origin === ORIGIN_RESTORE) return;
		const text = () => this.ytext.toString();

		if (origin === ORIGIN_REMOTE) {
			this.scheduleMirror();
			for (const cb of [...this.remoteCallbacks]) cb(text());
			return;
		}

		if (this.readOnly) {
			// 読み取り専用では送らない・保存しない(UI が止め損ねた変更。ミラーもしない)
			console.warn(`CRDT: local change ignored on a read-only scene (${this.sceneId})`);
			return;
		}
		this.unsent.push(update);
		this.schedulePersist();
		this.scheduleSend();
		this.scheduleMirror();
		for (const cb of [...this.localCallbacks]) cb(text());
	}

	setText(newText: string, origin: unknown = ORIGIN_LOCAL): boolean {
		if (this.readOnly || this.destroyed) return false;
		applyDiffToYText(this.ytext, this.ytext.toString(), newText, origin);
		return true;
	}

	// ---------- 読み取り専用への切り替え ----------

	private notifyDenied(): void {
		this.setReadOnly(true);
		this.blocked = true;
		this.deps.onPermissionDenied({
			pid: this.pid,
			sceneId: this.sceneId,
			targetKey: this.targetKey
		});
	}

	setReadOnly(readOnly: boolean): void {
		if (this.readOnly === readOnly) return;
		this.readOnly = readOnly;
		for (const cb of [...this.readOnlyCallbacks]) cb(readOnly);
	}

	// ---------- 永続化 ----------

	private schedulePersist(): void {
		if (this.persistTimer || this.destroyed || this.discarded) return;
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			void this.persistNow();
		}, PERSIST_DELAY);
	}

	async persistNow(): Promise<void> {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		if (this.discarded) return;
		const row: CrdtDocRow = {
			sceneId: this.sceneId,
			targetKey: this.targetKey,
			state: Y.encodeStateAsUpdate(this.ydoc),
			pending: mergePending(this.unsent),
			lastSeen: this.lastSeen,
			appliedIds: [...this.applied],
			snapshotRev: this.snapshotRev,
			updatedAt: this.deps.now()
		};
		try {
			await this.deps.persistence.save(row);
		} catch (error) {
			console.error('CRDT: failed to persist:', error);
		}
	}

	// ---------- ミラー ----------

	private scheduleMirror(delay = MIRROR_DELAY): void {
		if (this.mirrorTimer || this.destroyed || this.discarded) return;
		this.mirrorTimer = setTimeout(() => {
			this.mirrorTimer = null;
			void this.mirrorNow();
		}, delay);
	}

	mirrorNow(): Promise<void> {
		if (this.mirrorTimer) {
			clearTimeout(this.mirrorTimer);
			this.mirrorTimer = null;
		}
		this.mirrorChain = this.mirrorChain.then(async () => {
			if (this.discarded) return;
			const text = this.ytext.toString();
			if (text === this.lastMirrored) return;
			// 内訳は、ミラーに渡した分だけ取り出す(ミラー中に入った変更は次回に回す)
			const changes = this.changes;
			this.changes = { user: noChange(), ai: noChange() };
			try {
				await this.deps.mirrorContent(this.sceneId, text, {
					projectId: this.projectId,
					readOnly: this.readOnly,
					changes
				});
				this.lastMirrored = text;
			} catch (error) {
				console.error('CRDT: failed to mirror content:', error);
				// 失敗した分は、次のミラーに持ち越す
				for (const key of ['user', 'ai'] as const) {
					this.changes[key].delta += changes[key].delta;
					this.changes[key].edited ||= changes[key].edited;
				}
			}
		});
		return this.mirrorChain;
	}

	// ---------- 送信 ----------

	private scheduleSend(delay = SEND_DELAY): void {
		if (this.sendTimer || this.destroyed || this.blocked || this.discarded) return;
		this.sendTimer = setTimeout(() => {
			this.sendTimer = null;
			void this.sendNow();
		}, delay);
	}

	/** 未送信の更新を送る。送れない状況(オフライン・読み取り専用)では何もしない。失敗は再試行を予約する */
	sendNow(): Promise<void> {
		if (this.sendTimer) {
			clearTimeout(this.sendTimer);
			this.sendTimer = null;
		}
		if (this.sending) return this.sending;
		if (this.unsent.length === 0 || this.readOnly || this.blocked || this.discarded) {
			return Promise.resolve();
		}
		const db = this.db;
		if (!db || !this.deps.isOnline()) return Promise.resolve();

		const batch = [...this.unsent];
		this.sending = (async () => {
			try {
				const createdAt = Math.max(this.deps.now(), this.lastCreatedAt + 1);
				const ids = await withTimeout(
					this.deps.transport.pushUpdates(db, this.pid, this.sceneId, batch, {
						by: this.deps.currentUid(this.targetKey),
						clientId: this.ydoc.clientID,
						createdAt
					}),
					PUSH_TIMEOUT,
					'本文の送信'
				);
				this.lastCreatedAt = createdAt + ids.length;
				this.unsent = this.unsent.filter((u) => !batch.includes(u));
				for (const id of ids) this.applied.add(id);
				this.retryAttempt = 0;
				this.schedulePersist();
				void this.maybeCompact('active');
			} catch (error) {
				this.onSendError(error);
			} finally {
				this.sending = null;
				if (this.unsent.length > 0 && this.retryAttempt === 0) this.scheduleSend();
			}
		})();
		return this.sending;
	}

	private onSendError(error: unknown): void {
		if (isPermissionDeniedError(error)) {
			// 再試行しない。未送信の更新はローカルに残す(権限が戻れば再送できる)
			this.notifyDenied();
			return;
		}
		if (error instanceof CrdtTooLargeError) {
			this.blocked = true;
			this.deps.onError('本文の変更が大きすぎて共有先に送れません(ローカルには保存されています)');
			return;
		}
		this.retryAttempt += 1;
		console.warn(`CRDT: send failed (attempt ${this.retryAttempt}):`, error);
		if (this.sendTimer || this.destroyed) return;
		this.sendTimer = setTimeout(() => {
			this.sendTimer = null;
			void this.sendNow();
		}, retryDelay(this.retryAttempt));
	}

	// ---------- 圧縮 ----------

	async maybeCompact(trigger: CompactTrigger): Promise<void> {
		const db = this.db;
		if (this.discarded || !db || this.readOnly || this.blocked || this.compacting) return;
		if (!this.deps.isOnline() || !shouldCompact(this.applied.size, trigger)) return;

		this.compacting = true;
		try {
			// 消すのは、自分が適用済みの updates だけ
			const deleteIds = selectDeletableUpdates(this.applied, this.applied);
			const result = await this.deps.transport.compact(db, this.pid, this.sceneId, {
				state: Y.encodeStateAsUpdate(this.ydoc),
				baseRev: this.snapshotRev,
				deleteIds
			});
			if (result.ok) {
				this.snapshotRev = result.rev;
				for (const id of deleteIds) this.applied.delete(id);
				this.schedulePersist();
			}
			// stale: 他端末が先に圧縮した。snapshot の購読で rev が更新され、次の機会に再試行される
		} catch (error) {
			if (isPermissionDeniedError(error)) this.notifyDenied();
			else console.warn('CRDT: compaction failed:', error);
		} finally {
			this.compacting = false;
		}
	}

	// ---------- 後始末 ----------

	async flush(): Promise<void> {
		await this.persistNow();
		await this.mirrorNow();
		await this.sendNow();
		await this.persistNow();
	}

	/** 以後、通信・保存・ミラーをしない(購読とタイマーも止める) */
	discard(): void {
		if (this.discarded) return;
		this.discarded = true;
		this.stopListening();
		this.offOnline?.();
		this.offOnline = null;
		for (const timer of [this.persistTimer, this.sendTimer, this.mirrorTimer]) {
			if (timer) clearTimeout(timer);
		}
		this.persistTimer = this.sendTimer = this.mirrorTimer = null;
	}

	/** 最後の参照が手放されたとき。保存・送信・圧縮をして破棄する(通信は短い時間で打ち切る) */
	async close(): Promise<void> {
		if (this.destroyed) return;
		this.destroyed = true;
		// 閉じるまでの間にシーンが削除されていたら、行を書き戻さない
		if (!this.discarded && !(await this.deps.getScene(this.sceneId))) this.discard();
		this.stopListening();
		this.offOnline?.();
		this.offOnline = null;
		for (const timer of [this.persistTimer, this.sendTimer, this.mirrorTimer]) {
			if (timer) clearTimeout(timer);
		}
		this.persistTimer = this.sendTimer = this.mirrorTimer = null;

		await this.persistNow();
		await this.mirrorNow();
		try {
			await withTimeout(
				(async () => {
					await this.sendNow();
					await this.maybeCompact('close');
				})(),
				CLOSE_TIMEOUT,
				'シーンを閉じる時の送信'
			);
		} catch (error) {
			console.warn('CRDT: close-time send/compact incomplete:', error);
		}
		await this.persistNow();
		this.ydoc.destroy();
	}
}

function makeHandle(entry: SceneDocEntry, onRelease: () => Promise<void>): SceneDocHandle {
	let released = false;
	const subscribe = <T>(set: Set<T>, callback: T) => {
		set.add(callback);
		return () => void set.delete(callback);
	};
	return {
		sceneId: entry.sceneId,
		ydoc: entry.ydoc,
		ytext: entry.ytext,
		get readOnly() {
			return entry.readOnly;
		},
		setText: (newText, origin) => entry.setText(newText, origin),
		onRemoteChange: (cb) => subscribe(entry.remoteCallbacks, cb),
		onLocalChange: (cb) => subscribe(entry.localCallbacks, cb),
		onReadOnlyChange: (cb) => subscribe(entry.readOnlyCallbacks, cb),
		flush: () => entry.flush(),
		async destroy() {
			if (released) return;
			released = true;
			await onRelease();
		}
	};
}

export function createDocManager(deps: CrdtDeps): DocManager {
	const entries = new Map<string, Promise<SceneDocEntry>>();
	const live = new Map<string, SceneDocEntry>();
	const closing = new Map<string, Promise<void>>();

	// ページを離れる/隠すときは待たずに保存する
	if (typeof window !== 'undefined') {
		const persistAll = () => void Promise.all([...live.values()].map((e) => e.persistNow()));
		window.addEventListener('pagehide', persistAll);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') persistAll();
		});
	}

	async function release(sceneId: string, entry: SceneDocEntry): Promise<void> {
		entry.refs -= 1;
		if (entry.refs > 0) return;
		// 捨てられたあとに同じシーンが開き直されていれば、そちらの登録は消さない
		if (live.get(sceneId) === entry) {
			entries.delete(sceneId);
			live.delete(sceneId);
		}
		const done = entry.close();
		closing.set(sceneId, done);
		try {
			await done;
		} finally {
			if (closing.get(sceneId) === done) closing.delete(sceneId);
		}
	}

	return {
		async openScene(sceneId, project, options = {}) {
			const listen = options.listen ?? true;
			const sharing = project.sharing;
			if (!sharing || sharing.status !== 'active') throw new CrdtOpenError('not-shared');
			const targetKey = targetKeyForProject(project);

			await closing.get(sceneId);

			let pending = entries.get(sceneId);
			if (!pending) {
				const entry = new SceneDocEntry(
					deps,
					sceneId,
					project.id,
					sharing.pid,
					targetKey,
					isReadOnlySharing(sharing)
				);
				pending = entry.bootstrap().then(() => {
					live.set(sceneId, entry);
					return entry;
				});
				entries.set(sceneId, pending);
				pending.catch(() => {
					if (entries.get(sceneId) === pending) entries.delete(sceneId);
				});
			}
			const entry = await pending;
			entry.refs += 1;
			// 後から権限が下がった(閲覧権限・失効)場合は読み取り専用にする。戻すのは開き直したとき
			if (isReadOnlySharing(sharing)) entry.setReadOnly(true);
			if (listen) await entry.connect();
			return makeHandle(entry, () => release(sceneId, entry));
		},
		peekText: (sceneId) => live.get(sceneId)?.ytext.toString(),
		isOpen: (sceneId) => live.has(sceneId),
		persistAll: async () => {
			await Promise.all([...live.values()].map((e) => e.persistNow()));
		},
		flushAll: async () => {
			await Promise.all([...live.values()].map((e) => e.flush()));
		},
		discard(sceneId) {
			const entry = live.get(sceneId);
			if (!entry) return;
			entry.discard();
			// 以後に開き直されたシーンは新しい文書にする(古いハンドルは自分の参照を手放せばよい)
			entries.delete(sceneId);
			live.delete(sceneId);
		}
	};
}
