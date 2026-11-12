<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import Icon from '$lib/Icon.svelte';
	import { APP_URL } from '$lib/config';
	import { extensions } from '$lib/extensions';
	import { KIND_LABELS, platformsLabel } from '$manifest';
	import { icons, type IconName } from '$lib/icons';

	/** マニフェストのアイコン名がサイトの線画に無いときは、パズルの形にする */
	const iconFor = (name: string): IconName => (name in icons ? (name as IconName) : 'puzzle');
</script>

<Seo
	title="拡張機能"
	description="Storift の拡張機能の一覧。公式の拡張機能が、何を扱い、何を外部に送るのかを、一つずつ説明します。"
/>

<div class="wrap">
	<div class="page-head">
		<p class="label">拡張機能</p>
		<h1>拡張機能</h1>
		<p>
			Storift
			に機能を足す仕組みです。既定ではすべて無効で、設定の「拡張機能」から一つずつ有効にします。有効にするときは、その拡張が扱う情報(何を、どこへ送るか)を確認して、同意します。
		</p>
	</div>

	<section aria-labelledby="official">
		<h2 id="official" class="sec">公式の拡張機能</h2>
		<p class="lead">
			Storift に同梱している拡張機能です。各ページの「この拡張が扱う情報」は、<a href="/privacy"
				>プライバシーポリシー</a
			>の一部です。
		</p>
		<ul class="cards">
			{#each extensions as ext (ext.id)}
				<li>
					<a class="card" href={`/extensions/${ext.id}`}>
						<span class="ico"><Icon name={iconFor(ext.icon)} size={26} /></span>
						<span class="body">
							<span class="title-line">
								<span class="name">{ext.name}</span>
								<span class="chip kind">{KIND_LABELS[ext.kind]}</span>
							</span>
							<span class="desc">{ext.description}</span>
							<span class="meta">
								<span class="chip">{platformsLabel(ext.platforms)}</span>
								<span class="send">
									{ext.privacy.sends.length === 0
										? '外部へは何も送りません'
										: `送り先: ${ext.privacy.sends.map((s) => s.to.split(/[(（]/)[0]).join('、')}`}
								</span>
							</span>
						</span>
						<span class="more">詳しく <Icon name="arrow" size={16} /></span>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby="kinds">
		<h2 id="kinds" class="sec">拡張機能の種類</h2>
		<dl class="kinds">
			<div>
				<dt>公式</dt>
				<dd>Storift に同梱する拡張機能です(上の一覧)。この種類だけが、いま使えます。</dd>
			</div>
			<div>
				<dt>パック <span class="plan">予定</span></dt>
				<dd>
					テーマや辞書など、コードを含まない設定ファイルだけの拡張機能です。対応は今後の予定です。
				</dd>
			</div>
			<div>
				<dt>スクリプト <span class="plan">予定</span></dt>
				<dd>
					隔離した環境で動き、宣言した権限の範囲だけで本体とやり取りする拡張機能です。対応は今後の予定です。
				</dd>
			</div>
		</dl>
		<p class="lead">
			コミュニティの拡張機能は、今後、リポジトリで受け付けて、このページで紹介する予定です(まだ公開していません)。コミュニティの拡張機能は第三者が作るもので、運営者はそのデータを受け取りません。扱う情報は、作者の説明に従います。詳しくは<a
				href="/privacy">プライバシーポリシー</a
			>と<a href="/terms">利用規約</a>を参照してください。
		</p>
	</section>

	<div class="next">
		<p>拡張機能は、設定の「拡張機能」から有効にします。</p>
		<a class="btn secondary" href="/guide">使い方を見る</a>
		<a class="btn primary" href={APP_URL}>エディタを開く</a>
	</div>
</div>

<style>
	.sec {
		font-size: 1.15rem;
		letter-spacing: 0.04em;
		margin-bottom: 8px;
	}

	section + section {
		margin-top: 48px;
	}

	.lead {
		max-width: 46rem;
		color: var(--color-text-secondary);
		font-size: 14.5px;
	}

	.cards {
		display: grid;
		gap: 12px;
		margin-top: 16px;
		list-style: none;
		padding: 0;
	}

	.card {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		padding: 20px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: inherit;
		text-decoration: none;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}

	.card:hover {
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
		background: var(--hover);
	}

	.ico {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--color-border));
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-primary) 10%, var(--color-background));
		color: var(--color-primary);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.title-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.name {
		font-size: 1.05rem;
		font-weight: 600;
	}

	.desc {
		color: var(--color-text-secondary);
		font-size: 14px;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		font-size: 12.5px;
		color: var(--color-text-secondary);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		min-height: 22px;
		padding: 0 9px;
		white-space: nowrap;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.chip.kind {
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
		background: color-mix(in srgb, var(--color-primary) 9%, var(--color-background));
		color: var(--color-primary);
		font-weight: 600;
	}

	.more {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		align-self: center;
		font-size: 13px;
		color: var(--color-primary);
	}

	.kinds {
		display: grid;
		gap: 12px;
		margin: 16px 0;
		max-width: 46rem;
	}

	.kinds div {
		padding: 14px 16px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
	}

	.kinds dt {
		font-weight: 600;
		font-size: 14.5px;
	}

	.kinds dd {
		margin: 4px 0 0;
		color: var(--color-text-secondary);
		font-size: 14px;
	}

	.plan {
		margin-left: 6px;
		padding: 1px 7px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 11px;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	@media (max-width: 640px) {
		.card {
			flex-wrap: wrap;
		}

		.body {
			flex: 1 1 calc(100% - 64px);
		}

		.more {
			flex-basis: 100%;
			margin-left: 64px;
		}
	}
</style>
