/** 操作デモの見本。site/scripts/seed.js の撮影用作品と同じ物語 */
export type View = 'editor' | 'plot' | 'relation' | 'world' | 'progress';
export type PlotStatus = 'idea' | 'planned' | 'written' | 'revised';

export const BASE_TEXT = [
	'　坂の上の古書店は、雨の日にだけ灯りをともす。',
	'　｜栞《しおり》の挟まった頁をひらくと、そこには祖母の字で、私の知らない町の名前が書かれていた。',
	'　「この町へは、もう行けないのよ」'
].join('\n');

/** アプリのプロットのボードと同じ四つの状態 */
export const COLUMNS: { status: PlotStatus; label: string }[] = [
	{ status: 'idea', label: 'アイデア' },
	{ status: 'planned', label: '計画中' },
	{ status: 'written', label: '執筆済み' },
	{ status: 'revised', label: '推敲済み' }
];

export const PLOTS: {
	id: string;
	title: string;
	type: string;
	status: PlotStatus;
	color: string;
}[] = [
	{
		id: 'pl1',
		title: '店主は祖母を知っていた?',
		type: 'シーン',
		status: 'idea',
		color: 'var(--color-accent)'
	},
	{
		id: 'pl2',
		title: '消えた駅の時刻表',
		type: 'シーン',
		status: 'idea',
		color: 'var(--color-accent)'
	},
	{
		id: 'pl3',
		title: '町は地図から消えていた',
		type: 'アーク',
		status: 'planned',
		color: 'var(--color-primary)'
	},
	{
		id: 'pl5',
		title: '栞の町を探しはじめる',
		type: '章',
		status: 'written',
		color: 'var(--color-success)'
	},
	{
		id: 'pl6',
		title: '雨の日、古書店で栞を見つける',
		type: 'シーン',
		status: 'revised',
		color: 'var(--color-text-secondary)'
	}
];
