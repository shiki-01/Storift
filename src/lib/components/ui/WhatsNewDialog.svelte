<script lang="ts">
	/**
	 * 更新情報のポップアップ。更新の直後(または設定から)開き、
	 * 「最新の更新」(今回新しくなった版の主な変更点。項目ごとに詳細を開ける)と
	 * 「すべての更新履歴」(過去の版の一覧)を切り替えて見られる。
	 */
	import { fade, scale } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';
	import { cubicOut } from 'svelte/easing';
	import { isDesktop } from '$lib/desktop/platform';
	import { whatsNewStore } from '$lib/stores/whatsNew.svelte';
	import {
		CHANGELOG_URL,
		RELEASES_URL,
		type InlinePart,
		type Release,
		type ReleaseItem
	} from '$lib/utils/releaseNotes';
	import Icon from './Icon.svelte';

	let tab = $state<'latest' | 'history'>('latest');
	/** 詳細を開いている項目(版:番号) */
	const expanded = new SvelteSet<string>();
	let dialogEl = $state<HTMLDivElement | null>(null);

	const releases = $derived(whatsNewStore.releases);
	const heading = $derived(
		whatsNewStore.mode === 'update'
			? `Storift v${whatsNewStore.currentVersion} に更新しました`
			: '更新情報'
	);

	$effect(() => {
		if (!whatsNewStore.open) return;
		tab = 'latest';
		expanded.clear();
		const returnTo = document.activeElement as HTMLElement | null;
		const frame = requestAnimationFrame(() =>
			dialogEl?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
		);
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.isComposing) return;
			e.preventDefault();
			whatsNewStore.close();
		};
		window.addEventListener('keydown', onKeydown);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('keydown', onKeydown);
			if (returnTo && !returnTo.isContentEditable) returnTo.focus?.({ preventScroll: true });
		};
	});

	function toggle(key: string) {
		if (expanded.has(key)) expanded.delete(key);
		else expanded.add(key);
	}

	function openLink(e: MouseEvent, href: string) {
		if (!isDesktop()) return;
		e.preventDefault();
		void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(href));
	}

	function onBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) whatsNewStore.close();
	}
</script>

{#snippet inline(parts: InlinePart[])}
	{#each parts as part, i (i)}
		{#if part.kind === 'strong'}<strong>{part.text}</strong>
		{:else if part.kind === 'code'}<code>{part.text}</code>
		{:else if part.kind === 'link'}<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 外部サイトへのリンク --><a
				href={part.href}
				target="_blank"
				rel="noopener noreferrer"
				onclick={(e) => openLink(e, part.href)}>{part.text}</a
			>
		{:else}{part.text}{/if}
	{/each}
{/snippet}

{#snippet itemView(release: Release, item: ReleaseItem, index: number)}
	{@const key = `${release.version}:${index}`}
	{@const isOpen = expanded.has(key)}
	<li class="item" class:open={isOpen}>
		<button
			type="button"
			class="item-head"
			aria-expanded={isOpen}
			aria-controls={`wn-${key}`}
			onclick={() => toggle(key)}
		>
			<span class="item-dot" aria-hidden="true"></span>
			<span class="item-text">
				{#if item.title}<span class="item-title">{item.title}</span>{/if}
				{#if !isOpen}<span class="item-summary">{item.summary}</span>{/if}
			</span>
			<span class="item-more">{isOpen ? '閉じる' : '詳細'}</span>
		</button>
		{#if isOpen}
			<p class="item-body selectable" id={`wn-${key}`}>{@render inline(item.body)}</p>
		{/if}
	</li>
{/snippet}

{#if whatsNewStore.open}
	<!-- Esc は window 側で処理している -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={onBackdrop} transition:fade={{ duration: 160 }}>
		<div
			bind:this={dialogEl}
			class="dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="whats-new-title"
			data-testid="whats-new"
			in:scale={{ start: 0.97, duration: 200, easing: cubicOut }}
			out:scale={{ start: 0.98, duration: 120 }}
		>
			<header class="hero">
				<div class="badge" aria-hidden="true"><Icon name="sparkles" /></div>
				<div class="hero-text">
					<p class="eyebrow">
						{whatsNewStore.mode === 'update'
							? 'アップデート'
							: `現在の版 v${whatsNewStore.currentVersion}`}
					</p>
					<h2 id="whats-new-title">{heading}</h2>
				</div>
				<button class="close" aria-label="閉じる" onclick={() => whatsNewStore.close()}>×</button>
			</header>

			<div class="tabs" role="tablist" aria-label="表示する内容">
				<button
					role="tab"
					class="tab"
					aria-selected={tab === 'latest'}
					onclick={() => (tab = 'latest')}>最新の更新</button
				>
				<button
					role="tab"
					class="tab"
					aria-selected={tab === 'history'}
					data-testid="whats-new-history"
					onclick={() => (tab = 'history')}>すべての更新履歴</button
				>
			</div>

			<div class="body" role="tabpanel">
				{#if tab === 'latest'}
					{#each releases as release (release.version)}
						<section class="release">
							<h3 class="release-version">
								v{release.version}
								{#if release.version === whatsNewStore.currentVersion}<span class="tag">この版</span
									>{/if}
							</h3>
							<ul class="items">
								{#each release.items as item, i (i)}
									{@render itemView(release, item, i)}
								{/each}
							</ul>
						</section>
					{/each}
				{:else}
					<div class="history">
						{#each whatsNewStore.all as release (release.version)}
							<details class="history-entry" open={release.version === releases[0]?.version}>
								<summary>
									<span class="release-version">v{release.version}</span>
									<span class="history-count">{release.items.length} 件の変更</span>
								</summary>
								<ul class="items">
									{#each release.items as item, i (i)}
										{@render itemView(release, item, i)}
									{/each}
								</ul>
							</details>
						{/each}
					</div>
				{/if}
			</div>

			<footer class="foot">
				<label class="pref">
					<input type="checkbox" bind:checked={whatsNewStore.showOnUpdate} />
					更新のあとにこの画面を表示する
				</label>
				<div class="foot-actions">
					<!-- eslint-disable svelte/no-navigation-without-resolve -- 外部サイトへのリンク -->
					<a
						class="link"
						href={isDesktop() ? RELEASES_URL : CHANGELOG_URL}
						target="_blank"
						rel="noopener noreferrer"
						onclick={(e) => openLink(e, isDesktop() ? RELEASES_URL : CHANGELOG_URL)}
						>{isDesktop() ? 'リリースノート' : '変更履歴の全文'}</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					<button class="primary" data-autofocus onclick={() => whatsNewStore.close()}
						>閉じる</button
					>
				</div>
			</footer>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 1100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: rgba(0, 0, 0, 0.32);
	}

	.dialog {
		display: flex;
		flex-direction: column;
		width: min(560px, 100%);
		max-height: min(720px, calc(100dvh - 32px));
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: var(--shadow-float);
	}

	.hero {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 20px 20px 16px;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--color-primary) 16%, var(--color-background)),
			var(--color-background) 70%
		);
	}

	.badge {
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: var(--color-primary);
		color: var(--color-background);
	}

	.badge :global(div),
	.badge :global(svg) {
		display: flex;
		width: 24px;
		height: 24px;
	}

	.hero-text {
		flex: 1;
		min-width: 0;
	}

	.eyebrow {
		margin: 0 0 2px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-primary);
	}

	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
		line-height: 1.35;
	}

	.close {
		flex: none;
		align-self: flex-start;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 22px;
		cursor: pointer;
	}

	.close:hover {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.tabs {
		display: flex;
		gap: 4px;
		padding: 0 20px;
		border-bottom: 1px solid var(--color-border);
	}

	.tab {
		padding: 10px 12px;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.tab[aria-selected='true'] {
		border-bottom-color: var(--color-primary);
		color: var(--color-text);
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 8px 20px 16px;
	}

	.release + .release {
		margin-top: 8px;
		border-top: 1px dashed var(--color-border);
	}

	.release-version {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 12px 0 6px;
		font-size: 13px;
		font-weight: 700;
		color: var(--color-text-secondary);
	}

	.tag {
		padding: 1px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-primary) 16%, transparent);
		color: var(--color-primary);
		font-size: 11px;
	}

	.items {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item + .item {
		border-top: 1px solid var(--color-border);
	}

	.item-head {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		padding: 10px 0;
		border: none;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.item-dot {
		flex: none;
		width: 6px;
		height: 6px;
		margin-top: 8px;
		border-radius: 50%;
		background: var(--color-primary);
	}

	.item-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.item-title {
		font-size: 14px;
		font-weight: 600;
	}

	.item-summary {
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.item-more {
		flex: none;
		margin-top: 2px;
		font-size: 12px;
		color: var(--color-primary);
	}

	.item-head:hover .item-more {
		text-decoration: underline;
	}

	.item-body {
		margin: -2px 0 12px 16px;
		font-size: 13px;
		line-height: 1.75;
		color: var(--color-text);
	}

	.item-body code {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--color-surface);
		font-size: 12px;
	}

	.item-body a,
	.link {
		color: var(--color-primary);
	}

	.history-entry {
		border-bottom: 1px solid var(--color-border);
	}

	.history-entry summary {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 4px 0;
		cursor: pointer;
	}

	.history-entry summary .release-version {
		margin: 8px 0;
		color: var(--color-text);
	}

	.history-count {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
		padding: 12px 20px;
		border-top: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.pref {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.foot-actions {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-left: auto;
		font-size: 13px;
	}

	.primary {
		padding: 8px 18px;
		border: none;
		border-radius: 8px;
		background: var(--color-primary);
		color: var(--color-background);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	@media (max-width: 480px) {
		.backdrop {
			align-items: flex-end;
			padding: 0;
		}

		.dialog {
			width: 100%;
			max-height: 88dvh;
			border-radius: 16px 16px 0 0;
			padding-bottom: var(--safe-bottom, 0px);
		}
	}
</style>
