<script lang="ts">
	// 拡張 1 つ分のカード。上から、アイコン・名前・種類・対応プラットフォーム・説明・有効/無効のスイッチ、
	// 「プライバシー」の開閉(マニフェストから生成)、拡張固有の設定。有効にするときは同意画面を挟む
	import ConsentDialog from '$lib/components/extensions/ConsentDialog.svelte';
	import ExtensionSettingsHost from '$lib/components/extensions/ExtensionSettingsHost.svelte';
	import PrivacyInfo from '$lib/components/extensions/PrivacyInfo.svelte';
	import IconBadge from '$lib/components/items/IconBadge.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { extensionHost } from '$lib/extensions/host.svelte';
	import { KIND_LABELS, PLATFORM_LABELS } from '$lib/extensions/manifest';
	import type { Extension } from '$lib/extensions/types';

	let { extension }: { extension: Extension } = $props();

	const manifest = $derived(extension.manifest);
	const id = $derived(manifest.id);
	const supported = $derived(extensionHost.isSupported(id));
	const enabled = $derived(supported && extensionHost.isEnabled(id));
	const status = $derived(extensionHost.consentStatus(id));
	const suspended = $derived(extensionHost.isSuspended(id));
	const needsReview = $derived(extensionHost.needsReview(id));

	let consentOpen = $state(false);
	let consentMode = $state<'enable' | 'review'>('enable');
	let busy = $state(false);

	function toggle(next: boolean) {
		if (!next) {
			busy = true;
			void extensionHost.setEnabled(id, false).finally(() => (busy = false));
			return;
		}
		consentMode = 'enable';
		consentOpen = true;
	}

	function review() {
		consentMode = 'review';
		consentOpen = true;
	}

	async function consent() {
		busy = true;
		try {
			await extensionHost.grantConsent(id);
			if (consentMode === 'enable') await extensionHost.setEnabled(id, true);
		} finally {
			busy = false;
		}
	}

	const reviewReason = $derived(
		status === 'changed'
			? 'この拡張が扱う情報が、同意したときから変わりました。内容を確認してください。'
			: status === 'version-changed'
				? 'この拡張が更新されました(扱う情報は同意したときと同じです)。'
				: 'この拡張は、同意の確認ができる前から有効にしています。扱う情報を確認してください。'
	);
</script>

<article
	class="ext-card"
	class:unsupported={!supported}
	data-testid={`ext-card-${id}`}
	aria-labelledby={`ext-title-${id}`}
>
	<header class="head">
		<IconBadge
			size={44}
			shape="square"
			tone={enabled ? 'primary' : 'neutral'}
			icon={manifest.icon}
		/>
		<div class="title-block">
			<div class="title-line">
				<h4 id={`ext-title-${id}`} class="name">{manifest.name}</h4>
				<span class="chip kind" data-kind={manifest.kind}>{KIND_LABELS[manifest.kind]}</span>
			</div>
			<ul class="platforms" aria-label="対応プラットフォーム">
				{#each manifest.platforms as p (p)}
					<li class="chip">{PLATFORM_LABELS[p]}</li>
				{/each}
				{#if manifest.platforms.length === 1}<li class="only">のみ</li>{/if}
			</ul>
		</div>
		<Switch
			id={`ext-${id}`}
			checked={enabled}
			disabled={!supported || busy}
			aria-labelledby={`ext-title-${id}`}
			onchange={toggle}
		/>
	</header>

	<p class="desc">{manifest.description}</p>

	{#if !supported}
		<p class="note" role="status">
			<Icon name="alert-triangle" class="note-ico" />
			この環境では使えません。{manifest.platforms
				.map((p) => PLATFORM_LABELS[p])
				.join('・')}で利用できます。
		</p>
	{:else if suspended}
		<div class="banner warn" role="alert">
			<p>扱う情報が変わったため、確認するまで停止しています。</p>
			<button type="button" class="banner-btn" onclick={review}>内容を確認して再開</button>
		</div>
	{:else if needsReview}
		<div class="banner" role="status" data-testid={`ext-review-${id}`}>
			<p>{reviewReason}</p>
			<button type="button" class="banner-btn" onclick={review}>内容を確認する</button>
		</div>
	{/if}

	<details class="privacy">
		<summary>
			<Icon name="shield-lock" class="sum-ico" />
			<span>プライバシー</span>
			<Icon name="chevron-down" class="chev" />
		</summary>
		<div class="privacy-body">
			<PrivacyInfo {manifest} />
		</div>
	</details>

	{#if enabled && !suspended && extension.settings}
		<div class="ext-settings">
			<h5 class="settings-title">{manifest.name}の設定</h5>
			<ExtensionSettingsHost {extension} />
		</div>
	{/if}
</article>

<ConsentDialog
	bind:open={consentOpen}
	{manifest}
	mode={consentMode}
	reason={consentMode === 'review' ? reviewReason : undefined}
	onconsent={consent}
/>

<style>
	.ext-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
	}

	.ext-card.unsupported {
		background: color-mix(in srgb, var(--color-surface) 45%, var(--color-background));
	}

	.ext-card.unsupported .head :global(.badge) {
		opacity: 0.6;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.title-block {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.title-line {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}

	.name {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 11px;
		line-height: 1;
		color: var(--color-text-secondary);
		background: color-mix(in srgb, var(--color-surface) 50%, var(--color-background));
	}

	.chip.kind {
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 9%, var(--color-background));
		font-weight: 600;
	}

	:root[data-scheme='dark'] .chip.kind {
		color: color-mix(in srgb, var(--color-primary) 65%, var(--color-text));
	}

	.platforms {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.only {
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.desc {
		margin: 0;
		font-size: 13px;
		line-height: 1.65;
		color: var(--color-text-secondary);
	}

	.note {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: 12.5px;
		color: var(--color-text-secondary);
	}

	.note :global(.note-ico) {
		width: 16px;
		height: 16px;
		flex: none;
	}

	.banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px 12px;
		padding: 10px 12px;
		border: 1px solid color-mix(in srgb, var(--color-warning) 55%, var(--color-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-warning) 9%, var(--color-background));
	}

	.banner p {
		margin: 0;
		flex: 1 1 14rem;
		font-size: 12.5px;
		line-height: 1.6;
	}

	.banner-btn {
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}

	.privacy {
		border-top: 1px solid var(--color-border);
		padding-top: 4px;
	}

	.privacy summary {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		list-style: none;
	}

	.privacy summary::-webkit-details-marker {
		display: none;
	}

	.privacy summary :global(.sum-ico) {
		width: 18px;
		height: 18px;
		color: var(--color-text-secondary);
	}

	.privacy summary :global(.chev) {
		width: 16px;
		height: 16px;
		margin-left: auto;
		color: var(--color-text-secondary);
		transition: transform 0.15s;
	}

	.privacy[open] summary :global(.chev) {
		transform: rotate(180deg);
	}

	.privacy-body {
		padding: 4px 0 8px;
	}

	.ext-settings {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 14px;
		border-top: 1px solid var(--color-border);
	}

	.settings-title {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	@media (prefers-reduced-motion: reduce) {
		.privacy summary :global(.chev) {
			transition: none;
		}
	}
</style>
