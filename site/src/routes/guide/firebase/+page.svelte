<script lang="ts">
	import { accordion } from '$lib/accordion';
	import Seo from '$lib/Seo.svelte';
	import { APP_URL } from '$lib/config';

	// リポジトリ直下の firestore.rules と同じ内容(Console に貼り付ける用)
	const rulesText = `rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // 同期に使うコレクションだけを、認証済みユーザー(匿名認証を含む)に許可する。
    // ユーザーごとの分離はしない。同じ Firebase 設定を読み込んだ端末が同じデータを共有する。
    match /{collection}/{document=**} {
      allow read, write: if request.auth != null
        && collection in ['projects', 'chapters', 'scenes', 'characters', 'plots', 'worldbuilding'];
    }
    // 上記以外は拒否される(既定)
  }
}
`;

	const steps = [
		{
			title: 'Firebase プロジェクトを作る',
			body: 'Firebase コンソール(https://console.firebase.google.com/)を開き、Google アカウントでログインします。「プロジェクトを作成」を押し、プロジェクト名を入力します。画面の案内に従って「続行」を押し、最後に「プロジェクトを作成」を押します。',
			tip: 'Storift は Google アナリティクスを使いません。アナリティクスの設定はオフのままで構いません。'
		},
		{
			title: '匿名ログインを有効にする',
			body: '左のメニューから「構築」の「Authentication」を開き、「始める」を押します。「ログイン方法」タブで「匿名」を選び、「有効にする」をオンにして「保存」を押します。',
			tip: 'Storift は利用者にアカウントの登録を求めません。端末ごとに匿名のユーザーとして Firebase に接続します。'
		},
		{
			title: '承認済みドメインを追加する',
			body: 'Authentication の「設定」タブを開き、「承認済みドメイン」に Storift を開くドメインを追加します。Storift の Web 版は app.storift.shiki-01.com で配信しているため、このドメインを追加します。',
			tip: 'デスクトップ版で認証が通らない場合は、同じ一覧に tauri.localhost を追加します。'
		},
		{
			title: 'Firestore Database を作る',
			body: '左のメニューから「構築」の「Firestore Database」を開き、「データベースを作成」を押します。ロケーションは「asia-northeast1(東京)」を選びます。ロケーションは作成後に変更できません。セキュリティルールは「本番環境モード」で開始を選び、「作成」を押します。',
			tip: '日本から使う場合は、東京リージョンを選ぶと応答が速くなります。'
		},
		{
			title: 'セキュリティルールを貼り付けて公開する',
			body: 'Firestore Database の「ルール」タブを開きます。エディタの既存の内容をすべて消して、下の内容を貼り付け、「公開」を押します。',
			rules: true
		},
		{
			title: 'ウェブアプリを登録して設定値を取得する',
			body: 'プロジェクトの概要の横にある歯車アイコンから「プロジェクトの設定」を開き、「全般」タブの「マイアプリ」で「ウェブ」(</> の形のアイコン)を押します。アプリのニックネームを入力して「アプリを登録」を押します。Firebase Hosting の設定は不要です。',
			tip: '画面に表示される firebaseConfig の内容(apiKey、authDomain、projectId、storageBucket、messagingSenderId、appId の 6 項目)を控えます。後から見る場合は、「プロジェクトの設定」の「全般」タブで「SDK の設定と構成」を開きます。'
		},
		{
			title: 'Storift の設定画面に値を入力する',
			body: 'Storift を開くと、初回に「Firebase初期設定(任意)」の画面が出ます。上部の「設定を一括入力」の欄に、表示された firebaseConfig の内容をそのまま貼り付けて「設定を読み込む」を押します。6 つの入力欄に値が入ります。「接続テスト」を押して「接続成功」と表示されたら、「保存して開始」を押します。',
			tip: '設定画面の同期欄に「Firebase連携が設定されていません」と出る場合は、同じ欄にある「Firebase設定ページへ」から、この画面を開けます。入力欄は、API Key・Auth Domain・Project ID・Storage Bucket・Messaging Sender ID・App ID の 6 つです。'
		},
		{
			title: '動作を確認する',
			body: '設定画面の「同期」欄で、「クラウド同期を有効にする」にチェックが入っていることを確かめます。状態の表示が「同期済み」になれば、接続は完了です。',
			tip: 'プロジェクトを作って、少し待ってから Firebase コンソールの「Firestore Database」の「データ」タブを開くと、保存された内容を確かめられます。'
		},
		{
			title: '2 台目の端末でも同じ値を入力する',
			body: '別の端末や別のブラウザで Storift を開き、手順 7 と同じように同じ 6 つの値を入力します。両方の端末で同じ作品が表示されれば、同期は成功です。',
			tip: 'データは端末とブラウザごとに保存されるため、ブラウザを変えたときも同じ値を入力します。'
		}
	];

	const troubles = [
		{
			q: '「Missing or insufficient permissions」と表示される',
			a: 'セキュリティルールが公開されていないか、匿名ログインが有効になっていません。手順 2 と手順 5 を確かめてください。ルールは「公開」を押すまで反映されません。'
		},
		{
			q: '接続テストや保存に失敗する',
			a: '匿名ログインが無効のままだと、接続や保存は失敗します。手順 2 を確かめてください。承認済みドメインに Storift を開いているドメインが無い場合も、手順 3 の追加を確かめてください。'
		},
		{
			q: '同期されない',
			a: '両方の端末で 6 つの値が同じかを確かめます。インターネットに接続されているか、設定画面の「同期」欄の表示を確かめます。それでも解決しないときは、ブラウザの開発者ツール(F12 キー)の「Console」タブに出ているエラーを確かめてください。'
		},
		{
			q: '無料枠の上限に達した',
			a: '無料枠(Spark プラン)を超えると、課金されず、上限に達した時点で読み書きが一時的に止まります。上限は日ごとに決まっており、翌日には再び使えます。利用量は Firebase コンソールの「使用量と請求」で確かめられます。作品のデータ量が多いほど、読み取り回数は増えます。'
		}
	];
</script>

<Seo
	title="Firebase 設定ガイド"
	description="Storift の作品を端末間で同期するための Firebase の設定手順。プロジェクトの作成、匿名ログイン、セキュリティルール、設定値の入力、トラブル時の対処。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">使い方</p>
		<h1>Firebase 同期の設定</h1>
		<p>
			複数の端末で作品を同じ状態に保つための、Firebase
			の設定手順です。知識がなくても、この順に進めれば設定できる内容にしています。
		</p>
	</div>

	<section class="intro">
		<h2>Firebase と Storift</h2>
		<p>
			Firebase は、Google
			が提供するクラウドサービスです。データの保存やログインの仕組みを、自分のプロジェクトとして用意できます。
		</p>
		<p>
			Storift は、Firebase を<strong>作品データの端末間同期のためだけ</strong
			>に使います。同期は任意です。設定しなくても、執筆・整理・書き出しを含むすべての機能を使えます。作品は、設定しない場合もこの端末に保存されます。
		</p>
	</section>

	<aside class="caution" aria-labelledby="caution-title">
		<h2 id="caution-title">設定の前に確認してください</h2>
		<ul>
			<li>
				Firebase プロジェクトは、ご自身の Google
				アカウントで作成し、ご自身で管理します。設定と運用は自己責任になります。
			</li>
			<li>
				Storift の運営者は、利用者の作品データにアクセスしません。データはご自身の Firebase
				プロジェクトにだけ保存されるため、運営者が受け取ったり閲覧したりする仕組みはありません。
			</li>
			<li>
				Firebase の設定値(apiKey
				など)は秘密鍵ではありません。一方で、セキュリティルールを正しく設定しないと、第三者に読み書きされるおそれがあります。
			</li>
			<li>
				このガイドのルールでは、<strong
					>設定値を知っていれば誰でも匿名でログインでき、同じデータに読み書きできます</strong
				>。ユーザーごとの分離はしていません。設定値は他人に共有しないでください。同じ設定値を読み込んだ端末どうしで、作品を共有します。
			</li>
			<li>
				無料枠(Spark
				プラン)を超えても課金されません。上限に達すると、読み書きが一時的に止まります。Blaze
				プランに切り替えると、利用量に応じて課金が発生するおそれがあります。
			</li>
			<li>
				不要になったら Firebase
				プロジェクトを削除してください。プロジェクトを削除すると、保存されたデータも消えます。
			</li>
		</ul>
	</aside>

	<section class="free">
		<h2>無料枠の目安</h2>
		<p>Firestore の無料枠(Spark プラン)の主な上限は、次のとおりです。</p>
		<ul class="list">
			<li>読み取り: 50,000 回/日</li>
			<li>書き込み: 20,000 回/日</li>
			<li>削除: 20,000 回/日</li>
			<li>ストレージ: 1 GB</li>
			<li>ネットワーク: 10 GB/月</li>
		</ul>
		<p>
			一人で数百の章やシーンを扱う程度であれば、無料枠の範囲で収まる見積もりです。ただし、作品数が増えると読み取り回数も増えます。
		</p>
	</section>

	<section class="setup">
		<h2>設定の手順</h2>
		<p class="note">
			Firebase コンソールの画面の名称や配置は、Firebase
			の更新により変わることがあります。その場合は、近い名称の項目を探してください。
		</p>
		<ol class="steps">
			{#each steps as s, i (s.title)}
				<li>
					<span class="num" aria-hidden="true">{i + 1}</span>
					<div class="body">
						<h3>{s.title}</h3>
						<p>{s.body}</p>
						{#if s.rules}
							<pre class="code"><code>{rulesText}</code></pre>
						{/if}
						{#if s.tip}
							<p class="tip">{s.tip}</p>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	</section>

	<section class="trouble">
		<h2>よくあるトラブル</h2>
		<div class="list-qa">
			{#each troubles as t (t.q)}
				<details use:accordion>
					<summary>
						<span class="q">{t.q}</span>
						<span class="mark" aria-hidden="true"></span>
					</summary>
					<p>{t.a}</p>
				</details>
			{/each}
		</div>
	</section>

	<section class="stop">
		<h2>同期をやめる</h2>
		<ol class="plain">
			<li>
				Storift
				の設定画面を開き、「同期」欄の「クラウド同期を有効にする」のチェックを外します。以後、作品はこの端末だけに保存されます。
			</li>
			<li>
				Firebase 上に保存されたデータは残ります。データも消す場合は、Firebase
				コンソールの「プロジェクトの設定」からプロジェクトを削除します。
			</li>
		</ol>
		<p>
			設定画面の「全データを削除」は、この端末の作品を消す操作です。Firebase
			上のデータは消えません。
		</p>
	</section>

	<div class="next">
		<p>作品の書き方や設定の全体は、使い方のページで確かめられます。</p>
		<a class="btn secondary" href="/guide">使い方を見る</a>
		<a class="btn primary" href={APP_URL}>エディタを開く</a>
	</div>
</div>

<style>
	h2 {
		font-size: 1.25rem;
		letter-spacing: 0.04em;
		margin-bottom: 14px;
	}

	section {
		max-width: 46rem;
		margin-bottom: 56px;
	}

	section p {
		color: var(--color-text-secondary);
		font-size: 14.5px;
	}

	section p + p {
		margin-top: 12px;
	}

	.intro p + p {
		margin-top: 12px;
	}

	.caution {
		max-width: 46rem;
		margin-bottom: 56px;
		padding: 28px;
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--color-accent);
		border-radius: 10px;
		background: var(--editor-background);
	}

	.caution h2 {
		color: var(--color-accent);
	}

	.caution ul {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-left: 1.3em;
		list-style: disc;
		font-size: 14.5px;
	}

	.caution li {
		color: var(--color-text);
	}

	.list {
		margin: 12px 0;
		padding-left: 1.3em;
		list-style: disc;
		color: var(--color-text-secondary);
		font-size: 14.5px;
	}

	.note {
		margin-bottom: 24px;
		padding: 10px 14px;
		border-left: 2px solid var(--color-primary);
		background: var(--editor-background);
		font-size: 13.5px !important;
	}

	/* 手順 */
	.steps {
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.steps::before {
		content: '';
		position: absolute;
		top: 16px;
		bottom: 16px;
		left: 15px;
		width: 1px;
		background: var(--color-border);
	}

	.steps li {
		position: relative;
		display: flex;
		gap: 24px;
		padding-bottom: 36px;
	}

	.steps li:last-child {
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
		min-width: 0;
		padding-top: 3px;
	}

	.body h3 {
		font-size: 16.5px;
		margin-bottom: 6px;
	}

	.body > p {
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

	.code {
		margin: 14px 0 0;
		padding: 16px;
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--editor-background);
		font-size: 12.5px;
		line-height: 1.6;
	}

	.code code {
		padding: 0;
		border: none;
		background: none;
		font-size: inherit;
	}

	/* トラブル(Q&A と同じ開閉の見た目) */
	.list-qa details {
		border-bottom: 1px solid var(--color-border);
	}

	.list-qa details:first-child summary {
		padding-top: 0;
	}

	.list-qa summary {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 16px 0;
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}

	.list-qa summary::-webkit-details-marker {
		display: none;
	}

	.list-qa .q {
		flex: 1;
	}

	.list-qa .mark {
		position: relative;
		flex: none;
		width: 12px;
		height: 12px;
		color: var(--color-text-secondary);
	}

	.list-qa .mark::before,
	.list-qa .mark::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		width: 12px;
		height: 1.5px;
		margin-top: -0.75px;
		border-radius: 1px;
		background: currentColor;
		transition: transform 0.2s;
	}

	.list-qa .mark::after {
		transform: rotate(90deg);
	}

	.list-qa details[open] .mark::after {
		transform: rotate(0deg);
	}

	.list-qa details p {
		padding: 0 28px 18px 0;
		font-size: 14.5px;
	}

	/* 同期をやめる */
	.plain {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-left: 1.5em;
		list-style: decimal;
	}

	.plain li {
		color: var(--color-text);
		font-size: 14.5px;
	}

	.stop > p {
		margin-top: 16px;
	}

	@media (max-width: 640px) {
		.caution {
			padding: 20px;
		}

		.steps::before {
			left: 15px;
		}

		.steps li {
			gap: 16px;
		}
	}
</style>
