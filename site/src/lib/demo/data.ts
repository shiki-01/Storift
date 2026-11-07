/** 操作デモの見本。site/scripts/seed.js の撮影用作品と同じ物語 */
export type View = 'editor' | 'plot' | 'characters' | 'world' | 'progress';
export type PlotStatus = 'idea' | 'planned' | 'written' | 'revised';
export type CharMode = 'list' | 'graph';
export type WorldCategory = 'term' | 'location' | 'timeline' | 'other';

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

/** プロットの色の帯は、種類ごとにアプリと同じ基調色から選ぶ */
export const PLOTS: {
	id: string;
	title: string;
	body: string;
	type: string;
	status: PlotStatus;
	color: string;
}[] = [
	{
		id: 'pl1',
		title: '店主は祖母を知っていた?',
		body: '栞を見せたときの反応を伏線にする。',
		type: 'シーン',
		status: 'idea',
		color: 'var(--color-accent)'
	},
	{
		id: 'pl2',
		title: '消えた駅の時刻表',
		body: '第二章の途中で、地図との食い違いに気づかせる。',
		type: 'シーン',
		status: 'idea',
		color: 'var(--color-accent)'
	},
	{
		id: 'pl3',
		title: '町はすでに地図から消えていた',
		body: 'ダム建設で沈んだ町だと分かる。物語の転換点。',
		type: 'アーク',
		status: 'planned',
		color: 'var(--color-primary)'
	},
	{
		id: 'pl4',
		title: '祖母が町を離れた理由',
		body: '手紙の差出人と、栞の意味が重なる。',
		type: '章',
		status: 'planned',
		color: 'var(--color-primary)'
	},
	{
		id: 'pl5',
		title: '栞に書かれた町を探しはじめる',
		body: '湊を巻き込んで、図書館と古地図をあたる。',
		type: '章',
		status: 'written',
		color: 'var(--color-success)'
	},
	{
		id: 'pl6',
		title: '雨の日、古書店で栞を見つける',
		body: '物語の入口。雨の日にだけ開く店。',
		type: 'シーン',
		status: 'revised',
		color: 'var(--color-text-secondary)'
	}
];

/** 人物。tone はアバターの色(アプリは人物ごとに色を割り当てる) */
export const CHARACTERS: {
	id: string;
	name: string;
	mark: string;
	sub: string;
	tone: 'primary' | 'accent' | 'secondary';
}[] = [
	{ id: 'akari', name: '朝倉 灯', mark: '朝', sub: '主人公 ・ 17歳', tone: 'primary' },
	{ id: 'shizu', name: '朝倉 静', mark: '朝', sub: '祖母', tone: 'primary' },
	{ id: 'mashiba', name: '真柴 蓮', mark: '真', sub: '古書店の店主', tone: 'accent' },
	{ id: 'seo', name: '瀬尾 湊', mark: '瀬', sub: '同級生', tone: 'secondary' }
];

export const WORLD_CHIPS: { value: 'all' | WorldCategory; label: string }[] = [
	{ value: 'all', label: 'すべて' },
	{ value: 'term', label: '用語' },
	{ value: 'location', label: '場所' },
	{ value: 'timeline', label: '年表' },
	{ value: 'other', label: 'その他' }
];

export const WORLD: {
	id: string;
	category: WorldCategory;
	title: string;
	body: string;
	tags: string[];
}[] = [
	{
		id: 'w3',
		category: 'term',
		title: '預かり本',
		body: '店主が持ち主に代わって保管している本のこと。値札がついていない。',
		tags: ['古書店']
	},
	{
		id: 'w1',
		category: 'location',
		title: '坂の上の古書店',
		body: '雨の日にだけ灯りをともす店。屋号は掠れて読めない。奥の棚には売り物ではない本が並ぶ。',
		tags: ['舞台', '現在']
	},
	{
		id: 'w2',
		category: 'location',
		title: '霧ヶ沢',
		body: '栞に書かれていた町の名前。昭和四十年代にダムの底へ沈んだ。',
		tags: ['舞台', '過去']
	},
	{
		id: 'w4',
		category: 'timeline',
		title: '町の年表',
		body: '昭和三十八年 ダム計画の発表 / 昭和四十一年 集団移転 / 昭和四十三年 湛水開始',
		tags: ['過去']
	},
	{
		id: 'w6',
		category: 'other',
		title: '祖母の傘',
		body: '雨の日にいつも持ち歩いていた、柄の長い黒い傘。',
		tags: ['現在']
	}
];
