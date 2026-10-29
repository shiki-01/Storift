<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL } from '$lib/config';

	const features = [
		{
			title: '執筆エディタ',
			body: '作品を章とシーンに分けて書けます。30 秒ごとの自動保存、文字数の表示、ルビの記法、フォントなどの書式設定に対応しています。'
		},
		{
			title: '縦書きプレビュー',
			body: '書いた原稿を、縦書きや原稿用紙のレイアウトで確かめられます。印刷用のプレビューも開けます。'
		},
		{
			title: 'プロット',
			body: '物語の流れを整理する場所です。執筆の前にも、書きながらの見直しにも使えます。'
		},
		{
			title: 'キャラクターと相関図',
			body: '登場人物の情報を一覧で管理し、人物同士の関係を相関図で整理できます。'
		},
		{
			title: '設定資料',
			body: '世界観や用語などの設定をまとめて管理します。執筆中に参照しやすいよう、作品ごとに保管されます。'
		},
		{
			title: '進捗の管理',
			body: '執筆した分量を記録し、目標に対する進み具合を確認できます。'
		},
		{
			title: '履歴と復元',
			body: '作品のバージョンを残し、あとから以前の状態へ戻せます。同期で上書きされる版は自動でバックアップされ、設定画面から復元できます。'
		},
		{
			title: 'エクスポート',
			body: 'TXT、Markdown、DOCX、PDF、EPUB、JSON の各形式で書き出せます。'
		},
		{
			title: 'オフライン対応',
			body: '一度開けば、通信がなくてもアプリが起動します。原稿は端末内に保存されます。ホーム画面に追加して、アプリのようにも使えます。'
		},
		{
			title: '複数端末の同期',
			body: '自分の Firebase プロジェクトを設定すると、複数の端末で作品を同期できます。データの保管先を自分で管理できます。'
		}
	];
</script>

<Seo
	title="機能"
	description="Storift の機能一覧。執筆エディタ、プロット、キャラクター、設定資料、進捗、エクスポート、オフライン対応、同期。"
/>

<div class="wrap">
	<div class="page-head">
		<h1>機能</h1>
		<p>小説の執筆に必要なものを、ひとつのアプリにまとめています。</p>
	</div>

	<ul class="grid">
		{#each features as f (f.title)}
			<li class="card">
				<h2>{f.title}</h2>
				<p>{f.body}</p>
			</li>
		{/each}
	</ul>

	<div class="more">
		<a class="btn" href={APP_URL}>エディタを開く</a>
		<a class="btn ghost" href="/guide">使い方を見る</a>
	</div>
</div>

<style>
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 16px;
	}
	.card h2 {
		font-size: 1.1rem;
		margin-bottom: 8px;
	}
	.card p {
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
