<script lang="ts">
	// 拡張 1 つ分のカード。上から、アイコン・名前・種類・対応プラットフォーム・説明・有効/無効のスイッチ、
	// 「プライバシー」の開閉(マニフェストから生成)、拡張固有の設定。有効にするときは同意画面を挟む
	import ConsentDialog from '$lib/components/extensions/ConsentDialog.svelte';
	import ExtensionSettingsHost from '$lib/components/extensions/ExtensionSettingsHost.svelte';
	import ContributionSummary from '$lib/components/extensions/ContributionSummary.svelte';
	import OriginBadge from '$lib/components/extensions/OriginBadge.svelte';
	import PrivacyInfo from '$lib/components/extensions/PrivacyInfo.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconBadge from '$lib/components/items/IconBadge.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { extensionHost } from '$lib/extensions/host.svelte';
	import { KIND_LABELS, PLATFORM_LABELS } from '$lib/extensions/manifest';
	import { packManager } from '$lib/extensions/packManager.svelte';
	import { STOP_MESSAGES } from '$lib/extensions/script/bridge';
	import { scriptRuntime } from '$lib/extensions/script/scriptRuntime.svelte';
	import { registryState } from '$lib/extensions/registryState.svelte';
	import type { Extension } from '$lib/extensions/types';
	import { confirmDialog, toast } from '$lib/stores/toast.svelte';

	let { extension }: { extension: Extension } = $props();

	const manifest = $derived(extension.manifest);
	const id = $derived(manifest.id);
	const isScript = $derived(manifest.kind === 'script');
	// スクリプトは、隔離して実行できる環境でだけ動かす(できなければ、実行せず「この環境では実行できません」)
	const sandboxOk = $derived(!isScript || scriptRuntime.supported);
	const supported = $derived(extensionHost.isSupported(id));
	const enabled = $derived(supported && extensionHost.isEnabled(id));
	const revoked = $derived(extensionHost.revocationOf(id));
	const scriptState = $derived(isScript ? scriptRuntime.state(id) : undefined);
	const autoDisabled = $derived(isScript ? scriptRuntime.autoDisabledReason(id) : undefined);
	const status = $derived(extensionHost.consentStatus(id));
	const suspended = $derived(extensionHost.isSuspended(id));
	const needsReview = $derived(extensionHost.needsReview(id));
	const origin = $derived(extension.origin ?? 'official');
	const isPack = $derived(manifest.kind === 'pack');
	// アンインストールできる(あとから追加した)拡張
	const isAdded = $derived(manifest.kind === 'pack' || manifest.kind === 'script');
	// 手動で取得した一覧に、新しい版があるとき(「更新を確認」で取得したあと)
	const latest = $derived(registryState.entry(id));
	const updatable = $derived(!!latest && packManager.updateAvailable(latest));

	async function uninstall() {
		const ok = await confirmDialog({
			title: origin === 'personal-folder' ? '読み込みを外す' : '拡張機能のアンインストール',
			message:
				origin === 'personal-folder'
					? `「${manifest.name}」の読み込みを外します。フォルダのファイルは削除しません(再読み込みで、また読み込まれます)。`
					: `「${manifest.name}」をアンインストールします。この端末に保存した内容を削除し、使っていた機能は止まります。`,
			confirmText: origin === 'personal-folder' ? '外す' : 'アンインストール',
			danger: true
		});
		if (!ok) return;
		busy = true;
		try {
			await packManager.uninstall(id);
			toast.success(`「${manifest.name}」をアンインストールしました`);
		} finally {
			busy = false;
		}
	}

	async function update() {
		if (!latest) return;
		busy = true;
		try {
			const result = await packManager.installFromRegistry(latest);
			if (result.reconsent) {
				toast.info('扱う情報が変わりました。内容を確認してください');
				review();
			} else {
				toast.success(`「${manifest.name}」を ${latest.version} に更新しました`);
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '更新できませんでした');
		} finally {
			busy = false;
		}
	}

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
				{#if origin !== 'official'}<OriginBadge {origin} />{/if}
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
			disabled={!supported || !sandboxOk || !!revoked || busy}
			aria-labelledby={`ext-title-${id}`}
			onchange={toggle}
		/>
	</header>

	<p class="desc">{manifest.description}</p>

	{#if isPack}
		<ContributionSummary contributions={manifest.contributions} content={extension.content} />
	{/if}

	{#if !supported}
		<p class="note" role="status">
			<Icon name="alert-triangle" class="note-ico" />
			この環境では使えません。{manifest.platforms
				.map((p) => PLATFORM_LABELS[p])
				.join('・')}で利用できます。
		</p>
	{:else if revoked}
		<div class="banner danger" role="alert" data-testid={`ext-revoked-${id}`}>
			<p>
				<b>運営により失効されました。</b>この版は有効にできません。理由: {revoked.reason}
			</p>
		</div>
	{:else if !sandboxOk}
		<p class="note" role="status" data-testid={`ext-unsupported-${id}`}>
			<Icon name="alert-triangle" class="note-ico" />
			この環境では実行できません(スクリプトを隔離して動かす機能が使えません)。
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

	{#if isScript && enabled && !suspended && !revoked}
		{#if scriptState?.status === 'stopped'}
			<div class="banner warn" role="alert" data-testid={`ext-stopped-${id}`}>
				<p>
					<b>停止しています。</b>{scriptState.reason ? STOP_MESSAGES[scriptState.reason] : ''}
				</p>
				<button
					type="button"
					class="banner-btn"
					data-testid={`ext-restart-${id}`}
					onclick={() => scriptRuntime.restart(id)}>再開</button
				>
			</div>
		{:else if scriptState?.status === 'unsupported'}
			<p class="note" role="status">
				<Icon name="alert-triangle" class="note-ico" />
				この環境では実行できません(隔離された環境でスクリプトを起動できませんでした)。
			</p>
		{/if}
	{:else if isScript && autoDisabled}
		<div class="banner warn" role="alert" data-testid={`ext-autodisabled-${id}`}>
			<p>
				<b>続けて停止したため、無効にしました。</b>{STOP_MESSAGES[
					autoDisabled
				]}。内容を確認してから、もう一度有効にしてください。
			</p>
		</div>
	{/if}

	{#if updatable && latest}
		<div class="banner info" role="status" data-testid={`ext-update-${id}`}>
			<p>新しい版 {latest.version} があります(いまは {manifest.version})。</p>
			<button type="button" class="banner-btn" disabled={busy} onclick={update}>更新</button>
		</div>
	{/if}

	<details class="privacy">
		<summary>
			<Icon name="shield-lock" class="sum-ico" />
			<span>プライバシー</span>
			<Icon name="chevron-down" class="chev" />
		</summary>
		<div class="privacy-body">
			<PrivacyInfo {manifest} {origin} content={extension.content} />
		</div>
	</details>

	{#if isAdded}
		<div class="pack-foot">
			<span class="pack-meta"
				>版 {manifest.version}{#if manifest.license}・{manifest.license}{/if}・作者 {manifest.author}</span
			>
			<Button
				variant="ghost"
				size="sm"
				disabled={busy}
				onclick={uninstall}
				data-testid={`ext-uninstall-${id}`}
			>
				{origin === 'personal-folder' ? '読み込みを外す' : 'アンインストール'}
			</Button>
		</div>
	{/if}

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
	{origin}
	content={extension.content}
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

	.banner.danger {
		border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border));
		background: color-mix(in srgb, var(--color-error) 8%, var(--color-background));
	}

	.banner.info {
		border-color: color-mix(in srgb, var(--color-info) 50%, var(--color-border));
		background: color-mix(in srgb, var(--color-info) 8%, var(--color-background));
	}

	.pack-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 4px 12px;
		padding-top: 8px;
		border-top: 1px solid var(--color-border);
	}

	.pack-meta {
		font-size: 12px;
		color: var(--color-text-secondary);
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
