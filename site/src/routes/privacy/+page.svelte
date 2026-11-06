<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL } from '$lib/config';

	const ISSUES_URL = 'https://github.com/shiki-01/Storift/issues';
</script>

<Seo
	title="プライバシーポリシー"
	description="Storift の個人情報と作品データの扱い。作品は端末内、または利用者ご自身の Firebase に保存され、運営者は受け取りません。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">規約</p>
		<h1>プライバシーポリシー</h1>
		<p>制定日: 2026年11月1日</p>
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
			</ul>
		</section>

		<section>
			<h2>3. デスクトップ版の AI 連携</h2>
			<p>
				デスクトップ版の AI パネルは、利用者が設定で選んだプロバイダ(利用者の端末にインストールされた
				Claude Code、端末内の Ollama、または利用者が設定した OpenAI 互換 API・Anthropic API・Gemini のサービス)を呼び出します。次の内容が扱われます。
			</p>
			<ul>
				<li>
					パネルで送信したとき、入力した文章と、送信のたびに作品データ(全作品の本文・設定・プロットなど)が
					Markdown
					に書き出されて、アプリのデータ領域内のワークスペースに保存されます。未保存の本文も含まれます。
				</li>
				<li>
					Claude Code
					を選んだ場合、Claude Code は回答に必要なファイルをワークスペースから読みます。読んだ内容は、利用者ご自身の Claude
					アカウントを使って、Anthropic のサービスで処理されます。Anthropic
					に送られた内容の扱いは、Anthropic の規約とプライバシーポリシーに従います。
				</li>
				<li>
					OpenAI 互換 API を選んだ場合、質問と、AI がツールで読んだ原稿・設定資料などの一部が、利用者が設定した
					Base URL のサービスに送られます。送られた内容の扱いは、そのサービスの規約とプライバシーポリシーに従います。Ollama
					を選んだ場合は、設定した接続先(通常は端末内)に送られます。
				</li>
				<li>
					Anthropic API を選んだ場合は Anthropic(api.anthropic.com)に、Gemini を選んだ場合は Google(generativelanguage.googleapis.com)に、質問と、AI
					がツールで読んだ原稿・設定資料などの一部が送られます。Base URL
					を変更した場合は、設定した URL のサービスに送られます。送られた内容の扱いは、各サービスの規約とプライバシーポリシーに従います。
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
			</ul>
		</section>

		<section>
			<h2>5. 端末内のデータの削除</h2>
			<p>
				ブラウザのサイトデータを消去すると、その端末の Web
				版の作品は消えます。設定画面の「全データを削除」は、その端末のデータを消す操作です。同期している作品は、Firebase
				上に残ります。Firebase 上のデータは、Firebase
				コンソールから削除できます。大事な作品は、書き出しておくことをおすすめします。
			</p>
		</section>

		<section>
			<h2>6. 改定</h2>
			<p>
				このポリシーの内容は、必要に応じて改定します。改定した場合は、このページに掲載し、改定日を示します。
			</p>
		</section>

		<section>
			<h2>7. 問い合わせ</h2>
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

	section strong {
		color: var(--color-text);
		font-weight: 600;
	}
</style>
