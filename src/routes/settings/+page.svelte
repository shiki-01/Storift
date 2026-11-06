<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { isDesktop } from '$lib/desktop/platform';
	import { isFirebaseInitialized } from '$lib/firebase/config';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { notificationService } from '$lib/services/notification.service';
	import { resolveSection, sectionHash, visibleSections } from '$lib/components/settings/sections';
	import { SettingsForm } from '$lib/components/settings/settingsForm.svelte';
	import AppearanceSection from '$lib/components/settings/AppearanceSection.svelte';
	import EditorSection from '$lib/components/settings/EditorSection.svelte';
	import SyncSection from '$lib/components/settings/SyncSection.svelte';
	import SharingSection from '$lib/components/settings/SharingSection.svelte';
	import AiSection from '$lib/components/settings/AiSection.svelte';
	import DataSection from '$lib/components/settings/DataSection.svelte';
	import AboutSection from '$lib/components/settings/AboutSection.svelte';

	// resolve() にはハッシュを渡せないので、解決したパスに hash を付けて使う
	const settingsPath = resolve('/settings');
	const desktop = isDesktop();
	const sections = visibleSections(desktop);

	// 各セクションが共有する、編集中の設定(セクションを切り替えても値が残る)
	const form = new SettingsForm();

	// 開いているセクションは URL の hash で決める(直接リンク・戻る/進むに対応)。旧 hash は読み替える
	let current = $derived(resolveSection(page.url.hash, desktop));

	let headingEl: HTMLHeadingElement | undefined = $state();
	let navEl: HTMLElement | undefined = $state();
	// 画面の読み上げ用。セクションを切り替えたときだけ知らせる
	let announcement = $state('');
	// サイドバー/タブの操作で切り替えたときだけ、見出しへフォーカスを移す
	let focusHeadingOnChange = false;
	let firstRun = true;

	$effect(() => {
		const label = current.label;
		if (firstRun) {
			firstRun = false;
			return;
		}
		announcement = `${label}を表示しています`;
		if (focusHeadingOnChange) {
			focusHeadingOnChange = false;
			void tick().then(() => headingEl?.focus({ preventScroll: true }));
		}
	});

	// 横スクロールのタブでは、開いているタブが見える位置までスクロールする
	$effect(() => {
		void current.id;
		void tick().then(() =>
			navEl
				?.querySelector('[aria-current="page"]')
				?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		);
	});

	// 矢印キーで、サイドバー/タブの項目間を移動する(Enter で開く)
	function onNavKeydown(e: KeyboardEvent) {
		const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
		if (!keys.includes(e.key) || !navEl) return;
		const links = Array.from(navEl.querySelectorAll<HTMLAnchorElement>('a'));
		const index = links.indexOf(document.activeElement as HTMLAnchorElement);
		if (index < 0) return;
		e.preventDefault();
		const last = links.length - 1;
		const next =
			e.key === 'Home'
				? 0
				: e.key === 'End'
					? last
					: e.key === 'ArrowDown' || e.key === 'ArrowRight'
						? Math.min(index + 1, last)
						: Math.max(index - 1, 0);
		links[next].focus();
		// 狭い幅(横スクロール)でも、フォーカスした項目が見えるようにする
		links[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	onMount(() => {
		notificationService.initializeReminders();
		return () => {
			notificationService.cleanup();
		};
	});

	// ページ読み込み時に設定を読み込む
	$effect(() => {
		(async () => {
			await form.load();
			// 設定読み込み後、同期状態を確認
			if (typeof window !== 'undefined' && isFirebaseInitialized() && form.settings.syncEnabled) {
				// 同期が有効な場合、現在のプロジェクトがあれば同期を確保
				const projectId = currentProjectStore.project?.id;
				if (projectId && syncStore.status === 'offline') {
					console.log('🔄 Restoring sync on settings page');
					const { startCurrentProjectSync } = await import('$lib/services/sync.service');
					await startCurrentProjectSync(projectId);
				}
			}
		})();
	});
</script>

<div class="settings-scroll">
	<div class="settings-page">
		<h1 class="settings-title">設定</h1>

		<div class="settings-layout">
			<!-- 広い画面では左のサイドバー、狭い画面では上部の横スクロールのタブ -->
			<nav class="settings-nav" aria-label="設定のセクション" bind:this={navEl}>
				<ul class="nav-list">
					{#each sections as section (section.id)}
						{@const active = section.id === current.id}
						<li>
							<!-- eslint-disable svelte/no-navigation-without-resolve -- 同じページ内の hash リンク(パスは resolve() 済み) -->
							<a
								href={`${settingsPath}${sectionHash(section.id)}`}
								class="nav-item"
								class:active
								aria-current={active ? 'page' : undefined}
								data-section={section.id}
								data-sveltekit-noscroll
								onkeydown={onNavKeydown}
								onclick={() => {
									if (!active) focusHeadingOnChange = true;
								}}
							>
								<svg
									viewBox="0 0 24 24"
									width="18"
									height="18"
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- 固定のアイコン定義 -->
									{@html section.icon}
								</svg>
								<span class="nav-label">{section.label}</span>
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</li>
					{/each}
				</ul>
			</nav>

			<div class="settings-content" data-section-panel={current.id}>
				<header class="section-head">
					<h2 class="section-title" tabindex="-1" bind:this={headingEl}>{current.label}</h2>
					<p class="section-desc">{current.description}</p>
				</header>

				<div class="section-body">
					{#if current.id === 'appearance'}
						<AppearanceSection {form} />
					{:else if current.id === 'editor'}
						<EditorSection {form} />
					{:else if current.id === 'sync'}
						<SyncSection {form} />
					{:else if current.id === 'sharing'}
						<SharingSection />
					{:else if current.id === 'ai'}
						<AiSection />
					{:else if current.id === 'data'}
						<DataSection />
					{:else if current.id === 'about'}
						<AboutSection />
					{/if}
				</div>
			</div>
		</div>

		<p class="sr-only" role="status" aria-live="polite">{announcement}</p>
	</div>
</div>

<style>
	.settings-scroll {
		height: 100%;
		overflow-y: auto;
	}

	.settings-page {
		max-width: 62rem;
		margin: 0 auto;
		padding: 40px 48px 80px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.settings-title {
		margin: 0 0 8px;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.settings-layout {
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr);
		gap: 32px;
		align-items: start;
	}

	/* サイドバー: ページ内をスクロールしても追従する */
	.settings-nav {
		position: sticky;
		top: 24px;
	}

	.nav-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		border-radius: 8px;
		color: var(--color-text-secondary);
		font-size: 14px;
		text-decoration: none;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.nav-item:hover {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.nav-item.active {
		background: var(--color-surface);
		color: var(--color-primary);
		font-weight: 600;
	}

	.nav-item:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.nav-item svg {
		flex: none;
	}

	.settings-content {
		display: flex;
		flex-direction: column;
		gap: 20px;
		min-width: 0;
	}

	.section-head {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.section-title {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		letter-spacing: 0.03em;
	}

	/* フォーカスは切り替えの合図なので、枠は出さない */
	.section-title:focus {
		outline: none;
	}

	.section-desc {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.section-body {
		display: flex;
		flex-direction: column;
		gap: 20px;
		min-width: 0;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-item {
			transition: none;
		}
	}

	@media (max-width: 768px) {
		.settings-page {
			padding: 20px 16px 40px;
			gap: 12px;
		}

		.settings-layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 16px;
		}

		/* 上部に横スクロールのタブとして固定する */
		.settings-nav {
			top: 0;
			z-index: 5;
			margin: 0 -16px;
			padding: 0 16px;
			background: var(--color-background);
			border-bottom: 1px solid var(--color-border);
			overflow-x: auto;
			scrollbar-width: none;
		}

		.settings-nav::-webkit-scrollbar {
			display: none;
		}

		.nav-list {
			flex-direction: row;
			gap: 4px;
			width: max-content;
			padding: 6px 0;
		}

		.nav-item {
			white-space: nowrap;
			padding: 8px 12px;
		}
	}
</style>
