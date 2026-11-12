<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import Icon from '$lib/Icon.svelte';
	import Shot from '$lib/Shot.svelte';
	import type { IconName } from '$lib/icons';
	import { APP_URL } from '$lib/config';

	type Item = {
		title: string;
		body: string;
		desktop?: boolean;
		link?: { href: string; label: string };
	};
	type Group = {
		id: string;
		icon: IconName;
		title: string;
		lead: string;
		items: Item[];
		shot?: { name: string; alt: string };
	};

	const groups: Group[] = [
		{
			id: 'write',
			icon: 'write',
			title: '書く',
			lead: '原稿を章とシーンに分けて書く画面です。',
			shot: {
				name: 'editor',
				alt: '執筆画面。左に章とシーンの一覧、右に本文が並び、上部に文字数と保存状態、表示モードの切り替えがある'
			},
			items: [
				{
					title: '章とシーン',
					body: '作品を章とシーンに分け、並べ替えながら書き進めます。シーンごとに文字数が出ます。'
				},
				{
					title: '自動保存',
					body: '入力が止まって約 2 秒後に保存します。入力し続けているときに待つ最大の時間（既定 30 秒）は、設定で変えられます。'
				},
				{
					title: 'ルビと傍点',
					body: '｜漢字《かんじ》 でルビ、《《強調》》 で傍点。文字を選んでから入れると、記号で囲んだ形で入ります。'
				},
				{
					title: '検索と置換',
					body: 'シーン・章・人物・プロット・設定資料から、まとめて探して置き換えられます。正規表現にも対応しています。'
				},
				{
					title: '校正',
					body: 'ら抜き言葉、冗長な言い回し、同じ語尾の連続、長すぎる文などを拾い、直し方を示します。'
				},
				{
					title: '書体と配色',
					body: '本文の書体と大きさを選べます。配色は「和紙」「墨」「古書」「夜」の四つです。'
				},
				{
					title: 'ショートカット',
					body: 'よく使う操作にはキーボードの割り当てがあり、設定で自由に変えられます。'
				},
				{
					title: 'ツールバーの並べ替え',
					body: '執筆画面の上部のボタンは、設定の「エディタ」で並べ替えられます。ボタンごとに「常時表示」か「三点メニュー（…）にまとめる」かも選べます。並べ替えは取っ手のドラッグか、キーボード（取っ手で Space を押して持ち上げ、矢印で動かし、Space で置く）で行います。この設定は端末ごとに保存され、スマートフォンの上部バーには影響しません。'
				}
			]
		},
		{
			id: 'organize',
			icon: 'plot',
			title: '整理する',
			lead: '物語の材料を、作品ごとに原稿の隣に置いておけます。',
			shot: {
				name: 'plot',
				alt: 'プロットのボード。アイデア、計画中、執筆済み、推敲済みの四つの列にカードが並ぶ'
			},
			items: [
				{
					title: 'プロット',
					body: '物語の流れをカードにして、「アイデア」「計画中」「執筆済み」「推敲済み」の列に並べるボードと、順番に並べるタイムラインがあります。カードを選ぶと、詳細に全文が出ます。書く前の設計にも、書きながらの見直しにも使えます。'
				},
				{
					title: '人物と相関図',
					body: '登場人物を一人ずつまとめます。一覧では円形のアバターで並び、選ぶと外見・性格・背景・関係が全文で読めます。人物同士のつながりは相関図で整理でき、矢印は片方向・双方向・お互い別(それぞれが相手へ向く 2 本)から選べます。'
				},
				{
					title: '並べ替え',
					body: 'プロット・人物・設定資料は、取っ手をドラッグするか、キーボード（取っ手で Space を押して持ち上げ、矢印で動かし、Space で置く）、「…」メニューの「上へ」「下へ」で並べ替えられます。プロットは、カードを別の列へ運ぶと状態も変わり、元に戻すこともできます。'
				},
				{
					title: 'メモ',
					body: '思いついたことを、執筆画面の横にすぐ書き留めておけます。本文の一部を選んでその箇所に紐づけたり、タグで分けたり、あとからプロットにまとめ直したりできます。'
				},
				{
					title: '設定資料',
					body: '世界観、地名、用語などのきまりごとをまとめておく場所です。分類は「用語」「場所」「年表」「その他」で、分類のチップとタグで絞り込み、検索できます。選ぶと、詳細に全文が出ます。'
				},
				{
					title: '進捗',
					body: '日ごとに書いた文字数と時間を記録し、目標の達成率や、書いた日の並びを確かめられます。'
				},
				{
					title: 'ネタ帳',
					body: '書いている途中で浮かんだ思いつきを、本文から離れずに書き留めておけます。'
				}
			]
		},
		{
			id: 'check',
			icon: 'vertical',
			title: '確かめる',
			lead: '書いた原稿が、読まれるときにどう見えるかを確かめます。',
			shot: {
				name: 'preview',
				alt: '通読の画面。作品全体が章をまたいで一続きに並び、上部に目次、横書き・縦書きの切り替え、表示設定がある'
			},
			items: [
				{
					title: '通読',
					body: '左のレールの「通読」で、作品全体を章をまたいで通して読みます。横書きと縦書きを切り替えられ、目次から章へ移れます。気になった場面は、鉛筆のボタンからエディタで開けます。'
				},
				{
					title: '縦書きプレビュー',
					body: '執筆画面の上部で「二画面表示」にすると、本文の隣に縦書きで表示します。ルビや傍点もそのまま反映されます。'
				},
				{
					title: '原稿用紙',
					body: '原稿用紙の升目に流し込んだ体裁で確認できます。枚数の見当をつけるのにも使えます。'
				},
				{
					title: '印刷',
					body: '印刷用のプレビューを開き、そのまま印刷や PDF への保存ができます。'
				}
			]
		},
		{
			id: 'keep',
			icon: 'offline',
			title: '守る',
			lead: '書いたものを失わないための仕組みです。',
			items: [
				{
					title: 'オフライン',
					body: '一度読み込めば、通信がなくても起動して書けます。ホーム画面に追加すれば、アプリのように開けます。'
				},
				{
					title: '端末をまたいだ同期',
					body: 'ご自身の Firebase プロジェクトを設定すると、複数の端末で同じ作品を書けます。'
				},
				{
					title: '共有と共同編集',
					body: '作品ごとに招待リンクを作り、閲覧か編集の権限で相手を招けます。シーンの本文は、同時に編集できます。共有には、ご自身の Firebase に新しいセキュリティルールを適用する必要があります。'
				},
				{
					title: '他の人のカーソル',
					body: '共同編集中は、相手のカーソルと選択範囲が本文に表示されます。表示は設定でオフにできます。'
				},
				{
					title: '履歴と復元',
					body: '版を残し、以前の状態へ戻せます。同期で上書きされる側の版は自動で控え、設定画面から復元できます。'
				},
				{
					title: '書き出し',
					body: 'TXT・Markdown・DOCX・PDF・EPUB・JSON で書き出せます。JSON はそのまま読み込み直せます。'
				}
			]
		},
		{
			id: 'extensions',
			icon: 'panel',
			title: '拡張機能',
			lead: '必要な人だけが有効にする、追加の機能です。',
			items: [
				{
					title: '拡張機能とは',
					body: '設定の「拡張機能」から、一つずつ有効・無効を切り替えます。既定はすべて無効で、有効にしたかどうかは端末ごとに覚えます。無効なあいだは、何も動かず、画面にも現れません。有効にするときは、その拡張が扱う情報(何を、どこへ送るか)を示した確認画面が出て、同意すると有効になります。同じ内容は、各拡張のページで読めます。'
				},
				{
					title: 'ツールバーのアイコンから操作',
					body: '有効にした拡張機能は、執筆画面のツールバーにアイコンが加わります。押すとその場にポップアップが開き、状態の確認や操作ができます。ほかのボタンと同じように並べ替えたり、三点メニュー（…）にまとめたりできます。スマートフォンでは、「その他の操作」のシートから開きます。'
				},
				{
					title: 'Monolog. 連携',
					body: '執筆している間の時間と、増減した文字数を、時間記録アプリ Monolog. に記録します。最初の編集で計測を始め、一定時間（5・10・15・30 分から選択、既定 5 分）操作がなければ終了して記録します。Monolog. のアカウントで接続したときだけ動き、本文は送りません。Web 版（本番のエディタ）とデスクトップ版で使えます。',
					link: { href: '/extensions/monolog', label: 'この拡張が扱う情報' }
				},
				{
					title: 'Discord Rich Presence',
					body: 'Storift を開いている間、Discord のプロフィールに、いま開いている画面(執筆中、プロットを練っています、など)と経過時間を表示します。執筆中は増減した文字数も出します。作品名と作品の総文字数は、設定でオンにしたときだけ表示に入ります(既定はオフ)。表示する文字は、設定でテンプレートとして書き換えられ、設定画面でプレビューを確認できます。デスクトップ版のみで、Discord が起動しているときだけ動きます。本文は送りません。',
					desktop: true,
					link: { href: '/extensions/discord', label: 'この拡張が扱う情報' }
				},
				{
					title: '拡張機能の種類',
					body: 'いま使えるのは、Storift に同梱する「公式」の拡張機能です。テーマや辞書などの「パック」と、隔離して動く「スクリプト」、コミュニティの拡張機能への対応は、今後の予定です。',
					link: { href: '/extensions', label: '拡張機能の一覧' }
				}
			]
		},
		{
			id: 'desktop',
			icon: 'ai',
			title: 'デスクトップ版',
			lead: 'Windows・macOS・Linux 向けのアプリです。Web 版の機能に加えて、次のものが使えます。',
			items: [
				{
					title: 'AI のパネル',
					body: '執筆画面の横で AI に相談できます。Claude Code・OpenAI 互換 API・Anthropic API・Gemini・Ollama から選べます。作品ごとに会話が分かれ、全作品を横断した確認もできます。',
					desktop: true
				},
				{
					title: '選んだ文から質問',
					body: '本文を選ぶと「AI に聞く」「校正」「書き換え」が出ます。選んだ部分に絞って相談できます。',
					desktop: true
				},
				{
					title: '本文の編集の扱い',
					body: '「提案のみ」「差分を確認して反映」「自動で反映（後から確認）」から選べます。書き換えの案は文字単位の差分で本文の上に示され、反映後も元に戻せます。',
					desktop: true
				}
			]
		}
	];
</script>

<Seo
	title="機能"
	description="Storift の機能一覧。執筆、プロット、人物と相関図、設定資料、進捗、通読と縦書きプレビュー、オフライン、同期、共有と共同編集、書き出し、拡張機能（Monolog. 連携、Discord Rich Presence）、デスクトップ版の AI パネル。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">機能</p>
		<h1>書く、整理する、確かめる。</h1>
		<p>小説を一作書き上げるまでに使うものを、ひとつのアプリにまとめています。</p>
		<nav class="toc" aria-label="この頁の目次">
			{#each groups as g (g.id)}
				<a href="#{g.id}"><Icon name={g.icon} size={16} />{g.title}</a>
			{/each}
		</nav>
	</div>

	{#each groups as g (g.id)}
		<section class="group" id={g.id}>
			<header>
				<span class="g-icon"><Icon name={g.icon} /></span>
				<h2>{g.title}</h2>
				<p>{g.lead}</p>
			</header>
			<div class="content">
				{#if g.shot}
					<Shot name={g.shot.name} alt={g.shot.alt} />
				{/if}
				<dl>
					{#each g.items as item (item.title)}
						<div class="row">
							<dt>{item.title}</dt>
							<dd>
								{item.body}
								{#if item.link}<a class="item-link" href={item.link.href}>{item.link.label}</a>{/if}
							</dd>
						</div>
					{/each}
				</dl>
			</div>
		</section>
	{/each}

	<div class="next">
		<p>はじめての方は、使い方の手順から。</p>
		<a class="btn secondary" href="/guide">使い方を見る</a>
		<a class="btn primary" href={APP_URL}>エディタを開く</a>
	</div>
</div>

<style>
	.item-link {
		display: inline-block;
		margin-left: 6px;
		white-space: nowrap;
	}

	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 28px;
	}

	.toc a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text);
		font-size: 13px;
		text-decoration: none;
		transition: background-color 0.15s;
	}

	.toc a:hover {
		background: var(--hover);
	}

	.group {
		display: grid;
		grid-template-columns: 15rem 1fr;
		gap: 40px;
		padding: 40px 0;
	}

	.group + .group {
		border-top: 1px solid var(--color-border);
	}

	/* 項目を読み進める間、どの分類かが見えるように見出しを留めておく */
	header {
		position: sticky;
		top: 24px;
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.g-icon {
		display: inline-flex;
		color: var(--color-primary);
	}

	h2 {
		font-size: 1.4rem;
		letter-spacing: 0.06em;
	}

	header p {
		font-size: 13.5px;
		color: var(--color-text-secondary);
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 24px;
		min-width: 0;
	}

	dl {
		margin: 0;
	}

	.row {
		display: grid;
		grid-template-columns: 10rem 1fr;
		gap: 24px;
		padding: 16px 0;
		border-bottom: 1px solid var(--color-border);
	}

	.row:first-child {
		padding-top: 0;
	}

	.row:last-child {
		border-bottom: none;
	}

	dt {
		font-weight: 600;
	}

	dd {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: 14px;
	}

	@media (max-width: 820px) {
		.group {
			grid-template-columns: 1fr;
			gap: 20px;
		}

		header {
			position: static;
		}

		.row {
			grid-template-columns: 1fr;
			gap: 4px;
		}
	}
</style>
