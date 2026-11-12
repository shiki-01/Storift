/**
 * アプリの状態(開いている画面・執筆セッション・前面にあるか)を、Discord の表示(Rich Presence)に写す。
 *
 * - 有効にしている間は、アプリを開いていれば常に表示する(画面の移動で内容が変わる)。執筆セッション中は
 *   2 行目(増減した文字数)と小さい画像を足し、経過時間をセッションの開始から数える
 * - 前面にないとき(別のウィンドウに移った・最小化した)の扱いは設定(続ける / 消す / 離席中)
 * - Discord が起動していない・つながらないときは、静かに何もしない。つなぎ直しを試みるのは、
 *   新しい執筆セッションの開始時と、前回の失敗から一定時間たったあとの更新のときだけ
 * - Discord の更新の頻度制限(20 秒に 5 回)を超えないよう、更新は間隔を空けて、最後の内容だけを送る
 * - 作品名・総文字数は、設定でオンにして、テンプレートが使っているときだけ取得する
 */
import type { ExtensionEvents, PageChangeEvent, WritingSessionEvent } from '$lib/extensions/events';
import { resolveApplicationId } from './config';
import {
	buildPresence,
	samePresence,
	type DiscordSettings,
	type PresenceActivity
} from './presence';
import { usesPlaceholder } from './template';

/** Discord クライアントとのやり取り(Rust 側のコマンド) */
export interface PresenceTransport {
	/** 表示を設定する。Discord に渡せたら true、起動していないなどで渡せなければ false */
	set(applicationId: string, activity: PresenceActivity): Promise<boolean>;
	/** 表示を消して、接続を閉じる */
	clear(): Promise<void>;
}

export interface PresenceControllerDeps {
	transport: PresenceTransport;
	getSettings(): DiscordSettings;
	/** 作品名(権限 project:title)。取得できなければ undefined */
	getProjectTitle(projectId: string): Promise<string | undefined>;
	/** 作品の総文字数(権限 project:chars)。取得できなければ undefined */
	getProjectCharCount(projectId: string): Promise<number | undefined>;
	/** 表示の状態の変化(設定画面の表示用) */
	onStatusChange?(status: PresenceStatus): void;
	/** 更新の最小間隔(ミリ秒) */
	minIntervalMs?: number;
	/** 失敗したあと、画面の移動などの更新でつなぎ直しを試みるまでの間隔(ミリ秒) */
	retryIntervalMs?: number;
	now?: () => number;
}

/** idle: 表示していない / shown: 表示中 / unavailable: Discord に渡せなかった */
export type PresenceStatus = 'idle' | 'shown' | 'unavailable';

const DEFAULT_MIN_INTERVAL_MS = 5_000;
const DEFAULT_RETRY_INTERVAL_MS = 60_000;

export class DiscordPresenceController {
	private page: PageChangeEvent | null = null;
	private session: WritingSessionEvent | null = null;
	private hidden = false;
	private active = false;
	private failed = false;
	private failedAt = 0;
	private lastSent: PresenceActivity | null = null;
	/** Discord に表示を出している(消すべきものがある) */
	private onDiscord = false;
	private lastSentAt = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** 送信は 1 つずつ(順序が入れ替わらないように) */
	private chain: Promise<void> = Promise.resolve();
	private status: PresenceStatus = 'idle';
	private appStartedAt = 0;
	private readonly now: () => number;
	private readonly minInterval: number;
	private readonly retryInterval: number;

	constructor(private readonly deps: PresenceControllerDeps) {
		this.now = deps.now ?? Date.now;
		this.minInterval = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
		this.retryInterval = deps.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
	}

	/**
	 * 表示を始める(拡張を有効にしたとき)。いまの画面・前面かどうか・進行中のセッションを渡す。
	 * イベントの購読は attach で行う
	 */
	start(initial: {
		page: PageChangeEvent | null;
		visible: boolean;
		session: WritingSessionEvent | null;
	}): void {
		this.active = true;
		this.appStartedAt = this.now();
		this.page = initial.page;
		this.hidden = !initial.visible;
		this.session = initial.session;
		this.request();
	}

	/** 本体のイベントを購読する。返り値で解除 */
	attach(events: ExtensionEvents): () => void {
		const offs = [
			events.on('page:change', (event) => this.handlePage(event)),
			events.on('app:visibility', (event) => this.handleVisibility(event.visible)),
			events.on('session:start', (event) => this.handleSession(event)),
			events.on('session:update', (event) => this.handleSession(event)),
			events.on('session:end', (event) => this.handleSessionEnd(event))
		];
		return () => offs.forEach((off) => off());
	}

	private setStatus(status: PresenceStatus): void {
		if (this.status === status) return;
		this.status = status;
		this.deps.onStatusChange?.(status);
	}

	handlePage(event: PageChangeEvent): void {
		this.page = event;
		this.request();
	}

	handleVisibility(visible: boolean): void {
		this.hidden = !visible;
		this.request();
	}

	handleSession(event: WritingSessionEvent): void {
		if (this.session?.sessionId !== event.sessionId) {
			// 新しい執筆セッション: つなぎ直しを試みる
			this.failed = false;
		}
		this.session = event;
		this.request();
	}

	handleSessionEnd(event: WritingSessionEvent): void {
		if (this.session?.sessionId !== event.sessionId) return;
		this.session = null;
		this.request();
	}

	/** 設定(テンプレート・作品名の表示・Application ID など)が変わった。すぐに反映する */
	settingsChanged(): void {
		this.lastSentAt = 0;
		this.request();
	}

	/** 内容の更新を依頼する(間隔を空け、続けて来た依頼は 1 回にまとめる) */
	private request(): void {
		if (!this.active || this.timer) return;
		if (this.failed && this.now() - this.failedAt < this.retryInterval) return;
		const wait = Math.max(0, this.lastSentAt + this.minInterval - this.now());
		if (wait === 0) {
			this.enqueue();
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = null;
			this.enqueue();
		}, wait);
	}

	private enqueue(): void {
		this.lastSentAt = this.now();
		this.chain = this.chain.then(() => this.run());
	}

	/** その時点の状態から表示を作って送る(順番待ちの間に状態が変わっていても、最新を使う) */
	private async run(): Promise<void> {
		if (!this.active) return;
		const settings = this.deps.getSettings();
		const projectId = this.page?.projectId;
		const wantTitle =
			settings.showProjectTitle &&
			!!projectId &&
			(usesPlaceholder(settings.detailsTemplate, 'project') ||
				usesPlaceholder(settings.stateTemplate, 'project'));
		const wantTotal =
			settings.showTotalChars &&
			!!projectId &&
			(usesPlaceholder(settings.detailsTemplate, 'total') ||
				usesPlaceholder(settings.stateTemplate, 'total'));
		const [projectTitle, totalChars] = await Promise.all([
			wantTitle ? this.deps.getProjectTitle(projectId!).catch(() => undefined) : undefined,
			wantTotal ? this.deps.getProjectCharCount(projectId!).catch(() => undefined) : undefined
		]);
		// 取得している間に無効にされた
		if (!this.active) return;

		const activity = buildPresence(
			{
				page: this.page,
				session: this.session,
				projectTitle,
				totalChars,
				appStartedAt: this.appStartedAt,
				hidden: this.hidden
			},
			settings
		);

		if (!activity) {
			await this.clearOnDiscord();
			return;
		}
		if (this.onDiscord && samePresence(activity, this.lastSent)) return;
		// つなぎ直しの待ち時間の間は送らない
		if (this.failed && this.now() - this.failedAt < this.retryInterval) return;

		let ok = false;
		try {
			ok = await this.deps.transport.set(resolveApplicationId(settings.applicationId), activity);
		} catch {
			ok = false;
		}
		if (!this.active) {
			// 送っている間に無効にされた: 出てしまった表示を消す
			if (ok) await this.deps.transport.clear().catch(() => {});
			return;
		}
		if (ok) {
			this.failed = false;
			this.onDiscord = true;
			this.lastSent = activity;
			this.setStatus('shown');
		} else {
			// Discord が起動していないなど。しばらく(または次の執筆セッションまで)試さない
			this.failed = true;
			this.failedAt = this.now();
			this.onDiscord = false;
			this.lastSent = null;
			this.setStatus('unavailable');
		}
	}

	private async clearOnDiscord(): Promise<void> {
		this.lastSent = null;
		if (this.onDiscord) {
			this.onDiscord = false;
			await this.deps.transport.clear().catch(() => {});
		}
		this.setStatus('idle');
	}

	/** 表示を消して止める(拡張の無効化) */
	stop(): Promise<void> {
		this.active = false;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.session = null;
		this.failed = false;
		this.chain = this.chain.then(() => this.clearOnDiscord());
		return this.chain;
	}
}
