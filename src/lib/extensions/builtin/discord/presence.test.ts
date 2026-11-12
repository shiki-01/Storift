import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings.svelte';
import { buildPresence, formatNetChars, samePresence, type PresenceInput } from './presence';

const T0 = Date.UTC(2026, 10, 12, 1, 0, 0);
const base: PresenceInput = {
	page: { page: 'editor', projectId: 'p1' },
	session: null,
	appStartedAt: T0,
	hidden: false
};
const session = { startedAt: T0 + 60_000, netChars: 1234 };

describe('formatNetChars', () => {
	it('符号付き。0 は ±0', () => {
		expect(formatNetChars(1234)).toBe('+1,234');
		expect(formatNetChars(-120)).toBe('-120');
		expect(formatNetChars(0)).toBe('±0');
	});
});

describe('buildPresence', () => {
	it('既定: 画面のラベルだけ。執筆セッションが無ければ State・小さい画像は出さない', () => {
		const a = buildPresence(base, DEFAULT_SETTINGS)!;
		expect(a).toMatchObject({
			details: '執筆中',
			state: '',
			largeImage: 'logo',
			largeText: 'Storift',
			smallImage: '',
			smallText: '',
			startTimestamp: T0 / 1000
		});
	});

	it('画面ごとのラベル', () => {
		const label = (page: PresenceInput['page']) =>
			buildPresence({ ...base, page }, DEFAULT_SETTINGS)!.details;
		expect(label({ page: 'home' })).toBe('ホーム');
		expect(label({ page: 'plot', projectId: 'p' })).toBe('プロットを練っています');
		expect(label({ page: 'settings' })).toBe('設定を開いています');
		expect(label(null)).toBe('Storift');
	});

	it('執筆セッション中: State(増減文字数)・small_image=writing(small_text は画面のラベル)・開始時刻', () => {
		const a = buildPresence({ ...base, session }, DEFAULT_SETTINGS)!;
		expect(a).toMatchObject({
			details: '執筆中',
			state: '+1,234 字',
			smallImage: 'writing',
			smallText: '執筆中',
			startTimestamp: (T0 + 60_000) / 1000
		});
		// 執筆セッション中に別の画面を開いても、小さい画像の説明はその画面のラベル
		const b = buildPresence(
			{ ...base, page: { page: 'plot', projectId: 'p1' }, session },
			DEFAULT_SETTINGS
		)!;
		expect(b.smallText).toBe('プロットを練っています');
	});

	it('作品名はオンのときだけ。オフなら「『』を」を残さない', () => {
		const settings = { ...DEFAULT_SETTINGS, detailsTemplate: '『{project}』を{page}' };
		const off = buildPresence({ ...base, projectTitle: '月の庭' }, settings)!;
		expect(off.details).toBe('執筆中');
		const on = buildPresence(
			{ ...base, projectTitle: '月の庭' },
			{ ...settings, showProjectTitle: true }
		)!;
		expect(on.details).toBe('『月の庭』を執筆中');
		// 作品名が取得できていなければ省く
		expect(buildPresence(base, { ...settings, showProjectTitle: true })!.details).toBe('執筆中');
	});

	it('総文字数はオンのときだけ', () => {
		const settings = { ...DEFAULT_SETTINGS, detailsTemplate: '{page} / {total} 字' };
		expect(buildPresence({ ...base, totalChars: 12345 }, settings)!.details).toBe('執筆中');
		expect(
			buildPresence({ ...base, totalChars: 12345 }, { ...settings, showTotalChars: true })!.details
		).toBe('執筆中 / 12,345 字');
	});

	it('テンプレートが空・短すぎるときは、Details は画面のラベルにし、State は省く', () => {
		const s = { ...DEFAULT_SETTINGS, detailsTemplate: '', stateTemplate: 'あ' };
		const a = buildPresence({ ...base, session }, s)!;
		expect(a.details).toBe('執筆中');
		expect(a.state).toBe('');
	});

	it('前面にないとき: keep は続ける、clear は消す(null)、away は「離席中」', () => {
		const hidden = { ...base, session, hidden: true };
		expect(buildPresence(hidden, DEFAULT_SETTINGS)!.details).toBe('執筆中');
		expect(buildPresence(hidden, { ...DEFAULT_SETTINGS, whenHidden: 'clear' })).toBeNull();
		const away = buildPresence(hidden, { ...DEFAULT_SETTINGS, whenHidden: 'away' })!;
		expect(away).toMatchObject({ details: '離席中', state: '', smallImage: '' });
		// 前面にあれば、設定に関わらず通常の表示
		expect(
			buildPresence({ ...base, hidden: false }, { ...DEFAULT_SETTINGS, whenHidden: 'clear' })
		).not.toBeNull();
	});

	it('128 文字に切り詰める', () => {
		const s = { ...DEFAULT_SETTINGS, showProjectTitle: true, detailsTemplate: '{project}' };
		const a = buildPresence({ ...base, projectTitle: 'あ'.repeat(300) }, s)!;
		expect([...a.details]).toHaveLength(128);
	});
});

describe('samePresence', () => {
	it('同じ内容なら true', () => {
		const a = buildPresence(base, DEFAULT_SETTINGS);
		expect(samePresence(a, buildPresence(base, DEFAULT_SETTINGS))).toBe(true);
		expect(samePresence(a, buildPresence({ ...base, session }, DEFAULT_SETTINGS))).toBe(false);
		expect(samePresence(null, null)).toBe(true);
		expect(samePresence(a, null)).toBe(false);
	});
});
