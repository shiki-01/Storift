/**
 * 開いている画面・執筆セッションから、Discord に出す内容(Rich Presence)を作る。DOM・状態に依存しない純関数。
 * 本文は扱わない。作品名・総文字数は、設定でオンにしたときだけ値が入る(オフなら空として扱い、
 * それを含む区間ごと省く。template.ts を参照)
 */
import type { PageChangeEvent, WritingSessionEvent } from '$lib/extensions/events';
import { PAGE_LABELS } from '$lib/extensions/pages';
import { LARGE_IMAGE_KEY, LARGE_IMAGE_TEXT, SMALL_IMAGE_KEY } from './config';
import { renderTemplate, type TemplateVars } from './template';

/** アプリが前面にないとき(別のウィンドウに移った・最小化した)の扱い */
export type HiddenBehavior = 'keep' | 'clear' | 'away';

export const AWAY_LABEL = '離席中';

export interface DiscordSettings {
	/** 作品名を送るか({project} に入る)。既定はオフ */
	showProjectTitle: boolean;
	/** 作品の総文字数を送るか({total} に入る)。既定はオフ */
	showTotalChars: boolean;
	/** 1 行目のテンプレート */
	detailsTemplate: string;
	/** 2 行目のテンプレート(執筆セッション中だけ出す) */
	stateTemplate: string;
	whenHidden: HiddenBehavior;
	/** 利用者が上書きした Application ID(空なら既定の ID) */
	applicationId: string;
}

export const DEFAULT_DETAILS_TEMPLATE = '{page}';
export const DEFAULT_STATE_TEMPLATE = '{chars} 字';

/** Rust 側のコマンド discord_set_activity に渡す内容。空の項目は送られない */
export interface PresenceActivity {
	details: string;
	state: string;
	/** 経過時間の起点(Unix 秒) */
	startTimestamp: number;
	largeImage: string;
	largeText: string;
	smallImage: string;
	smallText: string;
}

export interface PresenceInput {
	page: PageChangeEvent | null;
	/** 進行中の執筆セッション(無ければ null) */
	session: Pick<WritingSessionEvent, 'startedAt' | 'netChars'> | null;
	/** 作品名・総文字数(権限と設定で許されたときだけ、呼び出し側が渡す) */
	projectTitle?: string;
	totalChars?: number;
	/** 経過時間の起点(セッションが無いときは、この時刻から数える。Unix ミリ秒) */
	appStartedAt: number;
	hidden: boolean;
}

/** 増減した文字数。`+1,234` / `-120` / `±0` */
export function formatNetChars(netChars: number): string {
	if (netChars === 0) return '±0';
	return `${netChars < 0 ? '-' : '+'}${Math.abs(netChars).toLocaleString('en-US')}`;
}

/** Discord は 2 文字未満の details / state を受け付けない */
const MIN_TEXT_LENGTH = 2;
const longEnough = (text: string) => [...text].length >= MIN_TEXT_LENGTH;

/** 画面のラベル */
export function pageLabelOf(page: PageChangeEvent | null): string {
	return PAGE_LABELS[page?.page ?? 'other'];
}

/**
 * 表示する内容を作る。表示しない(消す)ときは null
 * (前面にないときの設定が「消す」で、アプリが前面にないとき)
 */
export function buildPresence(
	input: PresenceInput,
	settings: DiscordSettings
): PresenceActivity | null {
	if (input.hidden && settings.whenHidden === 'clear') return null;
	const label = pageLabelOf(input.page);
	const base = {
		largeImage: LARGE_IMAGE_KEY,
		largeText: LARGE_IMAGE_TEXT
	};

	if (input.hidden && settings.whenHidden === 'away') {
		return {
			...base,
			details: AWAY_LABEL,
			state: '',
			startTimestamp: Math.floor(input.appStartedAt / 1000),
			smallImage: '',
			smallText: ''
		};
	}

	const vars: TemplateVars = {
		page: label,
		project: settings.showProjectTitle ? (input.projectTitle ?? '') : '',
		total:
			settings.showTotalChars && input.totalChars !== undefined
				? input.totalChars.toLocaleString('en-US')
				: '',
		chars: input.session ? formatNetChars(input.session.netChars) : ''
	};

	const details = renderTemplate(settings.detailsTemplate, vars);
	// 執筆セッション中でないときは、2 行目を出さない
	const state = input.session ? renderTemplate(settings.stateTemplate, vars) : '';

	return {
		...base,
		details: longEnough(details) ? details : label,
		state: longEnough(state) ? state : '',
		startTimestamp: Math.floor((input.session?.startedAt ?? input.appStartedAt) / 1000),
		// 小さい画像は、執筆セッション中だけ
		smallImage: input.session ? SMALL_IMAGE_KEY : '',
		smallText: input.session ? label : ''
	};
}

/** 同じ内容か(同じなら送り直さない) */
export function samePresence(a: PresenceActivity | null, b: PresenceActivity | null): boolean {
	if (!a || !b) return a === b;
	return (
		a.details === b.details &&
		a.state === b.state &&
		a.startTimestamp === b.startTimestamp &&
		a.largeImage === b.largeImage &&
		a.largeText === b.largeText &&
		a.smallImage === b.smallImage &&
		a.smallText === b.smallText
	);
}
