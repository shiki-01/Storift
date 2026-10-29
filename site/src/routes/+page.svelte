<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL, SITE_TAGLINE } from '$lib/config';

	const points = [
		{
			title: '書くことに集中できる',
			body: '章とシーンで原稿を整理し、30 秒ごとに自動保存。文字数や目標の進み具合も、書きながら確かめられます。'
		},
		{
			title: '物語の材料をひとつに',
			body: 'プロット、キャラクターと相関図、設定資料、進捗。別々のツールに散らばりがちなものを、作品ごとにまとめて管理します。'
		},
		{
			title: 'オフラインでも、手元に残る',
			body: '原稿は端末内に保存され、通信がなくても開いて書けます。複数端末での同期は、自分の Firebase を使って行えます。'
		}
	];
</script>

<Seo />

<section class="hero">
	<div class="wrap">
		<p class="eyebrow">小説執筆アプリ</p>
		<h1>{SITE_TAGLINE}</h1>
		<p class="lead">
			Storift
			は、執筆・プロット・キャラクター・設定資料・進捗をひとつにまとめた、ブラウザで動く小説執筆アプリです。インストール不要、オフラインでも書けます。
		</p>
		<div class="cta">
			<a class="btn" href={APP_URL}>エディタを開く</a>
			<a class="btn ghost" href="/features">機能を見る</a>
		</div>
	</div>
</section>

<section class="section">
	<div class="wrap grid">
		{#each points as p (p.title)}
			<article class="card">
				<h2>{p.title}</h2>
				<p>{p.body}</p>
			</article>
		{/each}
	</div>
</section>

<section class="section">
	<div class="wrap closing card">
		<h2>まずは一作品、書いてみる</h2>
		<p>使い方は数分で分かります。わからないことは Q&amp;A にまとめています。</p>
		<div class="cta">
			<a class="btn" href={APP_URL}>エディタを開く</a>
			<a class="btn ghost" href="/guide">使い方を見る</a>
		</div>
	</div>
</section>

<style>
	.hero {
		padding: 88px 0 56px;
	}
	.eyebrow {
		color: var(--accent);
		font-weight: 700;
		letter-spacing: 0.08em;
		font-size: 0.9rem;
	}
	h1 {
		margin-top: 12px;
		font-size: clamp(2rem, 6vw, 3.4rem);
		max-width: 16em;
	}
	.lead {
		margin-top: 20px;
		max-width: 38em;
		color: var(--muted);
		font-size: 1.05rem;
	}
	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 28px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 16px;
	}
	.card h2 {
		font-size: 1.15rem;
		margin-bottom: 8px;
	}
	.card p {
		color: var(--muted);
	}
	.closing {
		text-align: center;
		padding: 40px 24px;
	}
	.closing .cta {
		justify-content: center;
	}
</style>
