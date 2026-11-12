<script lang="ts">
	// 拡張のマニフェスト(permissions / privacy)から作る「この拡張が扱う情報」。
	// 設定画面のカードの「プライバシー」と、有効にするときの同意画面で同じ表示を使う
	import { isDesktop } from '$lib/desktop/platform';
	import { extensionPageUrl } from '$lib/extensions/links';
	import {
		ORIGIN_NOTES,
		summarizePermissions,
		type ExtensionManifest,
		type ExtensionOrigin
	} from '$lib/extensions/manifest';
	import type { PackContent } from '$lib/extensions/pack';
	import ContributionSummary from './ContributionSummary.svelte';
	import OriginBadge from './OriginBadge.svelte';

	interface Props {
		manifest: ExtensionManifest;
		/** 紹介サイトの拡張ページへのリンクを出すか */
		showLink?: boolean;
		/** 出所。公式以外は、出所のラベルと注意を出す */
		origin?: ExtensionOrigin;
		/** パックのコンテンツ(あれば、追加するものの件数を出す) */
		content?: PackContent;
	}

	let { manifest, showLink = true, origin = 'official', content }: Props = $props();

	const summary = $derived(summarizePermissions(manifest.permissions));
	const pageUrl = $derived(extensionPageUrl(manifest.id));

	function openPage(e: MouseEvent) {
		if (!isDesktop()) return;
		e.preventDefault();
		void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(pageUrl));
	}
</script>

<div class="info selectable">
	{#if origin !== 'official'}
		<section class="origin-note" data-testid="origin-note">
			<h4>出所 <OriginBadge {origin} /></h4>
			<p>{ORIGIN_NOTES[origin]}</p>
			<p class="meta">
				作者: {manifest.author}{#if manifest.license}・ライセンス: {manifest.license}{/if}・版 {manifest.version}
			</p>
		</section>
	{/if}

	{#if manifest.contributions}
		<section>
			<h4>この拡張が追加するもの</h4>
			<ContributionSummary contributions={manifest.contributions} {content} />
		</section>
	{/if}

	<section>
		<h4>送る情報</h4>
		{#if manifest.privacy.sends.length === 0}
			<p>外部へは何も送りません。</p>
		{:else}
			{#each manifest.privacy.sends as send, i (i)}
				<div class="send">
					<p class="to"><span class="key">送り先</span>{send.to}</p>
					<ul>
						{#each send.items as item, j (j)}<li>{item}</li>{/each}
					</ul>
					<p class="when"><span class="key">いつ</span>{send.when}</p>
				</div>
			{/each}
		{/if}
	</section>

	<section>
		<h4>この端末に保存するもの</h4>
		{#if manifest.privacy.stores.length === 0}
			<p>保存しません。</p>
		{:else}
			<ul>
				{#each manifest.privacy.stores as store, i (i)}<li>{store}</li>{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h4>Storift から受け取る情報と通信先</h4>
		<ul>
			{#each summary.receives as item, i (i)}<li>{item}</li>{/each}
			{#if summary.receives.length === 0}<li>なし</li>{/if}
		</ul>
		{#if summary.network.length > 0}
			<p class="hosts"><span class="key">通信先</span>{summary.network.join(' / ')}</p>
		{/if}
	</section>

	<section>
		<h4>無効にしたとき</h4>
		<p>{manifest.privacy.onDisable}</p>
	</section>

	{#if manifest.privacy.notes?.length}
		<section>
			<h4>補足</h4>
			<ul>
				{#each manifest.privacy.notes as note, i (i)}<li>{note}</li>{/each}
			</ul>
		</section>
	{/if}

	{#if showLink}
		<p class="link">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 外部サイトへのリンク -->
			<a href={pageUrl} target="_blank" rel="noopener noreferrer" onclick={openPage}
				>拡張ページで詳しく見る(プライバシーポリシーの一部です)</a
			>
		</p>
	{/if}
</div>

<style>
	.info {
		display: flex;
		flex-direction: column;
		gap: 16px;
		font-size: 13px;
		line-height: 1.65;
		color: var(--color-text-secondary);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	h4 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-text);
	}

	p {
		margin: 0;
	}

	ul {
		margin: 0;
		padding-left: 1.2em;
		list-style: disc;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.send {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-surface) 55%, var(--color-background));
	}

	.origin-note {
		padding: 10px 12px;
		border: 1px solid color-mix(in srgb, var(--color-warning) 50%, var(--color-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-warning) 7%, var(--color-background));
	}

	.meta {
		font-size: 12px;
	}

	.send + .send {
		margin-top: 4px;
	}

	.key {
		display: inline-block;
		margin-right: 8px;
		padding: 0 6px;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	.to {
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.link a {
		color: var(--color-primary);
	}

	:root[data-scheme='dark'] .link a {
		color: color-mix(in srgb, var(--color-primary) 70%, var(--color-text));
	}
</style>
