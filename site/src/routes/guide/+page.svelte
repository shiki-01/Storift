<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import Shot from '$lib/Shot.svelte';
	import { APP_URL, RELEASES_URL } from '$lib/config';

	const steps = [
		{
			title: 'エディタを開く',
			body: 'サイトの「エディタを開く」から、ブラウザでアプリが開きます。Chrome・Edge・Safari・Firefox の最新版で動きます。',
			tip: 'スマートフォンでは、共有メニューの「ホーム画面に追加」でアプリのように起動できます。'
		},
		{
			title: '同期を設定する(任意)',
			body: '初めて開くと「Firebase初期設定(任意)」の画面が出ます。複数の端末で書くときは、Firebase Console でプロジェクトを作り、表示された設定をそのまま貼り付けて「設定を読み込む」を押します。1 台だけで使うなら「設定せずに始める」で進めます。',
			tip: '同期は、あとから設定の「同期」でも設定できます。2 台目以降は、1 台目で表示した「設定コード」を貼り付けます。',
			link: { href: '/guide/firebase', label: 'Firebase 設定ガイドを見る' }
		},
		{
			title: '作品を作る',
			body: '作品一覧の「＋ 新しい作品」から、作品の名前を入れて作ります。作品ごとに、原稿・プロット・人物・設定資料・進捗がひとまとまりになります。'
		},
		{
			title: '書く',
			body: '章とシーンを作って書き進めます。内容は自動で保存されます。ルビは ｜漢字《かんじ》、傍点は 《《強調》》 と書きます。',
			tip: '縦書きでの見え方は、執筆画面の上部で「二画面表示」に切り替えると、隣のプレビューで確かめられます。'
		},
		{
			title: '材料を書き留める',
			body: '左のレールから、プロット・人物・設定資料を開いて書き留めます。一覧で項目を選ぶと、詳細に全文が出ます。進捗の画面では、その日に書いた量を「今日の記録」から残せます。'
		},
		{
			title: '書き出して控えておく',
			body: '作品は TXT・Markdown・DOCX・PDF・EPUB・JSON で書き出せます。ブラウザのデータを消すと端末内の作品も消えるため、大事な作品はときどき書き出しておいてください。'
		}
	];
	const tips = [
		{
			title: '材料を読む・探す',
			body: 'プロット・人物・設定資料は、一覧で項目を選ぶと詳細に全文が出ます。「編集」を押さなくても読めます。人物と設定資料は検索ができ、設定資料は分類のチップ(用語・場所・年表・その他)とタグでも絞り込めます。'
		},
		{
			title: '並べ替える',
			body: '項目の左の取っ手(⠿)をドラッグします。キーボードでは、取っ手で Space を押して持ち上げ、矢印キーで動かし、Space で置きます。項目の「…」メニューの「上へ」「下へ」でも動かせます。プロットは、カードを別の列へ運ぶと状態も変わります。並び順を「手動順」にし、絞り込みを外しているときに使えます。'
		},
		{
			title: '通しで読む',
			body: '左のレールの「通読」で、作品全体を章をまたいで読めます。上部で「横」「縦」を切り替え、「Aa」で文字の大きさなどを変えられます。気になった場面は、鉛筆のボタンからエディタで開けます。'
		},
		{
			title: '共有して、いっしょに書く',
			body: '作品一覧で、作品の「…」メニュー(右クリックでも開けます)から「共有...」を開き、「共有を開始」を押します。「招待リンクを作成」で、閲覧か編集の権限のリンクを相手に渡します。相手は作品一覧の「共有リンクから参加」へ貼り付けます。共有には、ご自身の Firebase に新しいセキュリティルールを適用する必要があります。',
			link: { href: '/guide/firebase', label: 'ルールと設定コードの手順は Firebase 設定ガイドへ' }
		}
	];

	const settings = [
		['外観', '配色(和紙・墨・古書・夜)を選び、自分の配色も作れます。'],
		['エディタ', '自動保存、本文の書式、ショートカット、通知。'],
		['同期', 'Firebase を使った同期と、競合の扱い。'],
		['共有', '表示名、他の人のカーソル、設定コード、接続の診断。'],
		['AI', 'デスクトップ版のみ。プロバイダと、本文の編集の扱い。'],
		['データ', 'バックアップ(エクスポート/インポート)と、データの削除。'],
		['このアプリについて', 'バージョン、アップデート、チュートリアル。']
	] as const;
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

	<section class="tips">
		<h2>慣れてきたら</h2>
		<dl>
			{#each tips as t (t.title)}
				<div>
					<dt>{t.title}</dt>
					<dd>
						{t.body}
						{#if t.link}<a href={t.link.href}>{t.link.label}</a>{/if}
					</dd>
				</div>
			{/each}
		</dl>
	</section>

	<section class="settings">
		<h2>設定の見かた</h2>
		<p>左のレールの「設定」を開くと、次の項目が左に並びます。</p>
		<div class="settings-body">
			<dl>
				{#each settings as [name, text] (name)}
					<div>
						<dt>{name}</dt>
						<dd>{text}</dd>
					</div>
				{/each}
			</dl>
			<Shot
				name="settings"
				alt="設定画面。左に外観・エディタ・同期・共有・データ・このアプリについての項目が並び、右に配色の見本が出ている"
			/>
		</div>
	</section>

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
			AI のパネルは、設定の「AI」でプロバイダを選んで使います。Claude Code を選ぶ場合は、Claude Code
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

	.tips,
	.settings {
		max-width: 60rem;
		margin-top: 64px;
	}

	.tips h2,
	.settings h2 {
		font-size: 1.2rem;
		margin-bottom: 12px;
	}

	.tips dl {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		margin: 0;
	}

	.tips dl > div {
		padding: 18px 20px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-surface);
	}

	.tips dt {
		font-weight: 600;
	}

	.tips dd {
		margin: 6px 0 0;
		color: var(--color-text-secondary);
		font-size: 14px;
	}

	.settings > p {
		margin-bottom: 16px;
		color: var(--color-text-secondary);
		font-size: 14px;
	}

	.settings-body {
		display: grid;
		grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
		gap: 24px;
		align-items: start;
	}

	.settings-body dl {
		margin: 0;
		font-size: 14px;
	}

	.settings-body dl > div {
		padding: 8px 0;
		border-bottom: 1px solid var(--color-border);
	}

	.settings-body dt {
		font-weight: 600;
	}

	.settings-body dd {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: 13.5px;
	}

	@media (max-width: 760px) {
		.tips dl,
		.settings-body {
			grid-template-columns: minmax(0, 1fr);
		}
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
