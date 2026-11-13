<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import {
		PACK_LIMITS,
		ALLOWED_LICENSES,
		CONTRIBUTION_LABELS,
		ORIGIN_NOTES,
		SCRIPT_ISOLATION_NOTES
	} from '$manifest';

	const REPO_URL = 'https://github.com/shiki-01/Storift';
	const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`;
</script>

<Seo
	title="拡張機能を投稿する"
	description="Storift のコミュニティ拡張機能(パック・スクリプト)の作り方と投稿の手順。ひな形、プルリクエストの流れ、基準、ライセンス、プライバシーの書き方、審査と削除の方針。"
/>

<div class="wrap">
	<nav class="crumb" aria-label="パンくず">
		<a href="/extensions">拡張機能</a><span aria-hidden="true">/</span><span>投稿する</span>
	</nav>

	<div class="page-head">
		<p class="label">拡張機能</p>
		<h1>拡張機能を投稿する</h1>
		<p>
			Storift
			の拡張機能(パックまたはスクリプト)を作って、公式リポジトリに提案(プルリクエスト)すると、レビューのうえで、この紹介サイトの一覧に載り、アプリの「拡張機能を探す」から入れられるようになります。
		</p>
	</div>

	<div class="doc">
		<section aria-labelledby="what">
			<h2 id="what">受け付けるもの</h2>
			<p>
				いま投稿できるのは<strong>パック</strong>と<strong>スクリプト</strong
				>です。パックは、コードを含まない設定ファイル(JSON)だけの拡張機能で、通信せず、コードも実行しません。スクリプトは、隔離された環境で動く
				1 ファイルの JavaScript で、宣言した通信先にだけ通信できます(下の「スクリプトを投稿する」)。
			</p>
			<p>パックでは、次のものを足せます。</p>
			<ul>
				<li>
					{CONTRIBUTION_LABELS.themes}: ライト/ダークの配色。文字と背景のコントラスト比が基準(本文
					4.5 以上など)に満たないものは、検証で拒否されます。フォントは指定できません。
				</li>
				<li>
					{CONTRIBUTION_LABELS.proofreadRules}:
					「誤→正」の対応(固定の文字列だけ)。正規表現は使えません。
				</li>
				<li>
					{CONTRIBUTION_LABELS.assistKeys}:
					スマホの入力補助バーに足す、文字列のキー。制御文字は使えません。
				</li>
				<li>
					{CONTRIBUTION_LABELS.exportPresets}:
					ルビ・傍点・空行の書き方を変えて書き出す設定(テキスト・Markdown の書き出し)。
				</li>
			</ul>
		</section>

		<section aria-labelledby="steps">
			<h2 id="steps">投稿の手順</h2>
			<ol>
				<li>
					<a href={REPO_URL} rel="noopener noreferrer">リポジトリ</a
					>をフォークして、クローンします。
				</li>
				<li>
					<code>extensions/_template/</code> を <code>extensions/&lt;あなたの id&gt;/</code>
					にコピーします。id は、フォルダ名と <code>manifest.json</code> の
					<code>id</code>
					で同じにします(小文字の英数字とハイフン。<code>monolog</code>・<code>discord</code>・<code
						>official-</code
					>で始まるものなど、公式と紛らわしい id は使えません)。
				</li>
				<li>
					<code>manifest.json</code> と <code>contents/</code>
					の JSON を編集します。作者・ライセンス・プライバシーの記述が必須です。
				</li>
				<li>
					<code>bun run validate:extensions</code>
					で検証します(スキーマ、id、ライセンス、サイズ、ファイルの構成、コンテンツの中身を確認します。エラーは
					<code>ファイル:メッセージ</code> の形で出ます)。
				</li>
				<li>
					プルリクエストを作ります。<code>extension</code> のテンプレートが開くので、確認項目にチェックを入れます。
				</li>
				<li>
					検証の
					CI(自動)と、運営者のレビューを通ると、マージされます。マージ後のサイトの更新で、一覧に載り、アプリから入れられるようになります。
				</li>
			</ol>
		</section>

		<section aria-labelledby="rules">
			<h2 id="rules">基準</h2>
			<ul>
				<li>
					<strong>ライセンス</strong>: <code>license</code> に、次のいずれかを SPDX
					の識別子で書きます: {ALLOWED_LICENSES.join(
						'、'
					)}。自分で作った、または再配布を許されたものだけを投稿してください。他人の著作物(辞書データなど)を、許諾なく含めることはできません。
				</li>
				<li>
					<strong>通信しない(パックの場合)</strong>: パックは通信できません。<code>permissions</code
					>
					に
					<code>network</code>・<code>events</code>・<code>read</code>
					は書けません。外部へ送る情報も、ありません(<code>privacy.sends</code> は空)。
				</li>
				<li>
					<strong>権限は最小に</strong>:
					<code>permissions</code> は <code>{'{ "storage": true }'}</code>
					だけにします(インストールした内容を端末内に保存するため)。
				</li>
				<li>
					<strong>プライバシーの記述</strong>: 何を端末に保存するか(<code>stores</code
					>)、無効にしたときの扱い(<code>onDisable</code>)、補足(<code>notes</code
					>)を、実際の動作のとおりに書きます。確認できないことは書かないでください。この記述は、アプリの同意画面と、この拡張のページに、そのまま表示されます。
				</li>
				<li>
					<strong>大きさ</strong>: JSON は 1 ファイル {kb(PACK_LIMITS.fileBytes)}、パック全体で
					{kb(PACK_LIMITS.totalBytes)}まで。画像は 1 枚 {kb(PACK_LIMITS.imageBytes)}まで。
				</li>
				<li>
					<strong>置けるファイル</strong>: <code>.json</code>・<code>.md</code>・<code>.png</code
					>・<code>.svg</code>だけです(スクリプトは、これに本体の <code>.js</code> が 1 つ)。パックには実行できるファイルを置けません。隠しファイル、シンボリックリンクは置けません。マニフェストに書かれていない
					JSON も置けません。
				</li>
				<li>
					<strong>内容</strong>:
					名前・説明を正確に書き、公式のものと誤認させないでください。公序良俗に反するもの、他者の権利を侵害するもの、誤解を招く表記を含むものは、受け付けません。
				</li>
				<li>
					<strong>更新</strong>: 内容を変えるときは、<code>version</code> と <code>updatedAt</code>
					を更新します。公開済みの版の内容は、変えないでください(版ごとに配信し、長くキャッシュされます)。権限やプライバシーの記述が変わる更新は、利用者に再度の同意を求めます。
				</li>
			</ul>
		</section>

		<section aria-labelledby="script">
			<h2 id="script">スクリプトを投稿する</h2>
			<p>
				スクリプト(<code>kind: script</code>)は、Storift の画面から隔離された Web Worker
				の中で動きます。本文・設定・API
				キーには触れず、マニフェストで宣言して利用者が同意した範囲のイベントと、宣言した通信先だけを使えます。
			</p>
			<ol>
				<li>
					<code>extensions/_template-script/</code> を <code>extensions/&lt;あなたの id&gt;/</code>
					にコピーします。<code>manifest.json</code>・<code>main.js</code>(スクリプト本体。1
					ファイルだけ。200KB まで)・<code>sdk.d.ts</code>(型定義)があります。
				</li>
				<li>
					<code>permissions</code> に、使うものだけを宣言します: <code>events</code>・<code
						>read</code
					>(<code>project:title</code>・<code>project:chars</code>)・<code>network</code
					>(完全一致のホスト名だけ。ワイルドカード・IP・localhost は不可)・<code>storage</code
					>・<code>notify</code>・<code>ui</code>。
				</li>
				<li>
					<code>permissions.network</code> の各ホストは、<code>privacy.sends[].to</code>
					のどこかに書きます。送る項目・いつ送るか・端末に保存するものを、実際の動作のとおりに書きます。
				</li>
				<li>
					<code>bun run validate:extensions</code> で検証します。<code>eval</code>・<code
						>new Function</code
					>・<code>importScripts</code>・<code>WebAssembly</code>・動的
					<code>import()</code>
					は拒否されます。圧縮・難読化が疑われるコード(極端に長い行、1 文字の変数名だらけなど)は警告になり、レビューで人が確認します。読めるコードで書いてください。
				</li>
				<li>
					プルリクエストを作ります。オーナーのレビューが必須です(<code>extensions/**</code>
					は CODEOWNERS の対象)。
				</li>
			</ol>
			<p>
				API・上限・デバッグの方法は、<a
					href={`${REPO_URL}/blob/main/docs/SCRIPT_API.md`}
					rel="noopener noreferrer">docs/SCRIPT_API.md</a
				>にあります。サンプルは<a
					href={`${REPO_URL}/tree/main/extensions/pomodoro-timer`}
					rel="noopener noreferrer">ポモドーロタイマー</a
				>(通信なし)と<a
					href={`${REPO_URL}/tree/main/extensions/discord-webhook`}
					rel="noopener noreferrer">Discord Webhook 投稿</a
				>(通信先は discord.com だけ)です。
			</p>
			<ul>
				{#each SCRIPT_ISOLATION_NOTES as note, i (i)}<li>{note}</li>{/each}
				<li>
					有害と分かった拡張は、失効の一覧(<code>extensions/revoked.json</code
					>)に載せます。利用者のアプリは、これを確認して、該当する版を自動で無効にします。
				</li>
			</ul>
		</section>

		<section aria-labelledby="review">
			<h2 id="review">審査の方針</h2>
			<p>
				運営者は、公開前に、ライセンス・内容・プライバシーの記述が、上の基準を満たしているかを確認します。ただし、コミュニティの拡張機能は第三者が作るもので、運営者はその内容を保証しません。アプリでは、コミュニティの拡張機能に、必ず「コミュニティ」のラベルを付けて表示します。
			</p>
			<p>{ORIGIN_NOTES.community}</p>
		</section>

		<section aria-labelledby="remove">
			<h2 id="remove">削除・停止の方針</h2>
			<p>
				基準に反することが分かった拡張機能、権利者から申し立てのあったもの、利用者に害を及ぼすおそれのあるものは、事前の連絡なく、一覧から外す(次回のサイトの更新で配信を止める)ことがあります。すでに利用者の端末に入っている拡張機能は、利用者がアンインストールするまで残ります。作者からの取り下げの依頼は、プルリクエストまたは
				Issue で受け付けます。
			</p>
		</section>

		<section aria-labelledby="more">
			<h2 id="more">詳しい仕様</h2>
			<p>
				各貢献の JSON の書き方、検証コマンド、バンドルの形式などは、リポジトリの
				<a href={`${REPO_URL}/blob/main/docs/COMMUNITY.md`} rel="noopener noreferrer"
					>docs/COMMUNITY.md</a
				>
				と
				<a href={`${REPO_URL}/blob/main/docs/EXTENSIONS.md`} rel="noopener noreferrer"
					>docs/EXTENSIONS.md</a
				>
				にあります。コミュニティの拡張機能の扱いは、<a href="/privacy">プライバシーポリシー</a>と<a
					href="/terms">利用規約</a
				>にも定めています。
			</p>
		</section>
	</div>

	<div class="next">
		<p><a href="/extensions">拡張機能の一覧</a>に戻る</p>
		<a
			class="btn primary"
			href={`${REPO_URL}/tree/main/extensions/_template`}
			rel="noopener noreferrer">ひな形を見る</a
		>
	</div>
</div>

<style>
	.crumb {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 24px;
		font-size: 12.5px;
		color: var(--color-text-secondary);
	}

	.crumb a {
		color: inherit;
	}

	.crumb + .page-head {
		padding-top: 16px;
	}

	.doc {
		max-width: 46rem;
	}

	section + section {
		margin-top: 44px;
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

	section p + p,
	section p + ul {
		margin-top: 10px;
	}

	ul,
	ol {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-left: 1.4em;
	}

	ul {
		list-style: disc;
	}

	ol {
		list-style: decimal;
	}

	strong {
		color: var(--color-text);
	}

	code {
		padding: 1px 6px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
		font-size: 0.92em;
		overflow-wrap: anywhere;
	}
</style>
