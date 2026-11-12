/**
 * Monolog. への記録。本体の執筆セッション(session:start / session:update / session:end)を購読して、
 * Monolog. のタイマー、または記録に写す。セッションの判定(最初の編集で開始、無操作で終了、
 * 増減した文字数の合計)は本体(`$lib/extensions/session`)が行う。
 *
 * 記録方式は 2 つ。同じセッションで両方を呼ぶと Monolog. に二重に記録されるため、必ずどちらか一方だけを使う。
 * - timer(タイマー方式): 開始で POST /timer/start、終了で POST /timer/stop(停止した時点で記録が保存される)。
 *   Monolog. アプリ側でも計測中に見える。終了時刻は、最後の編集ではなく実際に停止した時刻になる
 * - record(記録方式): 終了時に POST /records で 1 件追加する。タイマーには触れない
 *
 * 接続していない間に始まったセッションは記録しない。セッションの途中で接続した(または拡張を有効にした)
 * ときは、その次の知らせから記録を始める(開始時刻はその時点。それより前の時間と文字数は含めない)。
 */
import { ApiError } from './client';
import type { MonologClient } from './client';
import { NotConnectedError, ReauthRequiredError } from './tokens';
import type { ExtensionEvents, WritingSessionEvent } from '$lib/extensions/events';
import type { ExtensionNotifier } from '$lib/extensions/types';

export type SessionMode = 'timer' | 'record';

export interface MonologSettings {
	mode: SessionMode;
	tagName: string;
	sendProjectTitle: boolean;
}

export const DEFAULT_SETTINGS: MonologSettings = {
	mode: 'timer',
	tagName: '執筆',
	sendProjectTitle: false
};

export const DEFAULT_TITLE = '執筆(Storift)';
const MAX_TITLE_LENGTH = 100;
/** pagehide で送れるよう、アクセストークンの期限にこれだけ余裕を持たせておく */
const TOKEN_FRESH_MARGIN_MS = 5 * 60 * 1000;
const FRESH_CHECK_INTERVAL_MS = 60 * 1000;

export type SessionOutcome = 'recorded' | 'discarded' | 'failed' | 'none';

type SessionClient = Pick<
	MonologClient,
	'getTimer' | 'startTimer' | 'stopTimer' | 'createRecord' | 'sendKeepalive'
>;

export interface SessionDeps {
	client: SessionClient;
	getSettings(): MonologSettings;
	notify: ExtensionNotifier;
	/** Monolog. に接続しているか。false の間に届いた知らせでは、記録を始めない(省略すると常に true) */
	isConnected?(): boolean;
	/** 送信前にアクセストークンの期限に余裕を持たせる(pagehide の送信は更新できないため) */
	ensureTokenFresh?(marginMs: number): Promise<void>;
	/** 実際に計測中かの変化(バッジの表示用) */
	onActiveChange?(active: boolean): void;
	now?: () => number;
}

interface Session {
	/** 本体の執筆セッションの ID */
	sessionId: string;
	mode: SessionMode;
	startedAtMs: number;
	lastEditMs: number;
	/** 記録を始めた時点の、本体のセッションの増減文字数(途中から始めたときは、それより前を含めない) */
	baseNet: number;
	/** 文字数の増減の合計(記録を始めてからの分) */
	delta: number;
	tagName: string;
	sendProjectTitle: boolean;
	/** 作品名(本体から届いていれば)。sendProjectTitle のときだけ使う */
	projectTitle: string | undefined;
	/** starting: タイマー開始の応答待ち / running: 計測中 / skipped: 連携しない(終了まで何もしない) */
	phase: 'starting' | 'running' | 'skipped';
	/** タイマー方式で、開始時に Monolog. から受け取った started_at */
	timerStartedAt: string | null;
	startPromise: Promise<void> | null;
}

/** `+1,234字 (Storift)` / `-120字 (Storift)` */
export function formatMemo(delta: number): string {
	const sign = delta < 0 ? '-' : '+';
	return `${sign}${Math.abs(delta).toLocaleString('en-US')}字 (Storift)`;
}

export function buildTitle(projectTitle: string | undefined, sendProjectTitle: boolean): string {
	const name = projectTitle?.trim();
	if (!sendProjectTitle || !name) return DEFAULT_TITLE;
	return `${name.slice(0, MAX_TITLE_LENGTH)}を執筆`;
}

/** オフセット付きの ISO 8601(端末のタイムゾーン)。例: 2026-11-12T10:00:00.000+09:00 */
export function toOffsetIso(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number, len = 2) => String(Math.abs(n)).padStart(len, '0');
	const offset = -d.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
		`${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
	);
}

/** 同じ時刻か。表記ゆれ(オフセットの違いなど)に備え、読めるなら時刻として比べる */
function sameInstant(a: string | null, b: string | null): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	const ta = Date.parse(a);
	const tb = Date.parse(b);
	return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

function failureMessage(error: unknown, what: string): string {
	if (error instanceof ReauthRequiredError || error instanceof NotConnectedError) {
		return 'Monolog. との接続が切れています。設定から再接続してください';
	}
	return `${what}に失敗しました`;
}

export class MonologSessionManager {
	private session: Session | null = null;
	/** 直前のセッションの終了処理。次の開始はこれを待つ(タイマーを止める前に開始して 409 にならないように) */
	private chain: Promise<unknown> = Promise.resolve();
	private lastFreshCheck = 0;
	private readonly now: () => number;

	constructor(private readonly deps: SessionDeps) {
		this.now = deps.now ?? Date.now;
	}

	/** 本体の執筆セッションのイベントを購読する。返り値で解除 */
	attach(events: ExtensionEvents): () => void {
		const offs = [
			events.on('session:start', (event) => this.handleProgress(event, false)),
			events.on('session:update', (event) => this.handleProgress(event, true)),
			events.on('session:end', (event) => this.handleEnd(event))
		];
		return () => offs.forEach((off) => off());
	}

	/** セッションが計測中か */
	get active(): boolean {
		return this.session?.phase === 'running';
	}

	/** 計測中なら、開始時刻(ms)と増減した文字数。計測中でなければ null(ポップアップの表示用) */
	snapshot(): { startedAtMs: number; delta: number } | null {
		const s = this.session;
		return s?.phase === 'running' ? { startedAtMs: s.startedAtMs, delta: s.delta } : null;
	}

	/** 執筆セッションの開始・経過。late は、セッションの途中の知らせ(session:update)か */
	handleProgress(event: WritingSessionEvent, late: boolean): void {
		if (this.session && this.session.sessionId !== event.sessionId) {
			// 終了の知らせを受け取れなかった古いセッションが残っている: 先に終わらせる
			void this.finish('idle');
		}
		if (!this.session) {
			// 未接続のときは何もしない(メモリ上の状態を見るだけ)
			if (this.deps.isConnected && !this.deps.isConnected()) return;
			this.begin(event, late);
		}
		const s = this.session!;
		this.follow(s, event);
		this.refreshTokenSoon(this.now());
	}

	/** 本体のセッションの最新の値を写す */
	private follow(s: Session, event: WritingSessionEvent): void {
		s.lastEditMs = event.lastEditAt;
		s.delta = event.netChars - s.baseNet;
		if (event.projectTitle) s.projectTitle = event.projectTitle;
	}

	private begin(event: WritingSessionEvent, late: boolean): void {
		const settings = this.deps.getSettings();
		const s: Session = {
			sessionId: event.sessionId,
			mode: settings.mode,
			// 途中から始めるときは、その時点(最後の編集)からの時間と文字数だけを記録する
			startedAtMs: late ? event.lastEditAt : event.startedAt,
			lastEditMs: event.lastEditAt,
			baseNet: late ? event.netChars : 0,
			delta: 0,
			tagName: settings.tagName.trim() || DEFAULT_SETTINGS.tagName,
			sendProjectTitle: settings.sendProjectTitle,
			projectTitle: undefined,
			phase: settings.mode === 'timer' ? 'starting' : 'running',
			timerStartedAt: null,
			startPromise: null
		};
		this.session = s;
		if (s.mode === 'timer') {
			s.startPromise = this.chain.then(() => this.startTimer(s));
		} else {
			this.deps.onActiveChange?.(true);
		}
	}

	/** 執筆セッションの終了。pagehide は待てないので keepalive で送り、それ以外は通常の終了処理をする */
	handleEnd(event: WritingSessionEvent): void {
		const s = this.session;
		if (!s || s.sessionId !== event.sessionId) return;
		this.follow(s, event);
		if (event.reason === 'pagehide') this.flushOnHide();
		else void this.finish(event.reason === 'idle' ? 'idle' : 'manual');
	}

	private async startTimer(s: Session): Promise<void> {
		try {
			let timer = await this.deps.client.startTimer(s.tagName);
			let startedAt = timer.startedAt;
			if (!startedAt) {
				timer = await this.deps.client.getTimer();
				startedAt = timer.status === 'running' ? timer.startedAt : null;
			}
			// 開始時刻が分からないと、停止前に「自分が始めたタイマーか」を確かめられない
			if (!startedAt) throw new Error('タイマーの開始時刻を取得できませんでした');
			s.timerStartedAt = startedAt;
			s.phase = 'running';
			// 開始の応答を待つ間に終了していたら、バッジは出さない(終了処理は phase を見て停止する)
			if (this.session === s) this.deps.onActiveChange?.(true);
		} catch (error) {
			s.phase = 'skipped';
			if (error instanceof ApiError && error.status === 409) {
				// Monolog. アプリなどで動いているタイマーを乗っ取らない
				this.deps.notify.info(
					'Monolog. のタイマーがすでに動いているため、今回の執筆は Monolog. に記録しません'
				);
			} else {
				this.deps.notify.error(failureMessage(error, 'Monolog. のタイマーの開始'));
			}
		}
	}

	/** 期限切れ間近のトークンを先に更新しておく(pagehide の送信は更新できないため)。頻度は絞る */
	private refreshTokenSoon(now: number): void {
		if (!this.deps.ensureTokenFresh || now - this.lastFreshCheck < FRESH_CHECK_INTERVAL_MS) return;
		this.lastFreshCheck = now;
		void this.deps.ensureTokenFresh(TOKEN_FRESH_MARGIN_MS).catch(() => {});
	}

	/** 記録中のセッションを終了して記録する。trigger: idle=無操作 / manual=ボタン・連携の解除 / deactivate=拡張の無効化 */
	finish(trigger: 'idle' | 'manual' | 'deactivate'): Promise<SessionOutcome> {
		const s = this.session;
		if (!s) return this.chain.then(() => 'none' as const);
		this.session = null;
		if (s.phase === 'running') this.deps.onActiveChange?.(false);
		// 記録方式で無操作により終わるときは、最後の編集の時刻を終了時刻にする
		const endMs = trigger === 'idle' ? s.lastEditMs : this.now();
		const run = this.chain.then(() => this.finalize(s, endMs));
		this.chain = run;
		return run;
	}

	private async finalize(s: Session, endMs: number): Promise<SessionOutcome> {
		try {
			if (s.startPromise) await s.startPromise;
			if (s.phase === 'skipped') return 'none';

			const title = buildTitle(s.projectTitle, s.sendProjectTitle);
			const memo = formatMemo(s.delta);

			if (s.mode === 'timer') {
				// タイマーは Monolog. アプリと共有で、停止は誰が開始したかに関係なく動いているタイマーを止める。
				// 別のタイマーを止めてしまわないよう、停止前に自分が始めたものか確かめる
				const timer = await this.deps.client.getTimer();
				if (timer.status !== 'running' || !sameInstant(timer.startedAt, s.timerStartedAt)) {
					this.deps.notify.info(
						'Monolog. のタイマーが別の操作で変更されたため、今回の執筆は記録せずに終了しました'
					);
					return 'discarded';
				}
				await this.deps.client.stopTimer({ title, memo });
				return 'recorded';
			}

			const durationMs = Math.max(1000, endMs - s.startedAtMs);
			await this.deps.client.createRecord({
				startedAt: toOffsetIso(s.startedAtMs),
				endedAt: toOffsetIso(s.startedAtMs + durationMs),
				durationMs,
				title,
				memo,
				tagName: s.tagName
			});
			return 'recorded';
		} catch (error) {
			if (error instanceof ApiError && error.code === 'timer_not_running') {
				this.deps.notify.info(
					'Monolog. のタイマーがすでに停止されていたため、記録は追加されませんでした'
				);
				return 'discarded';
			}
			console.error('Monolog. への記録に失敗しました:', error);
			this.deps.notify.error(failureMessage(error, 'Monolog. への記録'));
			return 'failed';
		}
	}

	/**
	 * ページを閉じる/隠れるとき(pagehide)。計測中なら keepalive の fetch で終了を送る。
	 * 待てないので、停止前の GET /timer による検証は省略せざるを得ない。
	 * 開始に成功して phase が running になった時点で started_at を確認済みなので、その状態を前提にする
	 * (起動中に別のタイマーへ差し替えられていた場合は、ここでは検知できない)。結果は見ず、失敗の通知もできない
	 */
	flushOnHide(): void {
		const s = this.session;
		if (!s || s.phase !== 'running') return;
		this.session = null;
		this.deps.onActiveChange?.(false);

		const endMs = this.now();
		const memo = formatMemo(s.delta);
		// 作品名は本体から届いた分を使う。まだ届いていなければ既定のタイトルにする
		const title = buildTitle(s.projectTitle, s.sendProjectTitle);
		if (s.mode === 'timer') {
			this.deps.client.sendKeepalive('/timer/stop', { title, memo });
		} else {
			const durationMs = Math.max(1000, endMs - s.startedAtMs);
			this.deps.client.sendKeepalive('/records', {
				started_at: toOffsetIso(s.startedAtMs),
				ended_at: toOffsetIso(s.startedAtMs + durationMs),
				duration_ms: durationMs,
				title,
				memo,
				tag: { name: s.tagName }
			});
		}
	}

	/** 拡張の無効化・終了。計測中なら終わらせる */
	async dispose(): Promise<void> {
		await this.finish('deactivate');
	}
}
