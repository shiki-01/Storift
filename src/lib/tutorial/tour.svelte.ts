/**
 * スポットライト型ツアーの状態。表示は TourOverlay.svelte が行う。
 * ステップは start() の時点で表示条件(when)により絞り込む。
 */
import { settingsDB } from '$lib/db';
import { isDesktop } from '$lib/desktop/platform';
import { viewport } from '$lib/stores/viewport.svelte';
import { SAMPLE_PROJECT_ID } from '$lib/tutorial/sample';
import { TOUR_STEPS } from './tourSteps';

export interface TourStep {
	id: string;
	title: string;
	/** 段落 */
	body: string[];
	/** 表示前に移動する画面。projectId はツアー中の作品(サンプル作品) */
	route?: (ctx: { projectId: string }) => string;
	/** 強調する要素。`[data-tour="xxx"]` のセレクタ。複数一致したら表示中の最初の要素 */
	target?: string;
	placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right';
	/**
	 * 'next' = 「次へ」で進む(既定)。
	 * 'click' = 強調した要素をユーザーがクリックしたら進む(「次へ」は出さない)。
	 */
	advance?: 'next' | 'click';
	/** カードに出す特別なボタン */
	action?: 'create-sample';
	/** 要素が見つからない時にこのステップを飛ばす */
	optional?: boolean;
	/** 既に目的の状態になっているとき、このステップを飛ばす(例: メモが既に開いている) */
	skipWhen?: () => boolean;
	/** 画面の移動後、要素を探す前に呼ぶ。対象を表示させるのに使う(例: 閉じている一覧を開く) */
	prepare?: () => void;
	/** 表示条件。desktop = デスクトップ版, web = Web 版, mobile = スマホ幅, wide = スマホ幅以外 */
	when?: 'desktop' | 'web' | 'mobile' | 'wide';
	/** カード内に出す外部リンク */
	link?: { label: string; href: string };
}

/** 直前に移動した向き。要素が無く飛ばすステップで、戻る操作中かどうかの判断に使う */
export type TourDirection = 'forward' | 'backward';

let active = $state(false);
let index = $state(0);
let direction = $state<TourDirection>('forward');
let steps = $state.raw<TourStep[]>([]);
let projectId = $state(SAMPLE_PROJECT_ID);

function matchesWhen(step: TourStep, desktop: boolean, mobile: boolean): boolean {
	switch (step.when) {
		case undefined:
			return true;
		case 'desktop':
			return desktop;
		case 'web':
			return !desktop;
		case 'mobile':
			return mobile;
		case 'wide':
			return !mobile;
	}
}

export const tourStore = {
	get active() {
		return active;
	},
	get index() {
		return index;
	},
	get direction() {
		return direction;
	},
	/** start() で表示条件により絞り込んだステップ */
	get steps() {
		return steps;
	},
	/** ツアー中の作品 ID。既定はサンプル作品 */
	get projectId() {
		return projectId;
	},
	set projectId(id: string) {
		projectId = id;
	},
	/** 現在のステップ。ツアーが動いていなければ null */
	get current(): TourStep | null {
		return active ? (steps[index] ?? null) : null;
	},

	/** ツアーを最初のステップから始める */
	start() {
		const desktop = isDesktop();
		const mobile = viewport.isMobile;
		steps = TOUR_STEPS.filter((step) => matchesWhen(step, desktop, mobile));
		projectId = SAMPLE_PROJECT_ID;
		index = 0;
		direction = 'forward';
		active = true;
	},

	/** 次のステップへ。最後のステップなら完了として終了する */
	next() {
		if (!active) return;
		if (index >= steps.length - 1) {
			tourStore.stop();
			return;
		}
		direction = 'forward';
		index += 1;
	},

	/** 前のステップへ */
	prev() {
		if (!active || index === 0) return;
		direction = 'backward';
		index -= 1;
	},

	/** 指定のステップへ移動する。範囲外の番号は無視する */
	goTo(i: number) {
		if (!active || !Number.isInteger(i) || i < 0 || i >= steps.length) return;
		direction = i >= index ? 'forward' : 'backward';
		index = i;
	},

	/**
	 * ツアーを終了する。終了時は「表示済み」として設定に記録する。
	 * 設定画面の「チュートリアルをもう一度見る」から再開できる。
	 */
	stop() {
		if (!active) return;
		active = false;
		index = 0;
		direction = 'forward';
		settingsDB.update({ tutorialDismissed: true }).catch((error: unknown) => {
			console.error('Failed to save tutorial state:', error);
		});
	}
};
