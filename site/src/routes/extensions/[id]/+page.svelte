<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import Icon from '$lib/Icon.svelte';
	import { APP_URL, RELEASES_URL } from '$lib/config';
	import { icons, type IconName } from '$lib/icons';
	import {
		CONTRIBUTION_LABELS,
		KIND_LABELS,
		ORIGIN_LABELS,
		ORIGIN_NOTES,
		PLATFORM_LABELS,
		contributionKinds,
		platformsLabel,
		summarizePermissions
	} from '$manifest';
	import { bundleUrl, sourceUrl } from '$lib/extensions';

	let { data } = $props();

	const ext = $derived(data.extension);
	const summary = $derived(summarizePermissions(ext.permissions));
	const iconName = $derived<IconName>(ext.icon in icons ? (ext.icon as IconName) : 'puzzle');
	const webAvailable = $derived(ext.platforms.includes('web'));
	const community = $derived(ext.source === 'community');
	const contributes = $derived(contributionKinds(ext.contributions));
</script>

<Seo
	title={`${ext.name}(拡張機能)`}
	description={`${ext.description} この拡張が扱う情報(送る項目・送り先・保存場所・解除時の扱い)を説明します。`}
/>

<div class="wrap">
	<nav class="crumb" aria-label="パンくず">
		<a href="/extensions">拡張機能</a><span aria-hidden="true">/</span><span>{ext.name}</span>
	</nav>

	<div class="page-head">
		<div class="head-row">
			<span class="ico"><Icon name={iconName} size={28} /></span>
			<div>
				<p class="label">拡張機能</p>
				<h1>{ext.name}</h1>
			</div>
		</div>
		<p>{ext.description}</p>
		<ul class="facts" aria-label="拡張の情報">
			<li class="chip kind">{KIND_LABELS[ext.kind]}</li>
			{#if community}<li class="chip origin">{ORIGIN_LABELS.community}</li>{/if}
			<li class="chip">{platformsLabel(ext.platforms)}</li>
			<li class="chip">版 {ext.version}</li>
			<li class="chip">作者: {ext.author}</li>
			{#if ext.license}<li class="chip">{ext.license}</li>{/if}
		</ul>
	</div>

	<div class="doc">
		{#if community}
			<section aria-labelledby="origin-h">
				<h2 id="origin-h">出所</h2>
				<p class="policy">{ORIGIN_NOTES.community}</p>
				<p>
					この拡張は、公式リポジトリの <a href={sourceUrl(ext.id)} rel="noopener noreferrer"
						>extensions/{ext.id}/</a
					>
					で公開されています。作者: {ext.author}。
				</p>
			</section>
		{/if}

		<section>
			<h2>使い方</h2>
			{#if community}
				<p>
					Storift の設定の「拡張機能」→「拡張機能を探す」で「{ext.name}」を探し、「インストール」を押します。インストールすると、下の「この拡張が扱う情報」と同じ内容が確認画面に出るので、同意すると有効になります。インストールしただけでは有効になりません。
				</p>
				<p>
					ファイルから追加する場合は、<a href={bundleUrl(ext)} download
						>バンドル(.storiftext.json)</a
					>を保存して、設定の「ファイルから追加」で選びます(その場合の出所は「個人追加(未審査)」と表示されます)。
				</p>
			{:else}
				<p>
					Storift
					の設定の「拡張機能」で、この拡張のスイッチを入れます。有効にするときに、下の「この拡張が扱う情報」と同じ内容が確認画面に出るので、同意すると有効になります。既定では無効です。
				</p>
			{/if}
			<p>
				対応している環境: {ext.platforms
					.map((p) => PLATFORM_LABELS[p])
					.join('・')}{#if !webAvailable}(Web
					版では使えず、設定の一覧には「デスクトップ版のみ」と表示されます){/if}。
			</p>
		</section>

		{#if contributes.length > 0}
			<section aria-labelledby="contrib-h">
				<h2 id="contrib-h">この拡張が追加するもの</h2>
				<ul>
					{#each contributes as kind (kind)}<li>{CONTRIBUTION_LABELS[kind]}</li>{/each}
				</ul>
				<p>
					パックはコードを含まない設定ファイル(JSON)だけで、通信せず、コードも実行しません。作品の本文は読み取りません。
				</p>
			</section>
		{/if}

		<section id="privacy" aria-labelledby="privacy-h">
			<h2 id="privacy-h">この拡張が扱う情報</h2>
			<p class="policy">
				このページの「この拡張が扱う情報」は、<a href="/privacy">プライバシーポリシー</a
				>の一部です。この拡張を有効にした場合は、ここに記載した範囲で、情報が{#if ext.privacy.sends.length === 0}扱われます(外部へは送信されません){:else}外部へ送信されます{/if}。
			</p>

			<h3>送る情報</h3>
			{#if ext.privacy.sends.length === 0}
				<p>外部へは何も送りません。</p>
			{:else}
				{#each ext.privacy.sends as send, i (i)}
					<div class="send">
						<p class="to"><span class="key">送り先</span>{send.to}</p>
						<ul>
							{#each send.items as item, j (j)}<li>{item}</li>{/each}
						</ul>
						<p><span class="key">いつ</span>{send.when}</p>
					</div>
				{/each}
			{/if}

			<h3>この端末に保存するもの</h3>
			{#if ext.privacy.stores.length === 0}
				<p>保存しません。</p>
			{:else}
				<ul>
					{#each ext.privacy.stores as store, i (i)}<li>{store}</li>{/each}
				</ul>
			{/if}

			<h3>無効にしたとき・連携を解除したとき</h3>
			<p>{ext.privacy.onDisable}</p>

			{#if ext.privacy.notes?.length}
				<h3>補足</h3>
				<ul>
					{#each ext.privacy.notes as note, i (i)}<li>{note}</li>{/each}
				</ul>
			{/if}
		</section>

		<section aria-labelledby="perm-h">
			<h2 id="perm-h">権限</h2>
			<p>この拡張は、次の範囲でだけ Storift とやり取りします。宣言していないものは使えません。</p>
			<ul>
				{#each summary.receives as item, i (i)}<li>受け取る: {item}</li>{/each}
				{#if summary.network.length > 0}
					<li>通信できる相手: {summary.network.join(' / ')}(ホスト名の完全一致)</li>
				{/if}
				{#if ext.kind === 'pack'}<li>通信: しません(コードも実行しません)</li>{/if}
				{#if summary.storage}<li>端末内への保存: 設定などを保存します</li>{/if}
			</ul>
		</section>

		<section aria-labelledby="terms-h">
			<h2 id="terms-h">規約など</h2>
			<ul>
				<li>
					<a href="/privacy">プライバシーポリシー</a>(このページの「この拡張が扱う情報」を含みます)
				</li>
				<li><a href="/terms">利用規約</a></li>
				{#if ext.homepage}
					<li>
						{ext.kind === 'official' ? '連携先' : '作者のページ'}:
						<a href={ext.homepage} rel="noopener noreferrer">{ext.homepage}</a>
					</li>
				{/if}
			</ul>
		</section>
	</div>

	<div class="next">
		<p><a href="/extensions">拡張機能の一覧</a>に戻る</p>
		{#if webAvailable}
			<a class="btn primary" href={APP_URL}>エディタを開く</a>
		{:else}
			<a class="btn primary" href={RELEASES_URL}>デスクトップ版を入手</a>
		{/if}
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

	.head-row {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.ico {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		height: 52px;
		border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--color-border));
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-primary) 10%, var(--color-background));
		color: var(--color-primary);
	}

	ul.facts {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 14px;
		padding: 0;
		list-style: none;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		height: 24px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 12.5px;
		color: var(--color-text-secondary);
	}

	.chip.origin {
		border-color: color-mix(in srgb, var(--color-text) 30%, var(--color-border));
		color: var(--color-text);
		font-weight: 600;
	}

	.chip.kind {
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
		background: color-mix(in srgb, var(--color-primary) 9%, var(--color-background));
		color: var(--color-primary);
		font-weight: 600;
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

	h3 {
		margin: 22px 0 8px;
		font-size: 0.95rem;
		letter-spacing: 0.04em;
	}

	section p,
	section li {
		color: var(--color-text-secondary);
		font-size: 14.5px;
	}

	section p + p {
		margin-top: 10px;
	}

	.policy {
		padding: 12px 14px;
		border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-primary) 6%, var(--color-background));
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-left: 1.3em;
		list-style: disc;
	}

	.send {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 10px;
		padding: 14px 16px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: color-mix(in srgb, var(--color-surface) 50%, var(--color-background));
	}

	.send .to {
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.key {
		display: inline-block;
		margin-right: 8px;
		padding: 0 7px;
		border-radius: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}
</style>
