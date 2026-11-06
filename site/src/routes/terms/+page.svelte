<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import { APP_URL } from '$lib/config';

	const REPO_URL = 'https://github.com/shiki-01/Storift';
	const LICENSE_URL = 'https://github.com/shiki-01/Storift/blob/main/LICENSE';
</script>

<Seo
	title="利用規約"
	description="Storift の利用条件。無保証、作品データの責任範囲、Firebase や AI サービスなど第三者サービスの扱い、準拠法。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">規約</p>
		<h1>利用規約</h1>
		<p>制定日: 2026年11月1日</p>
	</div>

	<div class="doc">
		<section>
			<h2>1. 適用</h2>
			<p>
				この規約は、Storift(紹介サイト、Web
				版エディタ、デスクトップ版を含みます。以下「本ソフトウェア」)の利用条件を定めるものです。本ソフトウェアを利用した時点で、この規約に同意したものとします。
			</p>
		</section>

		<section>
			<h2>2. ライセンス</h2>
			<p>
				本ソフトウェアは、MIT ライセンスのもとで提供します。ライセンスの全文は、<a
					href={LICENSE_URL}>リポジトリの LICENSE</a
				>
				を参照してください。ソースコードは <a href={REPO_URL}>GitHub</a> で公開しています。
			</p>
		</section>

		<section>
			<h2>3. 無保証</h2>
			<p>
				本ソフトウェアは、現状のまま提供されます。明示または黙示を問わず、動作の確実性、特定の目的への適合性、第三者の権利を侵害しないことについて、保証は行いません。
			</p>
		</section>

		<section>
			<h2>4. 作品データと責任</h2>
			<p>
				作品データは、利用者の端末、または利用者ご自身の Firebase
				プロジェクトに保存されます。運営者は、利用者の作品データを預かっていません。そのため、作品データの消失、破損、同期の不具合について、運営者は責任を負いません。
			</p>
			<p>
				大事な作品は、定期的に書き出して控えておくことをおすすめします。書き出しには、TXT・Markdown・DOCX・PDF・EPUB・JSON
				の形式を使えます。
			</p>
		</section>

		<section>
			<h2>5. 第三者のサービス</h2>
			<p>
				本ソフトウェアは、Firebase、Google Fonts、Cloudflare、
				および利用者が選んだ AI サービス(Claude Code、OpenAI 互換 API など)
				など、第三者が提供するサービスを利用します。これらのサービスは、それぞれの提供者の規約に従って利用してください。
			</p>
			<p>
				Firebase の利用量と費用、AI サービスの利用量と料金(API
				キーの管理を含む)は、利用者ご自身の責任で管理してください。Firebase の Blaze
				プランへの切り替えや、AI
				サービスのアカウント・API キーの利用によって発生した費用について、運営者は負担しません。
			</p>
		</section>

		<section>
			<h2>6. 禁止事項</h2>
			<p>次の行為を禁止します。</p>
			<ul>
				<li>法令に違反する行為、または違反するおそれのある行為</li>
				<li>他人のデータや Firebase プロジェクトに、権限なくアクセスする行為</li>
				<li>本ソフトウェアや紹介サイトの運営、配信を妨げる行為</li>
			</ul>
		</section>

		<section>
			<h2>7. 規約の変更</h2>
			<p>
				この規約は、必要に応じて変更することがあります。変更した場合は、このページに掲載し、制定日または改定日を示します。変更後に本ソフトウェアを利用した場合は、変更後の規約に同意したものとします。
			</p>
		</section>

		<section>
			<h2>8. 準拠法</h2>
			<p>この規約は、日本法に従って解釈されます。</p>
		</section>
	</div>

	<div class="next">
		<p>作品データの扱いは、プライバシーポリシーに定めています。</p>
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

	section p + p {
		margin-top: 10px;
	}

	section p + ul {
		margin-top: 10px;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-left: 1.3em;
		list-style: disc;
	}
</style>
