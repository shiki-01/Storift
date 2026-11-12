<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL } from '$lib/config';

	const ISSUES_URL = 'https://github.com/shiki-01/Storift/issues';
</script>

<Seo
	title="プライバシーポリシー"
	description="Storift の個人情報と作品データの扱い。作品は端末内、または利用者ご自身の Firebase に保存され、運営者は受け取りません。拡張機能が扱う情報は、各拡張機能のページに記載します。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">規約</p>
		<h1>プライバシーポリシー</h1>
		<p>制定日: 2026年11月1日 ／ 改定日: 2026年11月12日</p>
	</div>

	<div class="doc">
		<section>
			<h2>1. 基本的な考え方</h2>
			<p>
				Storift は、個人が開発するオープンソースソフトウェアです(MIT ライセンス)。Storift
				には、利用者のアカウントを登録する仕組みも、利用者の原稿を受け取るサーバーもありません。
			</p>
		</section>

		<section>
			<h2>2. 作品データの保存先</h2>
			<ul>
				<li>
					作品データ(原稿・プロット・人物・設定資料・進捗など)は、ご利用の端末に保存されます。Web
					版はブラウザ内(IndexedDB)、デスクトップ版はアプリのデータ領域です。
				</li>
				<li>
					同期を設定した場合、作品データは<strong>利用者ご自身の Firebase プロジェクト</strong
					>に送られ、Firebase(Google)のサーバーに保存されます。運営者はこのデータを受け取らず、閲覧もできません。
				</li>
				<li>
					同期では、Firebase の匿名認証によって、端末ごとに匿名のユーザー ID
					が発行されます。氏名やメールアドレスは求めません。
				</li>
				<li>Firebase の設定値(apiKey など)は、利用者が入力したうえで、端末内に保存されます。</li>
				<li>
					共有・共同編集を使う場合、作品を共有すると、その作品のデータは、<strong
						>共有した人(ホスト)の Firebase プロジェクト</strong
					>に置かれます。招待リンクには、ホストの Firebase の設定値(apiKey など)と、作品の
					ID、権限が入ります。リンクを知っている人は、誰でも参加できます。招待された人(ゲスト)が編集した内容や、参加中の表示名・カーソルの位置も、ホストの
					Firebase に保存されます。ゲスト自身の Firebase
					には、保存も同期もされません。運営者はこのデータを受け取らず、閲覧もできません。
				</li>
				<li>
					2 台目以降の端末をつなぐための「設定コード」には、Firebase
					の設定値とオーナー鍵が入っています。持っている人は全データにアクセスできるため、共有には使わないでください。
				</li>
			</ul>
		</section>

		<section>
			<h2>3. デスクトップ版の AI 連携</h2>
			<p>
				デスクトップ版の AI
				パネルは、利用者が設定で選んだプロバイダ(利用者の端末にインストールされた Claude
				Code、端末内の Ollama、または利用者が設定した OpenAI 互換 API・Anthropic API・Gemini
				のサービス)を呼び出します。次の内容が扱われます。
			</p>
			<ul>
				<li>
					パネルで質問を送信すると、入力した文章が、選んだプロバイダに送られます。作品の本文や設定資料などは、AI
					がアプリのツールで読んだ分だけが、そのプロバイダに送られます。作品全体のファイルを書き出したり、まとめて送ったりはしません。未保存の本文は、読まれた時点の内容になります。
				</li>
				<li>
					Claude Code を選んだ場合、Claude Code
					は、アプリが用意した空の作業フォルダで動きます。作品のファイルは読みません。読んだ作品の内容は、利用者ご自身の
					Claude アカウントを使って、Anthropic のサービスで処理されます。Anthropic
					に送られた内容の扱いは、Anthropic の規約とプライバシーポリシーに従います。
				</li>
				<li>
					OpenAI 互換 API を選んだ場合、質問と、AI
					がツールで読んだ原稿・設定資料などの一部が、利用者が設定した Base URL
					のサービスに送られます。送られた内容の扱いは、そのサービスの規約とプライバシーポリシーに従います。Ollama
					を選んだ場合は、設定した接続先(通常は端末内)に送られます。
				</li>
				<li>
					Anthropic API を選んだ場合は Anthropic(api.anthropic.com)に、Gemini を選んだ場合は
					Google(generativelanguage.googleapis.com)に、質問と、AI
					がツールで読んだ原稿・設定資料などの一部が送られます。Base URL を変更した場合は、設定した
					URL
					のサービスに送られます。送られた内容の扱いは、各サービスの規約とプライバシーポリシーに従います。
				</li>
				<li>
					API キーは、macOS・Windows では OS
					のキーチェーンに保存されます。キーチェーンを使えない環境では、端末内に平文で保存されます。キーは設定したサービスにだけ送られ、運営者や他のサーバーへは送信されません。
				</li>
				<li>「Web 検索を許可する」を有効にすると、Claude Code は Web 検索を使うことがあります。</li>
				<li>
					パネルで送信しない限り、作品データが AI に渡されることはありません。Storift
					自体は、これらの内容を運営者や外部のサーバーへ送信しません。
				</li>
			</ul>
		</section>

		<section>
			<h2>4. 外部サービスとの通信</h2>
			<ul>
				<li>
					Web 版と紹介サイトは、書体を Google
					Fonts(fonts.googleapis.com・fonts.gstatic.com)から読み込みます。この読み込みの際に、IP
					アドレスなどの接続情報が Google に送られます。
				</li>
				<li>
					紹介サイトとエディタは、Cloudflare Pages で配信しています。配信にあたり、Cloudflare
					がアクセスログ(IP アドレスなど)を記録する場合があります。
				</li>
				<li>
					Storift
					は、アクセス解析・広告・トラッキングのためのツールを使っていません。紹介サイトとエディタのソースコードには、そのためのスクリプトは含まれていません。
				</li>
				<li>
					同期を使う場合のデータの扱いは、利用者が選んだ Firebase の提供元である Google
					の規約とプライバシーポリシーに従います。
				</li>
				<li>
					拡張機能を有効にした場合の通信は、「5.
					拡張機能」に定めるとおり、各拡張機能のページに記載した範囲で行われます。
				</li>
			</ul>
		</section>

		<section id="extensions">
			<h2>5. 拡張機能</h2>
			<ul>
				<li>
					拡張機能は<strong>既定で無効</strong
					>です。利用者が設定の「拡張機能」で有効にしない限り、拡張機能が動くことも、外部へ何かが送信されることもありません。有効にするときは、その拡張機能が扱う情報を示した確認画面が出ます。
				</li>
				<li>
					有効にした拡張機能は、<a href="/extensions">各拡張機能のページ</a
					>の「この拡張が扱う情報」に記載した範囲で、外部へ送信します(送る項目、送り先、いつ送るか、端末内の保存場所、無効にしたり連携を解除したりしたときの扱い)。作品の本文は送信しません。
				</li>
				<li>
					<strong
						>公式拡張機能の各ページの「この拡張が扱う情報」の記載は、本ポリシーの一部を構成します。</strong
					>公式拡張機能は次のとおりです。
					<ul class="sub">
						<li>
							<a href="/extensions/monolog">Monolog. 連携</a>: 執筆時間などを時間記録アプリ
							Monolog.(www.monolog.life、api.monolog.life)に記録します。
						</li>
						<li>
							<a href="/extensions/discord">Discord Rich Presence</a>(デスクトップ版のみ):
							開いている画面や執筆中の情報を、端末の Discord クライアント経由で Discord
							に表示します。
						</li>
					</ul>
				</li>
				<li>
					拡張機能の送信先(Monolog.、Discord
					など)に送られた内容の扱いは、それぞれの提供者の規約とプライバシーポリシーに従います。
				</li>
				<li>
					拡張機能の有効・無効と同意の記録、設定、連携のトークンは、この端末にだけ保存します。運営者のサーバーには送信せず、同期・バックアップ・書き出しにも含めません。
				</li>
				<li>
					コミュニティの拡張機能(今後の予定で、まだ提供していません)は、第三者である作者が作るものです。扱う情報は作者の説明に従い、<strong
						>運営者は、そのデータを受け取りません</strong
					>。有効にする前に、各拡張機能の説明を確認してください。
				</li>
			</ul>
		</section>

		<section>
			<h2>6. 端末内のデータの削除</h2>
			<p>
				ブラウザのサイトデータを消去すると、その端末の Web
				版の作品は消えます。設定画面の「全データを削除」は、その端末のデータを消す操作です。同期している作品は、Firebase
				上に残ります。Firebase 上のデータは、Firebase
				コンソールから削除できます。大事な作品は、書き出しておくことをおすすめします。
			</p>
		</section>

		<section>
			<h2>7. 改定</h2>
			<p>
				このポリシーの内容は、必要に応じて改定します。改定した場合は、このページに掲載し、改定日を示します。
			</p>
		</section>

		<section>
			<h2>8. 問い合わせ</h2>
			<p>
				このポリシーに関するご質問は、GitHub の Issues (<a href={ISSUES_URL}>{ISSUES_URL}</a
				>)でお寄せください。
			</p>
		</section>
	</div>

	<div class="next">
		<p>利用条件は、利用規約に定めています。</p>
		<a class="btn secondary" href="/terms">利用規約を見る</a>
		<a class="btn primary" href={APP_URL}>エディタを開く</a>
	</div>
</div>

<style>
	.doc {
		max-width: 46rem;
	}

	section + section {
		margin-top: 40px;
	}

	h2 {
		font-size: 1.15rem;
		letter-spacing: 0.04em;
		margin-bottom: 12px;
	}

	section p,
	section li {
		color: var(--color-text-secondary);
		font-size: 14.5px;
	}

	section p + ul {
		margin-top: 10px;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-left: 1.3em;
		list-style: disc;
	}

	ul.sub {
		margin-top: 8px;
		gap: 6px;
		list-style: circle;
	}

	section strong {
		color: var(--color-text);
		font-weight: 600;
	}
</style>
