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

	let { children } = $props();

	// 配信元に新しいバージョンが出たことを検知したら、すぐ Service Worker の更新を確認する
	$effect(() => {
		if (updated.current) void checkForUpdate();
	});

	// プロジェクトページのナビゲーションアイテム
	const projectNavItems = [
		{ path: 'editor', label: '執筆' },
		{ path: 'plot', label: 'プロット' },
		{ path: 'characters', label: 'キャラクター' },
		{ path: 'worldbuilding', label: '設定資料' },
		{ path: 'progress', label: '進捗' }
	];

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
	let pageTitle = $derived(
		sectionLabel ? `${sectionLabel} - Storift` : 'Storift - 小説執筆PWAアプリ'
	);

	// スマホのエディタは専用の上部バーを自前で持つため、共通ヘッダーを出さない
	let isEditorRoute = $derived(isProjectPage && $page.url.pathname.endsWith('/editor'));
	let showGlobalHeader = $derived(!(viewport.isMobile && isEditorRoute) && !editorStore.focusMode);
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
		if (typeof window !== 'undefined') {
			registerServiceWorker().catch((error) => {
				console.error('Service Worker operation failed:', error);
			});
			// 端末内のデータ(原稿・設定)を、容量不足時にブラウザが自動で消さないよう保護を求める
			navigator.storage?.persist?.().catch(() => {});
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

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content="個人向け小説執筆アプリ" />
</svelte:head>

<div class="app-shell bg:theme-background" style={shellStyle}>
	{#if showGlobalHeader}
		<header class="app-header bb:1px|solid|theme-border">
			{#if viewport.isMobile}
				<!-- スマホ: 細い1本のバー -->
				<div class="app-header-inner flex ai:center gap:8 px:12">
					{#if isProjectPage}
						<a href="/home" class="icon-btn" aria-label="ホームへ戻る">
							<svg
								viewBox="0 0 24 24"
								width="22"
								height="22"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg
							>
						</a>
						<span class="font:15 font-weight:600 fg:theme-text flex:1">{sectionLabel ?? ''}</span>
					{:else}
						<a href="/home" class="w:90px flex" aria-label="ホーム">
							{@html logo(themes[themeStore.theme.id].colors.text)}
						</a>
						<span class="flex:1"></span>
					{/if}
					<SyncStatus />
					{#if !isProjectPage}
						<a href="/settings" class="font:13 fg:theme-text px:8 py:6">設定</a>
					{/if}
				</div>
			{:else}
				<!-- デスクトップ: ロゴ + 常時表示のナビゲーション -->
				<div class="app-header-inner flex ai:center gap:24 px:24">
					<a href="/home" class="w:100px flex" aria-label="ホーム">
						{@html logo(themes[themeStore.theme.id].colors.text)}
					</a>
					{#if isProjectPage}
						<nav class="flex ai:center gap:4 flex:1" aria-label="プロジェクト">
							{#each projectNavItems as item}
								<a
									href="/project/{projectId}/{item.path}"
									aria-current={isActive(item.path) ? 'page' : undefined}
									class="nav-link {isActive(item.path) ? 'is-active' : ''}"
								>
									{item.label}
								</a>
							{/each}
						</nav>
					{:else}
						<span class="flex:1"></span>
					{/if}
					<SyncStatus />
					<a
						href="/settings"
						class="nav-link {$page.url.pathname === '/settings' ? 'is-active' : ''}">設定</a
					>
				</div>
			{/if}
		</header>
	{/if}

	<main class="app-main rel">
		{@render children()}
	</main>

	{#if showBottomNav}
		<nav class="bottom-nav bt:1px|solid|theme-border" aria-label="プロジェクト">
			{#each projectNavItems as item}
				<a
					href="/project/{projectId}/{item.path}"
					aria-current={isActive(item.path) ? 'page' : undefined}
					class="bottom-nav-item {isActive(item.path) ? 'is-active' : ''}"
				>
					<span class="bottom-nav-label">{item.label}</span>
				</a>
			{/each}
		</nav>
	{/if}
</div>

<ToastHost />
<ConflictHost />

<style>
	.app-shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}

	.app-header {
		flex: none;
		background: var(--color-background);
		padding-top: var(--safe-top);
		padding-left: var(--safe-left);
		padding-right: var(--safe-right);
	}

	.app-header-inner {
		height: var(--bar-height);
		min-height: var(--bar-height);
	}

	.app-main {
		flex: 1;
		min-height: 0;
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

	.nav-link {
		padding: 6px 12px;
		border-radius: 8px;
		font-size: 14px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.nav-link:hover {
		color: var(--color-text);
	}

	.nav-link.is-active {
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
	}

	.bottom-nav {
		flex: none;
		display: flex;
		background: var(--color-background);
		padding-bottom: var(--safe-bottom);
		padding-left: var(--safe-left);
		padding-right: var(--safe-right);
	}

	.bottom-nav-item {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		height: var(--bottom-nav-height);
		font-size: 12px;
		color: var(--color-text-secondary);
		position: relative;
	}

	.bottom-nav-item.is-active {
		color: var(--color-primary);
		font-weight: 600;
	}

	.bottom-nav-item.is-active::before {
		content: '';
		position: absolute;
		top: 0;
		left: 25%;
		right: 25%;
		height: 2px;
		border-radius: 0 0 2px 2px;
		background: var(--color-primary);
	}
</style>
