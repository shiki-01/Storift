<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL, BOOTH_URL, RELEASES_URL, SPONSORS_URL, SUPPORTERS_URL } from '$lib/config';

	const ISSUES_URL = 'https://github.com/shiki-01/Storift/issues';
</script>

<Seo
	title="開発の支援"
	description="Storift の開発を支援する方法。GitHub Sponsors と BOOTH で受け付けています。支援の有無で使える機能は変わりません。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">支援</p>
		<h1>開発の支援</h1>
		<p>
			Storift
			は、すべての機能を無料で使えます。開発を支援していただける場合は、下の窓口から受け付けています。
		</p>
	</div>

	<div class="doc">
		<section>
			<h2>1. 支援の方法</h2>
			<div class="ways">
				<div class="way">
					<h3>GitHub Sponsors</h3>
					<p>月ごと、または一回の支援です。GitHub のアカウントが必要です。</p>
					<a class="btn secondary" href={SPONSORS_URL}>GitHub Sponsors を開く</a>
				</div>
				<div class="way">
					<h3>BOOTH</h3>
					<p>
						支援用の商品を購入する形の、一回の支援です。pixiv
						のアカウントが必要です。商品には、お礼の画像と、支援者一覧への掲載を申し込むフォームの案内が入っています。
					</p>
					<a class="btn secondary" href={BOOTH_URL}>BOOTH を開く</a>
				</div>
			</div>
		</section>

		<section>
			<h2>2. 支援しても変わらないこと</h2>
			<ul>
				<li>使える機能は変わりません。支援者だけの機能や、無料では使えない機能はありません。</li>
				<li>
					BOOTH の支援用の商品に、アプリは入っていません。デスクトップ版は、<a href={RELEASES_URL}
						>GitHub Releases</a
					>
					だけで配布しています。Web 版は<a href={APP_URL}>エディタ</a>をそのまま開いて使えます。
				</li>
				<li>支援は、問い合わせへの優先対応や、不具合の修正を約束するものではありません。</li>
			</ul>
		</section>

		<section>
			<h2>3. 支援者一覧への掲載</h2>
			<p>
				支援してくださった方のうち、掲載を希望された方の名前を、<a href={SUPPORTERS_URL}
					>支援者一覧</a
				>に載せています。
			</p>
			<ul>
				<li>
					<strong>GitHub Sponsors</strong>: 支援を「公開」に設定した方を、GitHub
					のユーザー名で載せます。非公開の支援は載せません。
				</li>
				<li>
					<strong>BOOTH</strong>: 商品に入っている案内のフォームに、載せたい表示名と BOOTH
					の注文番号を書いて送ってください。注文番号は、支援の確認だけに使います。
				</li>
				<li>支援の金額や期間は載せません。並び順は、掲載を受け付けた順です。</li>
				<li>
					掲載の取り下げや表示名の変更は、いつでも受け付けます。GitHub Sponsors の方は <a
						href={ISSUES_URL}>Issues</a
					>、BOOTH の方は同じフォームからお知らせください。
				</li>
			</ul>
		</section>

		<section>
			<h2>4. 購入と返金</h2>
			<p>
				支払い、領収、返金などの手続きは、GitHub Sponsors と BOOTH
				それぞれの規約に従います。フォームで受け取った情報の扱いは、プライバシーポリシーに定めています。
			</p>
		</section>
	</div>

	<div class="next">
		<p>支援がなくても、すべての機能を使えます。</p>
		<a class="btn secondary" href="/privacy">プライバシーポリシーを見る</a>
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

	.ways {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.way {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding: 20px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-surface);
	}

	.way h3 {
		font-size: 1rem;
		letter-spacing: 0.04em;
	}

	.way p {
		flex: 1;
	}

	@media (max-width: 640px) {
		.ways {
			grid-template-columns: 1fr;
		}
	}
</style>
