<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import Icon from '$lib/Icon.svelte';
	import { APP_URL } from '$lib/config';
	import { extensions, type SiteExtension } from '$lib/extensions';
	import { CONTRIBUTION_LABELS, contributionKinds } from '$manifest';
	import { KIND_LABELS, ORIGIN_LABELS, platformsLabel } from '$manifest';
	import { icons, type IconName } from '$lib/icons';

	/** マニフェストのアイコン名がサイトの線画に無いときは、パズルの形にする */
	const iconFor = (name: string): IconName => (name in icons ? (name as IconName) : 'puzzle');

	const official = extensions.filter((e) => e.source === 'official');
	const community = extensions.filter((e) => e.source === 'community');
</script>

<Seo
	title="拡張機能"
	description="Storift の拡張機能の一覧。公式とコミュニティの拡張機能が、何を扱い、何を外部に送るのかを、一つずつ説明します。"
/>

{#snippet card(ext: SiteExtension)}
	<li>
		<a class="card" href={`/extensions/${ext.id}`}>
			<span class="ico"><Icon name={iconFor(ext.icon)} size={26} /></span>
			<span class="body">
				<span class="title-line">
					<span class="name">{ext.name}</span>
					<span class="chip kind">{KIND_LABELS[ext.kind]}</span>
					{#if ext.source === 'community'}
						<span class="chip origin">{ORIGIN_LABELS.community}</span>
					{/if}
				</span>
				<span class="desc">{ext.description}</span>
				<span class="meta">
					<span class="chip">{platformsLabel(ext.platforms)}</span>
					{#if ext.kind === 'pack'}
						{#each contributionKinds(ext.contributions) as kind (kind)}
							<span class="chip">{CONTRIBUTION_LABELS[kind]}</span>
						{/each}
					{/if}
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
{/snippet}

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
			{#each official as ext (ext.id)}{@render card(ext)}{/each}
		</ul>
	</section>

	<section aria-labelledby="community">
		<h2 id="community" class="sec">コミュニティの拡張機能</h2>
		<p class="lead">
			コミュニティの作者が作った拡張機能です。<strong>公式のものではありません。</strong
			>公式リポジトリへの提案(プルリクエスト)として受け付け、公開前に、ライセンス・内容・扱う情報の記述を確認しています。ただし、運営者は内容を保証しません。アプリの設定の「拡張機能」→「拡張機能を探す」から入れられます。
		</p>
		<ul class="cards">
			{#each community as ext (ext.id)}{@render card(ext)}{/each}
		</ul>
		{#if community.length === 0}
			<p class="lead">いまのところ、公開している拡張機能はありません。</p>
		{/if}
		<p class="lead submit">
			拡張機能を作って公開したい方は、<a href="/extensions/submit">拡張機能を投稿する</a
			>を参照してください。
		</p>
	</section>

	<section aria-labelledby="kinds">
		<h2 id="kinds" class="sec">拡張機能の種類</h2>
		<dl class="kinds">
			<div>
				<dt>公式</dt>
				<dd>Storift に同梱する拡張機能です(上の一覧)。</dd>
			</div>
			<div>
				<dt>パック</dt>
				<dd>
					テーマ・校正の辞書・入力補助キーなど、コードを含まない設定ファイル(JSON)だけの拡張機能です。通信せず、コードも実行しません。端末内にだけ保存し、同期やバックアップには含まれません。
				</dd>
			</div>
			<div>
				<dt>スクリプト</dt>
				<dd>
					隔離された環境(sandbox 付きの iframe の中の Web Worker)で動く、1 ファイルの JavaScript
					です。作品の本文・設定・API
					キーには触れず、宣言して利用者が同意したイベントと、宣言した通信先だけを使えます。ただし、通信先に送られた情報は取り消せません。既定は無効で、運営者は内容を保証しません。
				</dd>
			</div>
		</dl>
		<h3 class="sub">出所のラベル</h3>
		<p class="lead">
			アプリでは、拡張機能の出所を必ずラベルで示します。「コミュニティ(レビュー済み)」は、このページに載っている拡張機能です。「個人追加(未審査)」(ファイルから追加)と「個人フォルダ(未審査)」(デスクトップ版の拡張フォルダ)は、運営者もコミュニティも確認していないもので、公式のものではありません。内容を確認できるものだけを追加してください(自己責任)。詳しくは<a
				href="/privacy">プライバシーポリシー</a
			>と<a href="/terms">利用規約</a>を参照してください。
		</p>
	</section>

	<div class="next">
		<p>拡張機能は、設定の「拡張機能」から有効にします。</p>
		<a class="btn secondary" href="/extensions/submit">拡張機能を投稿する</a>
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
		overflow-wrap: anywhere;
		color: var(--color-text-secondary);
		font-size: 14px;
	}

	.meta {
		min-width: 0;
		overflow-wrap: anywhere;
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

	@media (max-width: 640px) {
		.card {
			flex-wrap: wrap;
		}

		.body {
			flex: 1 1 calc(100% - 64px);
		}

		.more {
			flex-basis: calc(100% - 64px);
			margin-left: 64px;
		}
	}

	.chip.origin {
		border-color: color-mix(
			in srgb,
			var(--color-info, var(--color-primary)) 45%,
			var(--color-border)
		);
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-primary) 4%, var(--color-background));
		font-weight: 600;
	}

	.sub {
		margin: 28px 0 8px;
		font-size: 1rem;
		letter-spacing: 0.04em;
	}

	.submit {
		margin-top: 16px;
	}
</style>
