<script lang="ts">
	import Seo from '$lib/Seo.svelte';

	const faqs = [
		{
			q: 'インストールは必要ですか。',
			a: '不要です。ブラウザでエディタを開くだけで使えます。ホーム画面に追加すると、アプリのように起動できます。'
		},
		{
			q: 'オフラインでも使えますか。',
			a: '使えます。一度開いたあとは、通信がなくてもアプリが起動し、書いた内容は端末内に保存されます。初回の読み込みのみ、通信が必要です。'
		},
		{
			q: '原稿はどこに保存されますか。',
			a: '端末のブラウザ内（IndexedDB）に保存されます。同期を設定した場合は、ご自身の Firebase プロジェクトにも保存されます。'
		},
		{
			q: 'なぜ Firebase の設定が必要ですか。',
			a: '複数端末での同期に、ご自身の Firebase プロジェクトを使うためです。データの保管先をご自身で管理できます。設定は初回のみです。'
		},
		{
			q: '複数の端末で同じ作品を編集できますか。',
			a: '同じ Firebase 設定を各端末で読み込むと同期されます。同じ箇所を別々の端末で編集して競合した場合は、上書きされる側の版が自動でバックアップされ、設定画面から復元できます。'
		},
		{
			q: 'ブラウザのデータを消すと、作品はどうなりますか。',
			a: '端末内のデータは削除されます。同期していない作品は戻せないため、定期的にエクスポートで書き出してください。iOS では、ホーム画面に追加したアプリを長期間使わないと、データが削除される場合があります。'
		},
		{
			q: 'どの形式で書き出せますか。',
			a: 'TXT、Markdown、DOCX、PDF、EPUB、JSON に対応しています。'
		},
		{
			q: '縦書きで書けますか。',
			a: '縦書きはプレビューで確認できます。エディタ自体は現在、横書きです。'
		},
		{
			q: '料金はかかりますか。',
			a: '料金に関する案内は、決まり次第このページに掲載します。'
		}
	];
</script>

<Seo
	title="Q&A"
	description="Storift のよくある質問。オフライン、保存先、同期、書き出し形式など。"
/>

<div class="wrap">
	<div class="page-head">
		<h1>Q&amp;A</h1>
		<p>よくある質問をまとめています。</p>
	</div>

	<div class="list">
		{#each faqs as f (f.q)}
			<details class="card">
				<summary>{f.q}</summary>
				<p>{f.a}</p>
			</details>
		{/each}
	</div>
</div>

<style>
	.list {
		display: grid;
		gap: 10px;
		max-width: 720px;
	}
	details {
		padding: 16px 20px;
	}
	summary {
		cursor: pointer;
		font-weight: 700;
	}
	details p {
		margin-top: 10px;
		color: var(--muted);
		font-size: 0.95rem;
	}
</style>
