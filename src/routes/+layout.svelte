<script lang="ts">
	import '../app.css';
	import { logo } from '$lib/assets/logo';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import {
		startNetworkMonitoring,
		stopNetworkMonitoring,
		onNetworkStatusChange
	} from '$lib/utils/offline';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { initializeSync, stopSync } from '$lib/services/sync.service';
	import { settingsDB } from '$lib/db';
	import { initializeFirebase, signInAnonymousUser, isFirebaseInitialized } from '$lib/firebase';
	import { authStore } from '$lib/stores/auth.svelte';
	import { viewport, initViewport } from '$lib/stores/viewport.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { registerServiceWorker, checkForUpdate } from '$lib/utils/sw-register';
	import { updated } from '$app/state';
	import { initializeErrorHandler } from '$lib/utils/errorHandler';
	import SyncStatus from '$lib/components/ui/SyncStatus.svelte';
	import ToastHost from '$lib/components/ui/ToastHost.svelte';
	import ConflictHost from '$lib/components/ui/ConflictHost.svelte';
	import { themes, themeStore } from '$lib/stores/theme.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { claudeStore } from '$lib/stores/claude.svelte';
	import TitleBar from '$lib/components/desktop/TitleBar.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import SelectionAsk from '$lib/components/desktop/SelectionAsk.svelte';
	import EditorDiff from '$lib/components/desktop/EditorDiff.svelte';
	import AppRail from '$lib/components/layout/AppRail.svelte';
	import { projectNavItems, navIcons } from '$lib/components/layout/nav';

	let { children } = $props();

	// デスクトップ版(Tauri)だけ、Claude Code のパネル(執筆画面)と自前のタイトルバーを使う
	const desktop = isDesktop();

	function onGlobalKeydown(e: KeyboardEvent) {
		// Ctrl(Cmd)+Shift+L でパネルの開閉
		if (desktop && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
			e.preventDefault();
			claudeStore.toggle();
		}
	}

	// 配信元に新しいバージョンが出たことを検知したら、すぐ Service Worker の更新を確認する
	$effect(() => {
		if (updated.current) void checkForUpdate();
	});

	// プロジェクトページかどうかを判定
	let isProjectPage = $derived($page.url.pathname.startsWith('/project/'));
	let projectId = $derived($page.params.id || '');

	function isActive(path: string): boolean {
		return $page.url.pathname.includes(`/project/${projectId}/${path}`);
	}

	// ページタイトル(タブ名)
	const staticTitles: Record<string, string> = {
		'/home': 'ホーム',
		'/settings': '設定',
		'/setup': 'セットアップ'
	};
	let sectionLabel = $derived.by(() => {
		const path = $page.url.pathname;
		if (isProjectPage) {
			return projectNavItems.find((item) => path.includes(`/project/${projectId}/${item.path}`))
				?.label;
		}
		return staticTitles[path];
	});
	// タイトルバーには作品名と画面名を出す
	let windowTitle = $derived.by(() => {
		const project = isProjectPage ? currentProjectStore.project?.title : '';
		return [project, sectionLabel].filter(Boolean).join(' — ') || 'Storift';
	});

	// 画面が切り替わった時だけ、ふわっと出す。作品の中の移動ではプロジェクトの読み込みをやり直さない
	let pageKey = $derived(isProjectPage ? `project/${projectId}` : $page.url.pathname);

	let pageTitle = $derived(
		sectionLabel ? `${sectionLabel} - Storift` : 'Storift - 小説執筆PWAアプリ'
	);

	// デスクトップは左端のレールで画面を切り替える(上部ヘッダーは持たない)。
	// スマホは細い上部バーを出すが、エディタは専用の上部バーを自前で持つため出さない
	let isEditorRoute = $derived(isProjectPage && $page.url.pathname.endsWith('/editor'));
	let showRail = $derived(!viewport.isMobile && !editorStore.focusMode);
	let showMobileHeader = $derived(viewport.isMobile && !isEditorRoute && !editorStore.focusMode);
	let showBottomNav = $derived(
		viewport.isMobile && isProjectPage && !viewport.isKeyboardOpen && !editorStore.focusMode
	);

	// キーボード表示中は画面全体を visualViewport に合わせ、入力欄がキーボードに隠れないようにする
	let shellStyle = $derived(
		viewport.isMobile && viewport.isKeyboardOpen
			? `height:${viewport.height}px;transform:translateY(${viewport.offsetTop}px);`
			: ''
	);

	onMount(() => {
		// ビューポート(スマホ判定・キーボード高さ)の監視を開始
		const stopViewport = initViewport();

		// グローバルエラーハンドラーを初期化
		initializeErrorHandler();

		// Service Workerを登録（開発環境では既存のSWを削除）
		// デスクトップ版はファイルをアプリに同梱しているので使わない
		if (typeof window !== 'undefined' && !desktop) {
			registerServiceWorker().catch((error) => {
				console.error('Service Worker operation failed:', error);
			});
		}

		// Firebaseと同期システムを初期化(非同期で実行)
		(async () => {
			try {
				// Firebaseが既に初期化されている場合、設定チェックはスキップ
				if (isFirebaseInitialized()) {
					console.log('✅ Firebase already initialized');
					// 同期システムは既に初期化されているはずだが、念のため確認
					await initializeSync();
					return;
				}

				// 保存されたFirebase設定を読み込み
				const config = await settingsDB.getFirebaseConfig();

				if (config) {
					// Firebaseを初期化
					initializeFirebase(config);

					// 匿名ログイン
					const user = await signInAnonymousUser();
					authStore.user = user;
					authStore.isInitialized = true;

					console.log('✅ Firebase initialized on app load');

					// Firebase初期化成功後に同期システムを初期化
					await initializeSync();
				} else {
					console.log('ℹ️ No Firebase config found, running in offline mode');
					syncStore.status = 'offline';
				}
			} catch (error) {
				console.error('Failed to initialize Firebase/Sync:', error);
				syncStore.status = 'offline';
				// Firebaseなしでもアプリは動作する
			}
		})();

		// ネットワーク監視を開始
		startNetworkMonitoring();

		// ネットワーク状態の変更を監視
		const unsubscribe = onNetworkStatusChange((status) => {
			if (status === 'offline') {
				syncStore.status = 'offline';
			} else if (syncStore.status === 'offline') {
				// オフラインから復帰した場合のみオンラインに変更
				syncStore.status = 'synced';
			}
		});

		// クリーンアップ
		return () => {
			stopViewport();
			unsubscribe();
			stopNetworkMonitoring();
			stopSync();
		};
	});
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content="個人向け小説執筆アプリ" />
</svelte:head>

<div class="app-frame">
	{#if desktop}
		<TitleBar title={windowTitle} />
	{/if}
	<div class="app-shell" class:with-rail={showRail} style={shellStyle}>
		{#if showRail}
			<AppRail />
		{/if}

		<div class="app-column">
			{#if showMobileHeader}
				<header class="app-header">
					<div class="app-header-inner">
						{#if isProjectPage}
							<a href="/home" class="icon-btn" aria-label="作品一覧へ戻る">
								<svg
									viewBox="0 0 24 24"
									width="22"
									height="22"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg
								>
							</a>
							<span class="header-title">{sectionLabel ?? ''}</span>
						{:else}
							<a href="/home" class="header-logo" aria-label="ホーム">
								{@html logo(themes[themeStore.theme.id].colors.text)}
							</a>
							<span class="flex:1"></span>
						{/if}
						<SyncStatus />
						{#if !isProjectPage}
							<a href="/settings" class="header-link">設定</a>
						{/if}
					</div>
				</header>
			{/if}

			<div class="app-body">
				<main class="app-main rel">
					{#key pageKey}
						<div class="page-enter">
							{@render children()}
						</div>
					{/key}
				</main>
			</div>

			{#if showBottomNav}
				<nav class="bottom-nav" aria-label="プロジェクト">
					{#each projectNavItems as item (item.path)}
						<a
							href="/project/{projectId}/{item.path}"
							aria-current={isActive(item.path) ? 'page' : undefined}
							class="bottom-nav-item {isActive(item.path) ? 'is-active' : ''}"
						>
							<svg
								viewBox="0 0 24 24"
								width="22"
								height="22"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true">{@html navIcons[item.icon]}</svg
							>
							<span class="bottom-nav-label">{item.label}</span>
						</a>
					{/each}
				</nav>
			{/if}
		</div>
	</div>
</div>

{#if desktop && !viewport.isMobile}
	<SelectionAsk />
	<EditorDiff />
{/if}

<ToastHost />
<ConflictHost />

<style>
	.app-frame {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		background: var(--color-background);
	}

	.app-shell {
		flex: 1;
		min-height: 0;
		display: flex;
		overflow: hidden;
		background: var(--color-background);
	}

	.page-enter {
		height: 100%;
		animation: page-enter 0.24s cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	@keyframes page-enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.page-enter {
			animation: none;
		}
	}

	.app-shell.with-rail {
		padding-left: var(--safe-left);
	}

	.app-column {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.app-header {
		flex: none;
		background: var(--color-background);
		border-bottom: 1px solid var(--color-border);
		padding-top: var(--safe-top);
		padding-left: var(--safe-left);
		padding-right: var(--safe-right);
	}

	.app-header-inner {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--bar-height);
		padding: 0 12px;
	}

	.header-title {
		flex: 1;
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text);
	}

	.header-logo {
		display: flex;
		width: 88px;
	}

	.header-link {
		padding: 6px 8px;
		font-size: 13px;
		color: var(--color-text);
	}

	.app-body {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.app-main {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		margin-left: -8px;
		color: var(--color-text);
		border-radius: 8px;
	}

	.bottom-nav {
		flex: none;
		display: flex;
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		padding-bottom: var(--safe-bottom);
		padding-left: var(--safe-left);
		padding-right: var(--safe-right);
	}

	.bottom-nav-item {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		height: calc(var(--bottom-nav-height) + 4px);
		color: var(--color-text-secondary);
	}

	.bottom-nav-label {
		font-size: 10.5px;
		letter-spacing: 0.02em;
	}

	.bottom-nav-item.is-active {
		color: var(--color-text);
	}

	.bottom-nav-item.is-active svg {
		color: var(--color-primary);
	}
</style>
