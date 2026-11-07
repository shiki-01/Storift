/**
 * ツアーのステップ内容(データ)。文面はここだけを直せばよいように、データとして持つ。
 * target は `[data-tour="名前"]` に対応する。名前は各画面の data-tour 属性と一致させること。
 */
import type { TourStep } from './tour.svelte';
import { editorStore } from '$lib/stores/editor.svelte';

const editorRoute = ({ projectId }: { projectId: string }) => `/project/${projectId}/editor`;

export const TOUR_STEPS: TourStep[] = [
	{
		id: 'welcome',
		title: 'Storift について',
		body: [
			'Storift は、作品ごとに本文・プロット・人物・設定資料・進捗・メモをまとめて扱える執筆アプリです。',
			'このツアーでは、サンプル作品を使って主な機能を順に操作します。所要時間は3分ほどです。いつでも終了でき、設定画面の「チュートリアルをもう一度見る」から再開できます。'
		]
	},
	{
		id: 'home-new',
		title: '作品を作る',
		body: ['自分の作品は、この「＋ 新しい作品」から作成します。タイトルは後から変更できます。'],
		route: () => '/home',
		target: '[data-tour="home-new-project"]'
	},
	{
		id: 'sample',
		title: 'サンプル作品で練習する',
		body: [
			'このツアーでは、サンプル作品で操作を試せます。サンプル作品は自由に編集・削除してかまいません。',
			'「サンプル作品を作って始める」を押すと作成され、ツアーが続きます。'
		],
		action: 'create-sample'
	},
	{
		id: 'scene-list',
		title: '章とシーンの一覧',
		body: [
			'左の一覧で「＋ 章」を押すと章を、章の中の「＋ シーン」を押すとシーンを追加できます。',
			'執筆アイコンをもう一度押すと、一覧を開閉できます。'
		],
		route: editorRoute,
		target: '[data-tour="editor-scene-list"]',
		// 一覧が閉じていれば開いてから示す
		prepare: () => {
			editorStore.sceneListOpen = true;
		},
		optional: true,
		when: 'wide'
	},
	{
		id: 'editor-body',
		title: '本文を書く',
		body: [
			'ここに本文を書いてみてください。何か一文でかまいません。',
			'入力が止まって約2秒後に自動で保存されます。Ctrl+S でも保存できます。'
		],
		// スマホでは一覧のステップを飛ばすため、執筆画面への移動をここでも行う(同じ画面なら移動しない)
		route: editorRoute,
		target: '[data-tour="editor-body"]'
	},
	{
		id: 'toolbar-view',
		title: '表示の切り替え',
		body: [
			'執筆のみ・二画面・プレビューのみを切り替えられます。',
			'プレビューでは、縦書きの表示にも切り替えられます。'
		],
		target: '[data-tour="editor-view-mode"]',
		// ツールバーはデスクトップ・タブレット幅でのみ表示される
		when: 'wide'
	},
	{
		id: 'toolbar-memo',
		title: 'メモを開く',
		body: ['ここを押して、メモ欄を開いてみてください。'],
		target: '[data-tour="editor-memo-button"]',
		advance: 'click',
		when: 'wide',
		skipWhen: () => editorStore.memoOpen
	},
	{
		id: 'memo-panel',
		title: 'メモ',
		body: [
			'思いついたことを書き留めます。タグ(todo・アイデア・伏線など)で分類できます。',
			'本文を範囲選択して右クリックすると、その位置にメモを付けられます。Ctrl+Shift+M で開閉できます。'
		],
		target: '[data-tour="memo-panel"]',
		placement: 'left',
		when: 'wide'
	},
	{
		id: 'toolbar-export',
		title: '書き出しとバックアップ',
		body: [
			'テキストや PDF などの形式で書き出せます。',
			'JSON 形式のバックアップも、ここから作成できます。'
		],
		target: '[data-tour="editor-export"]',
		optional: true
	},
	{
		id: 'toolbar-ai',
		title: 'AI と連携する',
		body: [
			'デスクトップ版では、AI に本文の相談や推敲を依頼できます。',
			'メモの todo を AI に依頼することもできます。'
		],
		target: '[data-tour="editor-ai"]',
		optional: true,
		when: 'desktop'
	},
	{
		id: 'nav-plot',
		title: 'プロットを開く',
		body: ['メニューの「プロット」を押してください。'],
		target: '[data-tour="nav-plot"]',
		advance: 'click'
	},
	{
		id: 'plot-view',
		title: 'プロットの表示',
		body: [
			'プロットは「ボード」と「タイムライン」の 2 つの表示で確認できます。',
			'表示は、ここで切り替えられます。',
			'カードを押すと全文が読めます。左のハンドルをドラッグすると、並べ替えや別の列(状態)への移動ができます。'
		],
		target: '[data-tour="plot-view-toggle"]'
	},
	{
		id: 'nav-characters',
		title: '人物を開く',
		body: ['メニューの「人物」を押してください。'],
		target: '[data-tour="nav-characters"]',
		advance: 'click'
	},
	{
		id: 'characters-graph',
		title: '相関図',
		body: ['「相関図」を押して、人物どうしの関係を表示する画面に切り替えてください。'],
		target: '[data-tour="characters-graph-button"]',
		advance: 'click'
	},
	{
		id: 'relation-canvas',
		title: '相関図を編集する',
		body: [
			'丸い点からドラッグすると、人物どうしの関係線を作れます。',
			'線の中央の点をドラッグすると線をずらせます。双方向の関係が重ならないように使えます。',
			'線をクリックすると、その関係を編集できます。'
		],
		target: '[data-tour="relation-canvas"]',
		placement: 'top'
	},
	{
		id: 'nav-worldbuilding',
		title: '設定資料を開く',
		body: ['メニューの「設定資料」を押してください。'],
		target: '[data-tour="nav-worldbuilding"]',
		advance: 'click'
	},
	{
		id: 'worldbuilding-tabs',
		title: '設定資料の分類',
		body: ['用語・場所・年表・その他に分けて、世界観の情報を残せます。'],
		target: '[data-tour="worldbuilding-categories"]'
	},
	{
		id: 'nav-progress',
		title: '進捗を開く',
		body: ['メニューの「進捗」を押してください。'],
		target: '[data-tour="nav-progress"]',
		advance: 'click'
	},
	{
		id: 'progress-goal',
		title: '目標と記録',
		body: [
			'目標に対する達成率と、日ごとの執筆量を確認できます。',
			'1 日の目標文字数は、執筆画面の「執筆の目標」から設定します。'
		],
		// 設定画面から戻ったときにも進捗画面を開く
		route: ({ projectId }) => `/project/${projectId}/progress`,
		target: '[data-tour="progress-goal"]'
	},
	{
		id: 'settings-theme',
		title: 'テーマ',
		body: [
			'テーマを選ぶと、画面の配色が変わります。',
			'テーマエディタでは自分の配色を作成し、書き出しや読み込みができます。'
		],
		route: () => '/settings#appearance',
		target: '[data-tour="settings-theme"]'
	},
	{
		id: 'settings-sync',
		title: '同期(任意)',
		body: [
			'同期は任意です。使うには、ご自身で Google の Firebase プロジェクトを作成します。設定値は、同期欄の「Firebase設定ページへ」から開く画面で入力します(未設定のときに表示されます)。',
			'Firebase は Google のクラウドサービスです。データはご自身の Firebase に保存され、運営者が内容を見ることはできません。',
			'設定と管理は自己責任で行ってください。設定値は他人に教えないでください。手順は紹介サイトのガイドを参照してください。'
		],
		route: () => '/settings#sync',
		target: '[data-tour="settings-sync"]',
		link: {
			label: 'Firebase 設定ガイドを開く',
			href: 'https://storift.shiki-01.com/guide/firebase'
		}
	},
	{
		id: 'settings-backup',
		title: 'データの保存とバックアップ',
		body: [
			'データは、この端末のブラウザ内に保存されます。',
			'サイトデータを削除すると消えるため、定期的に全データをエクスポートしてバックアップしてください。'
		],
		// 完了(ホーム)から戻ったときにも設定画面を開く
		route: () => '/settings#data',
		target: '[data-tour="settings-backup"]'
	},
	{
		id: 'finish',
		title: '完了',
		body: [
			'チュートリアルは以上です。',
			'設定画面の「チュートリアルをもう一度見る」から、いつでも再開できます。サンプル作品が不要であれば、作品一覧から削除できます。'
		],
		route: () => '/home',
		logo: true
	}
];
