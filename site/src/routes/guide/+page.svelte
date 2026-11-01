<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL, RELEASES_URL } from '$lib/config';

	const steps = [
		{
			title: 'エディタを開く',
			body: 'サイト右上の「エディタを開く」から、ブラウザでアプリが開きます。Chrome・Edge・Safari・Firefox の最新版で動きます。',
			tip: 'スマートフォンでは、共有メニューの「ホーム画面に追加」でアプリのように起動できます。'
		},
		{
			title: '同期の設定をする(初回のみ)',
			body: '初めて開くと Firebase の設定画面が出ます。Firebase Console でプロジェクトを作り、表示された設定をそのまま貼り付けて「設定を読み込む」を押します。',
			tip: '設定は一度だけです。同じ設定をほかの端末でも読み込むと、作品が同期されます。',
			link: { href: '/guide/firebase', label: 'Firebase 設定ガイドを見る' }
		},
		{
			title: '作品を作る',
			body: 'ホーム画面の「新しい作品」から、作品の名前を入れて作ります。作品ごとに、原稿・プロット・人物・設定資料・進捗がひとまとまりになります。'
		},
		{
			title: '書く',
			body: '章とシーンを作って書き進めます。内容は自動で保存されます。ルビは ｜漢字《かんじ》、傍点は 《《強調》》 と書きます。',
			tip: '縦書きでの見え方は、執筆画面のプレビューで確かめられます。'
		},
		{
			title: '材料を書き留める',
			body: '左のレールから、プロット・人物・設定資料を開いて書き留めます。進捗の画面では、その日に書いた量を記録できます。'
		},
		{
			title: '書き出して控えておく',
			body: '作品は TXT・Markdown・DOCX・PDF・EPUB・JSON で書き出せます。ブラウザのデータを消すと端末内の作品も消えるため、大事な作品はときどき書き出しておいてください。'
		}
	];
</script>

<Seo
	title="使い方"
	description="Storift の始め方。エディタを開いて、作品を作り、書き、書き出すまでの手順。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">使い方</p>
		<h1>はじめの六歩。</h1>
		<p>エディタを開いてから、一作品を書き出すまでの流れです。</p>
	</div>

	<ol class="steps">
		{#each steps as s, i (s.title)}
			<li>
				<span class="num" aria-hidden="true">{i + 1}</span>
				<div class="body">
					<h2>{s.title}</h2>
					<p>{s.body}</p>
					{#if s.tip}
						<p class="tip">{s.tip}</p>
					{/if}
					{#if s.link}
						<p class="more"><a href={s.link.href}>{s.link.label}</a></p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>

	<section class="desktop">
		<h2>デスクトップ版を使う場合</h2>
		<p>
			<a href={RELEASES_URL}>配布ページ</a>から、お使いの OS
			向けのファイル(.dmg・.msi・.exe・.deb・.rpm・.AppImage)を入手してインストールします。署名をしていないため、初回は次の操作が必要です。
		</p>
		<dl>
			<dt>macOS</dt>
			<dd>
				Finder
				でアプリを右クリックして「開く」を選びます。「壊れている」と表示される場合は、ターミナルで
				<code>xattr -dr com.apple.quarantine /Applications/Storift.app</code> を実行します。
			</dd>
			<dt>Windows</dt>
			<dd>SmartScreen の警告が出たら「詳細情報」から「実行」を選びます。</dd>
		</dl>
		<p>
			Claude Code のパネルを使うには、Claude Code
			をインストールしてログインしておきます。ログインしていないときは、パネルにログインの案内が出ます。
		</p>
	</section>

	<div class="next">
		<p>困ったときは Q&amp;A を。</p>
		<a class="btn secondary" href="/faq">Q&amp;A を見る</a>
		<a class="btn primary" href={APP_URL}>エディタを開く</a>
	</div>
</div>

<style>
	.steps {
		position: relative;
		display: flex;
		flex-direction: column;
		max-width: 44rem;
	}

	/* 番号を縦につなぐ細い線 */
	.steps::before {
		content: '';
		position: absolute;
		top: 16px;
		bottom: 16px;
		left: 15px;
		width: 1px;
		background: var(--color-border);
	}

	li {
		position: relative;
		display: flex;
		gap: 24px;
		padding-bottom: 36px;
	}

	li:last-child {
		padding-bottom: 0;
	}

	.num {
		flex: none;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-background);
		font-family: var(--font-serif);
		font-size: 14px;
		color: var(--color-primary);
	}

	.body {
		padding-top: 3px;
	}

	h2 {
		font-size: 17px;
		margin-bottom: 6px;
	}

	.body p {
		color: var(--color-text-secondary);
		font-size: 14.5px;
	}

	.tip {
		margin-top: 10px;
		padding: 10px 14px;
		border-left: 2px solid var(--color-primary);
		background: var(--editor-background);
		font-size: 13.5px !important;
	}

	.more {
		margin-top: 10px;
		font-size: 14px !important;
	}

	.desktop {
		max-width: 44rem;
		margin-top: 64px;
		padding: 28px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--editor-background);
	}

	.desktop h2 {
		font-family: var(--font-serif);
		font-size: 1.2rem;
		margin-bottom: 12px;
	}

	.desktop p {
		color: var(--color-text-secondary);
		font-size: 14px;
	}

	.desktop dl {
		display: grid;
		grid-template-columns: 6rem 1fr;
		gap: 10px 16px;
		margin: 16px 0;
		font-size: 14px;
	}

	.desktop dt {
		font-weight: 600;
	}

	.desktop dd {
		margin: 0;
		color: var(--color-text-secondary);
	}

	.desktop code {
		word-break: break-all;
	}

	@media (max-width: 640px) {
		.desktop {
			padding: 20px;
		}

		.desktop dl {
			grid-template-columns: 1fr;
			gap: 2px;
		}

		.desktop dd + dt {
			margin-top: 10px;
		}
	}
</style>
