/**
 * 執筆セッションの追跡(本体の機能)。
 *
 * 利用者が書いた最初の編集でセッションを始め、最後の編集から一定時間(無操作時間)編集がなければ終了する。
 * 始まり・経過・終わりを `session:start` / `session:update` / `session:end` として発行し、
 * 拡張(Monolog. 連携、Discord Rich Presence など)はこれを購読する。
 *
 * - 数えるのは利用者が書いた変更だけ(`scene:updated` の origin が 'user' と 'collab-local')。
 *   AI の提案の適用('ai')は、セッションを始めも延ばしもせず、文字数にも数えない
 * - セッションのイベントの購読者が 1 つも無い間は、`scene:updated` も pagehide も購読しない
 *   (拡張を使っていなければ、執筆の保存に何も足さない)
 * - 作品を切り替えても、同じセッションとして続く。projectId と作品名は、セッションを始めた作品のもの
 */
import { v4 as uuidv4 } from 'uuid';
import type {
	EventEmitter,
	ExtensionEventName,
	SceneChangeOrigin,
	SceneUpdatedEvent,
	SessionEndReason,
	WritingSessionEvent
} from './events';

/** 無操作で終了するまでの時間(分)の選択肢 */
export const IDLE_MINUTES_OPTIONS = [5, 10, 15, 30] as const;
export const DEFAULT_IDLE_MINUTES = 5;

const SESSION_EVENTS: readonly ExtensionEventName[] = [
	'session:start',
	'session:update',
	'session:end'
];

/** セッションに数える変更(利用者が書いたもの) */
const COUNTED_ORIGINS: ReadonlySet<SceneChangeOrigin> = new Set(['user', 'collab-local']);

export interface SessionTrackerDeps {
	events: EventEmitter;
	/** 無操作で終了するまでの時間(分)。セッションの開始時に読む */
	getIdleMinutes(): number;
	getProjectTitle(projectId: string): Promise<string | undefined>;
	/** pagehide の購読(返り値で解除)。省略すると window を使う */
	onPageHide?(callback: () => void): () => void;
	now?: () => number;
	newId?: () => string;
}

interface Session {
	id: string;
	startedAt: number;
	lastEditAt: number;
	netChars: number;
	projectId: string;
	projectTitle: string | undefined;
	idleMs: number;
}

function defaultOnPageHide(callback: () => void): () => void {
	if (typeof window === 'undefined') return () => {};
	window.addEventListener('pagehide', callback);
	return () => window.removeEventListener('pagehide', callback);
}

export class WritingSessionTracker {
	private session: Session | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	/** 動いている間の後始末(scene:updated と pagehide の購読の解除)。止まっていれば null */
	private stopTracking: (() => void) | null = null;
	private offWatch: (() => void) | null = null;
	private readonly now: () => number;
	private readonly newId: () => string;

	constructor(private readonly deps: SessionTrackerDeps) {
		this.now = deps.now ?? Date.now;
		this.newId = deps.newId ?? uuidv4;
	}

	/** 購読者の増減を見張りはじめる。セッションのイベントの購読者がいる間だけ追跡する */
	attach(): void {
		if (this.offWatch) return;
		this.offWatch = this.deps.events.watchListeners(() => this.sync());
		this.sync();
	}

	/** 見張りをやめ、追跡も止める(テスト・終了処理用) */
	detach(): void {
		this.offWatch?.();
		this.offWatch = null;
		this.stop();
	}

	/** 追跡が動いているか(セッションのイベントの購読者がいるか) */
	get tracking(): boolean {
		return this.stopTracking !== null;
	}

	private sync(): void {
		const wanted = SESSION_EVENTS.some((name) => this.deps.events.hasListeners(name));
		if (wanted && !this.stopTracking) this.start();
		else if (!wanted && this.stopTracking) this.stop();
	}

	private start(): void {
		// 先に印を付ける(下の購読で sync が再入しても、二重に始めない)
		this.stopTracking = () => {};
		const offScene = this.deps.events.on('scene:updated', (event) => this.handleEdit(event));
		const offHide = (this.deps.onPageHide ?? defaultOnPageHide)(() => this.end('pagehide'));
		this.stopTracking = () => {
			offScene();
			offHide();
		};
	}

	private stop(): void {
		const stop = this.stopTracking;
		if (!stop) return;
		// 先に印を外す(購読の解除で sync が再入しても、二重に止めない)
		this.stopTracking = null;
		stop();
		// 購読者がいなくなったので、知らせる相手がいない。進行中のセッションは捨てる
		this.clearIdle();
		this.session = null;
	}

	private clearIdle(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}

	private payload(s: Session, end?: { at: number; reason: SessionEndReason }): WritingSessionEvent {
		return {
			sessionId: s.id,
			startedAt: s.startedAt,
			lastEditAt: s.lastEditAt,
			endedAt: end ? end.at : null,
			netChars: s.netChars,
			projectId: s.projectId,
			projectTitle: s.projectTitle,
			...(end ? { reason: end.reason } : {})
		};
	}

	private handleEdit(event: SceneUpdatedEvent): void {
		if (!COUNTED_ORIGINS.has(event.origin)) return;
		const now = this.now();
		let s = this.session;
		const started = !s;
		if (!s) {
			const minutes = this.deps.getIdleMinutes();
			s = {
				id: this.newId(),
				startedAt: now,
				lastEditAt: now,
				netChars: 0,
				projectId: event.projectId,
				projectTitle: undefined,
				idleMs: Math.max(1, Number.isFinite(minutes) ? minutes : DEFAULT_IDLE_MINUTES) * 60_000
			};
			this.session = s;
			this.loadTitle(s);
		}
		s.lastEditAt = now;
		s.netChars += event.delta;
		this.armIdle(s);
		// 開始のときは start だけを発行する(最初の編集の増減は start の netChars に含まれる)
		this.deps.events.emit(started ? 'session:start' : 'session:update', this.payload(s));
	}

	/** 作品名は後から届く(DB の読み取りを待たずに開始を知らせる)。届いたら session:update で知らせる */
	private loadTitle(s: Session): void {
		void this.deps
			.getProjectTitle(s.projectId)
			.catch(() => undefined)
			.then((title) => {
				if (!title || this.session !== s) return;
				s.projectTitle = title;
				this.deps.events.emit('session:update', this.payload(s));
			});
	}

	private armIdle(s: Session): void {
		this.clearIdle();
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			this.end('idle');
		}, s.idleMs);
	}

	/** 進行中のセッション(無ければ null) */
	current(): WritingSessionEvent | null {
		return this.session ? this.payload(this.session) : null;
	}

	/**
	 * セッションを終了して session:end を発行する。進行中でなければ何もしない(false)。
	 * 無操作による終了の終了時刻は、最後の編集の時刻(無操作と判断するまでの待ち時間を含めない)
	 */
	end(reason: SessionEndReason): boolean {
		const s = this.session;
		if (!s) return false;
		this.session = null;
		this.clearIdle();
		const at = reason === 'idle' ? s.lastEditAt : this.now();
		this.deps.events.emit('session:end', this.payload(s, { at, reason }));
		return true;
	}
}
