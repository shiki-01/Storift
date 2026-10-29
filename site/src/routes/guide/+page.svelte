<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL } from '$lib/config';

	const steps = [
		{
			title: 'エディタを開く',
			body: 'サイト右上の「エディタを開く」を押すと、アプリが開きます。インストールは不要で、最新のブラウザで動きます。'
		},
		{
			title: '初回のみ、Firebase を設定する',
			body: '初めて開くと、Firebase の設定画面が表示されます。Firebase Console で作成したプロジェクトの設定をそのまま貼り付けて読み込みます。この設定は、作品の同期に使われます。'
		},
		{
			title: '作品を作る',
			body: 'ホーム画面の「最初の作品を作成」から、作品を作ります。作品ごとに、執筆・プロット・キャラクター・設定資料・進捗がまとまります。'
		},
		{
			title: '書く',
			body: '章とシーンを作って書き進めます。内容は自動で保存されます。縦書きなどの見た目はプレビューで確かめられます。'
		},
		{
			title: '整理する',
			body: 'プロットやキャラクター、設定資料に物語の材料を書き留め、進捗で執筆量を記録します。'
		},
		{
			title: '書き出す・バックアップする',
			body: '作品は TXT、Markdown、DOCX、PDF、EPUB、JSON で書き出せます。大事な作品は、定期的に書き出しておくことを推奨します。'
		}
	];
</script>

<Seo
	title="使い方"
	description="Storift の始め方。エディタを開いて、作品を作り、書き、書き出すまでの手順。"
/>

<div class="wrap">
	<div class="page-head">
		<h1>使い方</h1>
		<p>はじめて使うときの流れです。</p>
	</div>

	<ol class="steps">
		{#each steps as s, i (s.title)}
			<li class="card">
				<span class="num" aria-hidden="true">{i + 1}</span>
				<div>
					<h2>{s.title}</h2>
					<p>{s.body}</p>
				</div>
			</li>
		{/each}
	</ol>

	<div class="more">
		<a class="btn" href={APP_URL}>エディタを開く</a>
		<a class="btn ghost" href="/faq">Q&amp;A を見る</a>
	</div>
</div>

<style>
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
		max-width: 720px;
	}
	.steps li {
		display: flex;
		gap: 16px;
		align-items: flex-start;
	}
	.num {
		flex: none;
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
	}
	h2 {
		font-size: 1.1rem;
		margin-bottom: 4px;
	}
	p {
		color: var(--muted);
		font-size: 0.95rem;
	}
	.more {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 40px;
	}
</style>
