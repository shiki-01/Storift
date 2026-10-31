<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import Icon from '$lib/Icon.svelte';
	import EditorMock from '$lib/mock/EditorMock.svelte';
	import VerticalMock from '$lib/mock/VerticalMock.svelte';
	import MaterialsMock from '$lib/mock/MaterialsMock.svelte';
	import ClaudeMock from '$lib/mock/ClaudeMock.svelte';
	import { APP_URL, RELEASES_URL } from '$lib/config';

	const writing = [
		'章とシーンに分けて書き、30 秒ごとに自動で保存',
		'ルビ ｜漢字《かんじ》 と傍点 《《強調》》 の記法',
		'シーンごとの文字数と、一日の目標',
		'本文や資料をまとめて探せる検索と置換',
		'ら抜き言葉や長すぎる文を拾う校正'
	];

	const keep = [
		{
			icon: 'offline',
			title: 'オフラインで開ける',
			body: '一度読み込めば、通信がなくても起動します。原稿は端末の中に保存されます。'
		},
		{
			icon: 'sync',
			title: '自分の Firebase で同期',
			body: '複数の端末で書くときは、ご自身の Firebase プロジェクトを保管先にします。'
		},
		{
			icon: 'history',
			title: '版を残して戻せる',
			body: '書いた内容の履歴を残し、以前の状態へ戻せます。同期で上書きされる版も自動で控えます。'
		},
		{
			icon: 'export',
			title: '好きな形式で書き出す',
			body: 'TXT・Markdown・DOCX・PDF・EPUB・JSON。投稿サイトにも、印刷にも。'
		}
	] as const;
</script>

<Seo />

<section class="hero">
	<div class="wrap">
		<div class="hero-text">
			<h1>小説を書くための、<br />ひとつの場所。</h1>
			<p class="lead">
				<span class="line">原稿、プロット、人物、設定資料、進捗。</span><span class="line"
					>ばらばらになりがちな物語の材料を、作品ごとにひとつにまとめる執筆アプリです。</span
				>
			</p>
			<div class="cta">
				<a class="btn primary" href={APP_URL}>エディタを開く</a>
				<a class="btn secondary" href="/guide">使い方を見る</a>
			</div>
			<p class="note">ブラウザで動きます。インストールは不要です。</p>
		</div>
		<div class="hero-mock">
			<EditorMock />
		</div>
	</div>
</section>

<section class="block" id="write">
	<div class="wrap split">
		<div class="copy">
			<p class="num">01</p>
			<h2>書くことだけが、<br />画面に残るように。</h2>
			<p>
				執筆画面には、いま書いているシーンと、章の目次だけ。保存は自動で、ボタンを押すことを考えなくて済みます。日本語の小説に必要な記法は、そのまま本文に書けます。
			</p>
			<ul class="checks">
				{#each writing as w (w)}
					<li><Icon name="check" size={16} />{w}</li>
				{/each}
			</ul>
		</div>
		<div class="figure vertical-fig">
			<VerticalMock />
			<p class="caption">
				<Icon name="vertical" size={16} />書いた原稿は、縦書きや原稿用紙の体裁でも確かめられます。
			</p>
		</div>
	</div>
</section>

<section class="block" id="organize">
	<div class="wrap split reverse">
		<div class="copy">
			<p class="num">02</p>
			<h2>物語の材料は、<br />原稿のすぐ隣に。</h2>
			<p>
				筋書きはプロットに、登場人物は人物の頁と相関図に、世界のきまりごとは設定資料に。どれも作品ごとに保管され、執筆の途中でも左のレールからすぐ開けます。
			</p>
			<p>進捗の画面では、日ごとに書いた分量を記録し、目標までの距離を確かめられます。</p>
		</div>
		<div class="figure">
			<MaterialsMock />
		</div>
	</div>
</section>

<section class="block" id="keep">
	<div class="wrap">
		<div class="copy narrow">
			<p class="num">03</p>
			<h2>原稿は、手元に残る。</h2>
			<p>
				書いたものはまず端末の中に保存されます。どこに置くか、いつ書き出すかを、書き手が決められるようにしています。
			</p>
		</div>
		<ul class="keep">
			{#each keep as k (k.title)}
				<li>
					<span class="keep-icon"><Icon name={k.icon} /></span>
					<h3>{k.title}</h3>
					<p>{k.body}</p>
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="block" id="desktop">
	<div class="wrap split">
		<div class="copy">
			<p class="num">04<span class="badge">デスクトップ版</span></p>
			<h2>推敲の相談相手を、<br />画面の横に。</h2>
			<p>
				Windows・macOS・Linux 向けのデスクトップ版では、執筆画面の横に Claude Code
				のパネルを開けます。表記ゆれや設定の食い違いを作品全体から探したり、選んだ一文について相談したりできます。
			</p>
			<p>
				本文を書き換える案は差分で示され、反映するかどうかは一件ずつ自分で決めます。既定は「提案のみ」で、設定で選ばない限り原稿が書き換わることはありません。
			</p>
			<p class="small">
				利用には Claude Code のインストールとログインが必要です。使用量はご自身の Claude
				アカウントに計上されます。
			</p>
			<div class="cta">
				<a class="btn secondary" href={RELEASES_URL}>
					<Icon name="desktop" size={18} />デスクトップ版を入手
				</a>
			</div>
		</div>
		<div class="figure">
			<ClaudeMock />
		</div>
	</div>
</section>

<section class="closing">
	<div class="wrap closing-inner">
		<div class="cover" aria-hidden="true"><span>最初の一行</span></div>
		<div>
			<h2>まずは一作品、書きはじめる。</h2>
			<p>
				エディタを開き、作品の名前を決めれば準備は終わりです。迷ったときは<a href="/guide">使い方</a
				>と<a href="/faq">Q&amp;A</a>を見てください。
			</p>
			<div class="cta">
				<a class="btn primary" href={APP_URL}>エディタを開く</a>
				<a class="btn secondary" href="/features">機能の一覧</a>
			</div>
		</div>
	</div>
</section>

<style>
	/* ===== 冒頭 ===== */
	.hero {
		padding: 80px 0 40px;
	}

	.hero-text {
		max-width: 40rem;
	}

	h1 {
		font-family: var(--font-serif);
		font-size: clamp(2rem, 5.4vw, 3.4rem);
		line-height: 1.4;
		letter-spacing: 0.06em;
	}

	.lead .line {
		display: block;
	}

	.lead {
		margin-top: 24px;
		font-size: 16px;
		color: var(--color-text-secondary);
	}

	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 32px;
	}

	.note {
		margin-top: 14px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.hero-mock {
		margin-top: 56px;
	}

	/* ===== 各節 ===== */
	.block {
		padding: 96px 0;
		border-top: 1px solid var(--color-border);
	}

	.hero + .block {
		border-top: none;
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
		gap: 64px;
		align-items: center;
	}

	.split.reverse .copy {
		order: 2;
	}

	.copy {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.copy.narrow {
		max-width: 36rem;
	}

	.num {
		display: flex;
		align-items: center;
		gap: 12px;
		font-family: var(--font-serif);
		font-size: 13px;
		letter-spacing: 0.1em;
		color: var(--color-accent);
	}

	.badge {
		padding: 1px 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 11.5px;
		letter-spacing: 0.04em;
		color: var(--color-text-secondary);
	}

	h2 {
		font-family: var(--font-serif);
		font-size: clamp(1.5rem, 3.2vw, 2rem);
		letter-spacing: 0.05em;
		margin-bottom: 4px;
	}

	.copy > p:not(.num) {
		color: var(--color-text-secondary);
	}

	.copy .small {
		font-size: 13px;
	}

	.checks {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 8px;
		font-size: 14px;
	}

	.checks li {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.checks li :global(svg) {
		flex: none;
		position: relative;
		top: 3px;
		color: var(--color-success);
	}

	.figure {
		min-width: 0;
	}

	.vertical-fig {
		max-width: 26rem;
		justify-self: center;
		width: 100%;
	}

	.caption {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 16px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.caption :global(svg) {
		flex: none;
	}

	/* 03: 手元に残る */
	.keep {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		margin-top: 48px;
		border-top: 1px solid var(--color-border);
	}

	.keep li {
		padding: 28px 24px 8px 0;
	}

	.keep li + li {
		padding-left: 24px;
		border-left: 1px solid var(--color-border);
	}

	.keep-icon {
		display: inline-flex;
		color: var(--color-primary);
	}

	.keep h3 {
		margin-top: 12px;
		font-size: 15px;
	}

	.keep p {
		margin-top: 6px;
		font-size: 13.5px;
		color: var(--color-text-secondary);
	}

	/* ===== 締め ===== */
	.closing {
		padding: 96px 0 0;
		border-top: 1px solid var(--color-border);
	}

	.closing-inner {
		display: flex;
		align-items: center;
		gap: 56px;
	}

	.closing h2 {
		margin-bottom: 12px;
	}

	.closing p {
		color: var(--color-text-secondary);
	}

	/* アプリのホームに並ぶ作品の表紙と同じ形 */
	.cover {
		position: relative;
		flex: none;
		display: flex;
		justify-content: center;
		width: 150px;
		aspect-ratio: 3 / 4;
		padding: 20px 14px 14px 22px;
		border: 1px solid var(--color-border);
		border-radius: 4px 8px 8px 4px;
		background: var(--editor-background);
		box-shadow: var(--shadow-float);
	}

	.cover::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 6px;
		background: var(--color-primary);
	}

	.cover span {
		writing-mode: vertical-rl;
		font-family: var(--font-serif);
		font-size: 18px;
		font-weight: 600;
		letter-spacing: 0.14em;
	}

	@media (max-width: 900px) {
		.split {
			grid-template-columns: 1fr;
			gap: 40px;
		}

		.split.reverse .copy {
			order: 0;
		}

		.keep {
			grid-template-columns: 1fr 1fr;
		}

		.keep li:nth-child(3) {
			padding-left: 0;
			border-left: none;
		}

		.keep li:nth-child(n + 3) {
			border-top: 1px solid var(--color-border);
		}
	}

	@media (max-width: 640px) {
		.hero {
			padding: 48px 0 24px;
		}

		.lead .line {
			display: inline;
		}

		.hero-mock {
			margin-top: 40px;
		}

		.block {
			padding: 64px 0;
		}

		.keep {
			grid-template-columns: 1fr;
		}

		.keep li,
		.keep li + li {
			padding: 20px 0;
			border-left: none;
		}

		.keep li + li {
			border-top: 1px solid var(--color-border);
		}

		.closing {
			padding-top: 64px;
		}

		.closing-inner {
			flex-direction: column;
			align-items: flex-start;
			gap: 32px;
		}

		.cover {
			width: 110px;
		}
	}
</style>
