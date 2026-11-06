<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL } from '$lib/config';
	import { accordion } from '$lib/accordion';

	const groups = [
		{
			title: '使いはじめ',
			items: [
				{
					q: 'インストールは必要ですか。',
					a: '不要です。ブラウザでエディタを開くだけで使えます。ホーム画面に追加すると、アプリのように起動できます。Windows・macOS・Linux 向けのデスクトップ版もあります。'
				},
				{
					q: 'なぜ Firebase の設定が必要ですか。',
					a: '複数の端末で同期するときの保管先に、ご自身の Firebase プロジェクトを使うためです。原稿の置き場所をご自身で管理できます。設定は初回のみです。',
					link: { href: '/guide/firebase', label: '設定の手順は Firebase 設定ガイドへ' }
				},
				{
					q: '料金はかかりますか。',
					a: '料金に関する案内は、決まり次第このページに掲載します。'
				}
			]
		},
		{
			title: '保存と同期',
			items: [
				{
					q: 'オフラインでも使えますか。',
					a: '使えます。一度開いたあとは、通信がなくても起動し、書いた内容は端末内に保存されます。初回の読み込みだけは通信が必要です。'
				},
				{
					q: '原稿はどこに保存されますか。',
					a: '端末のブラウザ内(IndexedDB)に保存されます。同期を設定した場合は、ご自身の Firebase プロジェクトにも保存されます。'
				},
				{
					q: '複数の端末で同じ作品を編集できますか。',
					a: '同じ Firebase 設定を各端末で読み込むと同期されます。同じ箇所を別々の端末で編集して食い違った場合は、上書きされる側の版が自動で控えられ、設定画面から復元できます。',
					link: { href: '/guide/firebase', label: '同期の設定方法は Firebase 設定ガイドへ' }
				},
				{
					q: 'ブラウザのデータを消すと、作品はどうなりますか。',
					a: '端末内のデータは削除されます。同期していない作品は戻せないため、ときどき書き出しておいてください。iOS では、ホーム画面に追加したアプリを長い間使わないと、データが削除される場合があります。'
				}
			]
		},
		{
			title: '書く・書き出す',
			items: [
				{
					q: '縦書きで書けますか。',
					a: '縦書きと原稿用紙の体裁は、プレビューで確かめられます。入力する画面は現在、横書きです。'
				},
				{
					q: 'どの形式で書き出せますか。',
					a: 'TXT・Markdown・DOCX・PDF・EPUB・JSON に対応しています。JSON で書き出したものは、そのまま読み込み直せます。'
				},
				{
					q: 'スマートフォンでも書けますか。',
					a: '書けます。画面の幅に合わせて配置が変わり、資料の参照や校正は下から引き出すシートで開きます。'
				}
			]
		},
		{
			title: 'デスクトップ版と AI',
			items: [
				{
					q: 'Web 版とデスクトップ版の違いは何ですか。',
					a: '書く・整理する機能は同じです。デスクトップ版では、執筆画面の横に AI のパネルを開けます。データは Web 版とは別にアプリ内へ保存されるため、両方で使うときは同期を設定してください。'
				},
				{
					q: 'AI のパネルを使うには何が必要ですか。',
					a: '設定の「AI」でプロバイダを選びます。Claude Code は、インストールとご自身の Claude アカウントでのログインが必要です。Ollama は端末内で動かす Ollama とモデルが、OpenAI 互換 API(OpenAI・OpenRouter・LM Studio など)・Anthropic API・Gemini は API キーとモデルが必要です。使用量と料金は、選んだサービスのご自身のアカウントに計上されます。'
				},
				{
					q: 'AI が勝手に原稿を書き換えることはありますか。',
					a: '既定の「提案のみ」では書き換えません。「差分を確認して反映」では一件ずつ選んで反映し、「自動で反映」を選んだ場合も、あとから一件ずつ元に戻せます。書き換えの対象は本文のシーンだけです。'
				},
				{
					q: '原稿はどこかへ送られますか。',
					a: 'パネルで送信したとき、AI が必要に応じて原稿を読み、質問と読んだ内容が、選んだプロバイダ(Claude Code・Anthropic API なら Anthropic、Gemini なら Google、OpenAI 互換 API なら設定したサービス、Ollama なら端末内)に送られます。パネルで送信しない限り、原稿が AI に渡ることはありません。'
				}
			]
		}
	];
</script>

<Seo
	title="Q&A"
	description="Storift のよくある質問。オフライン、保存先、同期、書き出し形式、デスクトップ版の AI パネルなど。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">Q&amp;A</p>
		<h1>よくある質問</h1>
		<p>使いはじめる前と、使いはじめてから寄せられやすい質問をまとめています。</p>
	</div>

	{#each groups as g (g.title)}
		<section class="group">
			<h2>{g.title}</h2>
			<div class="list">
				{#each g.items as f (f.q)}
					<details use:accordion>
						<summary>
							<span class="q">{f.q}</span>
							<span class="mark" aria-hidden="true"></span>
						</summary>
						<p>
							{f.a}
							{#if f.link}
								<a href={f.link.href}>{f.link.label}</a>
							{/if}
						</p>
					</details>
				{/each}
			</div>
		</section>
	{/each}

	<div class="next">
		<p>ここにない疑問は、まず触ってみるのが早いかもしれません。</p>
		<a class="btn primary" href={APP_URL}>エディタを開く</a>
	</div>
</div>

<style>
	.group {
		display: grid;
		grid-template-columns: 15rem 1fr;
		gap: 40px;
		max-width: 60rem;
		padding: 32px 0;
	}

	.group + .group {
		border-top: 1px solid var(--color-border);
	}

	h2 {
		font-size: 1.2rem;
		letter-spacing: 0.06em;
	}

	details {
		border-bottom: 1px solid var(--color-border);
	}

	details:first-child summary {
		padding-top: 0;
	}

	summary {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 16px 0;
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.q {
		flex: 1;
	}

	/* ＋ と － の印 */
	.mark {
		position: relative;
		flex: none;
		width: 12px;
		height: 12px;
		color: var(--color-text-secondary);
	}

	.mark::before,
	.mark::after {
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

	.mark::after {
		transform: rotate(90deg);
	}

	details[open] .mark::after {
		transform: rotate(0deg);
	}

	summary:hover .q {
		color: var(--color-primary);
	}

	details p {
		padding: 0 28px 18px 0;
		color: var(--color-text-secondary);
		font-size: 14.5px;
	}

	@media (max-width: 820px) {
		.group {
			grid-template-columns: 1fr;
			gap: 16px;
		}
	}
</style>
