<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import Icon from '$lib/Icon.svelte';
	import Shot from '$lib/Shot.svelte';
	import type { IconName } from '$lib/icons';
	import { APP_URL } from '$lib/config';

	type Item = { title: string; body: string; desktop?: boolean };
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
			shot: { name: 'editor', alt: '執筆画面。左に章とシーンの一覧、右に本文が並ぶ' },
			items: [
				{
					title: '章とシーン',
					body: '作品を章とシーンに分け、並べ替えながら書き進めます。シーンごとに文字数が出ます。'
				},
				{
					title: '自動保存',
					body: '30 秒ごとに保存します。保存の間隔は設定で変えられます。'
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
				}
			]
		},
		{
			id: 'organize',
			icon: 'plot',
			title: '整理する',
			lead: '物語の材料を、作品ごとに原稿の隣に置いておけます。',
			shot: {
				name: 'relation',
				alt: '人物の相関図。登場人物が線で結ばれ、線に関係の名前が付いている'
			},
			items: [
				{
					title: 'プロット',
					body: '物語の流れを項目に分けて並べます。書く前の設計にも、書きながらの見直しにも使えます。'
				},
				{
					title: '人物と相関図',
					body: '登場人物の情報を一人ずつまとめ、人物同士のつながりを相関図で整理できます。矢印は片方向・双方向・お互い別(それぞれが相手へ向く 2 本)から選べます。'
				},
				{
					title: 'メモ',
					body: '思いついたことを、執筆画面の横にすぐ書き留めておけます。本文の一部を選んでその箇所に紐づけたり、タグで分けたり、あとからプロットにまとめ直したりできます。'
				},
				{
					title: '設定資料',
					body: '世界観、地名、用語などのきまりごとをまとめておく場所です。'
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
			shot: { name: 'split', alt: '本文の隣に縦書きのプレビューを開いた執筆画面' },
			items: [
				{
					title: '縦書きプレビュー',
					body: '原稿を縦書きで表示します。ルビや傍点もそのまま反映されます。'
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
			id: 'desktop',
			icon: 'ai',
			title: 'デスクトップ版',
			lead: 'Windows・macOS・Linux 向けのアプリです。Web 版の機能に加えて、次のものが使えます。',
			items: [
				{
					title: 'AI のパネル',
					body: '執筆画面の横で AI に相談できます。Claude Code・Ollama・OpenAI 互換 API から選べます。作品ごとに会話が分かれ、全作品を横断した確認もできます。',
					desktop: true
				},
				{
					title: '選んだ文から質問',
					body: '本文を選ぶと「AI に聞く」「校正」「書き換え」が出ます。選んだ部分に絞って相談できます。',
					desktop: true
				},
				{
					title: '差分で確かめて反映',
					body: '書き換えの案は文字単位の差分で本文の上に示され、一件ずつ反映・却下できます。反映後も元に戻せます。',
					desktop: true
				}
			]
		}
	];
</script>

<Seo
	title="機能"
	description="Storift の機能一覧。執筆、プロット、人物と相関図、設定資料、進捗、縦書きプレビュー、オフライン、同期、書き出し、デスクトップ版の Claude Code パネル。"
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
							<dd>{item.body}</dd>
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
