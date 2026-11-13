<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page, updated } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		startNetworkMonitoring,
		stopNetworkMonitoring,
		onNetworkStatusChange
	} from '$lib/utils/offline';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { initializeSync, stopSync } from '$lib/services/sync.service';
	import { initAccessMode } from '$lib/services/access.service';
	import { initConnections } from '$lib/services/connection.service';
	import { settingsDB } from '$lib/db';
	import { initializeFirebase, signInAnonymousUser, isFirebaseInitialized } from '$lib/firebase';
	import { authStore } from '$lib/stores/auth.svelte';
	import { viewport, initViewport } from '$lib/stores/viewport.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { registerServiceWorker, checkForUpdate } from '$lib/utils/sw-register';
	import { initializeErrorHandler } from '$lib/utils/errorHandler';
	import SyncStatus from '$lib/components/ui/SyncStatus.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import ToastHost from '$lib/components/ui/ToastHost.svelte';
	import ConflictHost from '$lib/components/ui/ConflictHost.svelte';
	import TourOverlay from '$lib/components/tutorial/TourOverlay.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { installNativeContextMenuPolicy } from '$lib/desktop/nativeContextMenu';
	import { publishPage, publishVisibility } from '$lib/extensions/host.svelte';
	import { startExtensions } from '$lib/extensions/packManager.svelte';
	import { pageFromPath } from '$lib/extensions/pages';
	import { aiStore } from '$lib/stores/ai.svelte';
	import { updaterStore } from '$lib/stores/updater.svelte';
	import TitleBar from '$lib/components/desktop/TitleBar.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { pageContext } from '$lib/stores/pageContext.svelte';
	import SelectionAsk from '$lib/components/desktop/SelectionAsk.svelte';
	import EditorDiff from '$lib/components/desktop/EditorDiff.svelte';
	import AppRail from '$lib/components/layout/AppRail.svelte';
	import { projectNavItems, navIcons } from '$lib/components/layout/nav';

	let { children } = $props();

	// デスクトップ版(Tauri)だけ、AI パネル(執筆画面)と自前のタイトルバーを使う
	const desktop = isDesktop();

	function onGlobalKeydown(e: KeyboardEvent) {
		// Ctrl(Cmd)+Shift+L でパネルの開閉
		if (desktop && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
			e.preventDefault();
			aiStore.toggle();
		}
	}

	// 配信元に新しいバージョンが出たことを検知したら、すぐ Service Worker の更新を確認する
	$effect(() => {
		if (updated.current) void checkForUpdate();
	});

	// プロジェクトページかどうかを判定
	let isProjectPage = $derived(page.url.pathname.startsWith('/project/'));
	let projectId = $derived(page.params.id || '');

	function isActive(path: string): boolean {
		return page.url.pathname.includes(`/project/${projectId}/${path}`);
	}

	// ページタイトル(タブ名)
	const staticTitles: Record<string, string> = {
		'/home': 'ホーム',
		'/settings': '設定',
		'/setup': 'セットアップ'
	};
	let sectionLabel = $derived.by(() => {
		const path = page.url.pathname;
		if (isProjectPage) {
			return projectNavItems.find((item) => path.includes(`/project/${projectId}/${item.path}`))
				?.label;
		}
		return staticTitles[path];
	});
	// 画面名の後ろに付ける、選択中の対象名。執筆は「章 / シーン」、ほかは選んでいる項目名
	let detailParts = $derived.by((): string[] => {
		if (!isProjectPage) return [];
		const path = page.url.pathname;
		if (path.endsWith('/editor')) {
			const scene = editorStore.currentScene;
			if (!scene) return [];
			const chapter = currentProjectStore.chapters.find((c) => c.id === scene.chapterId);
			return [chapter?.title, scene.title].filter((t): t is string => !!t);
		}
		const detail = pageContext.detailFor(path);
		return detail ? [detail] : [];
	});
	// 「執筆 / 一巻 / プロローグ」「人物 / 朝日夕」のように、画面名と対象名を ' / ' でつなぐ
	let breadcrumb = $derived([sectionLabel, ...detailParts].filter(Boolean).join(' / '));
	// タイトルバーには作品名と、画面名・対象名を出す
	let windowTitle = $derived.by(() => {
		const project = isProjectPage ? currentProjectStore.project?.title : '';
		return [project, breadcrumb].filter(Boolean).join(' — ') || 'Storift';
	});

	// 画面が切り替わった時だけ、ふわっと出す。作品の中の移動ではプロジェクトの読み込みをやり直さない
	let pageKey = $derived(isProjectPage ? `project/${projectId}` : page.url.pathname);

	let pageTitle = $derived(
		sectionLabel ? `${sectionLabel} - Storift` : 'Storift - 小説執筆PWAアプリ'
	);

	// デスクトップは左端のレールで画面を切り替える(上部ヘッダーは持たない)。
	// スマホは細い上部バーを出すが、エディタは専用の上部バーを自前で持つため出さない
	let isEditorRoute = $derived(isProjectPage && page.url.pathname.endsWith('/editor'));
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

	// 開いている画面を拡張へ知らせる(購読者がいなければ、値を覚えるだけ)
	$effect(() => {
		publishPage(pageFromPath(page.url.pathname));
	});

	onMount(() => {
		// アプリが前面にあるか(別のウィンドウに移った・最小化した)を拡張へ知らせる
		const onVisibility = () => publishVisibility(document.visibilityState !== 'hidden');
		document.addEventListener('visibilitychange', onVisibility);
		onVisibility();

		// ビューポート(スマホ判定・キーボード高さ)の監視を開始
		const stopViewport = initViewport();

		// デスクトップ版の既定のコンテキストメニュー(戻る・再読み込み・検証)を、非編集領域では出さない
		const stopContextMenuPolicy = installNativeContextMenuPolicy();

		// デスクトップ版は、起動後に新しいバージョンを自動で確認する
		if (desktop) updaterStore.startAutoCheck();

		// グローバルエラーハンドラーを初期化
		initializeErrorHandler();

		// 有効にしている拡張だけ開始する(無効なら何も購読しない)
		void startExtensions();

		// Service Workerを登録（開発環境では既存のSWを削除）
		// デスクトップ版はファイルをアプリに同梱しているので使わない
		if (typeof window !== 'undefined' && !desktop) {
			registerServiceWorker().catch((error) => {
				console.error('Service Worker operation failed:', error);
			});
		}

		// Firebaseと同期システムを初期化(非同期で実行)
		(async () => {
			// 主 Firebase。未設定・失敗しても、ゲスト接続の同期は別に動かす
			let primaryReady = false;
			try {
				// Firebaseが既に初期化されている場合、設定チェックはスキップ
				if (isFirebaseInitialized()) {
					console.log('✅ Firebase already initialized');
					primaryReady = true;
				} else {
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

						// アクセスモードのキャッシュを反映し、判定をバックグラウンドで始める(待たない)
						await initAccessMode();
						primaryReady = true;
					} else {
						console.log('ℹ️ No Firebase config found, running in offline mode');
						syncStore.status = 'offline';
					}
				}
			} catch (error) {
				console.error('Failed to initialize Firebase/Sync:', error);
				syncStore.status = 'offline';
				// Firebaseなしでもアプリは動作する
			}

			try {
				// ゲスト接続(招待された共有プロジェクトのホストの Firebase)を復元する。サインインは待たない
				const guests = await initConnections();

				// 同期システムは、主 Firebase の準備ができたとき、またはゲスト接続があるときに初期化する
				if (primaryReady || guests > 0) {
					await initializeSync();
					// 共同編集: 前回オフラインで編集して閉じたシーンの未送信の更新を再送する(待たない)
					void import('$lib/services/sceneText.service')
						.then((m) => m.resumePendingSends())
						.catch((error) => console.warn('Failed to resume pending CRDT sends:', error));
				}
			} catch (error) {
				console.error('Failed to initialize sync:', error);
				syncStore.status = 'offline';
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
			updaterStore.stopAutoCheck();
			stopViewport();
			document.removeEventListener('visibilitychange', onVisibility);
			stopContextMenuPolicy();
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

		<div class="app-column" class:has-fixed-header={showMobileHeader}>
			{#if showMobileHeader}
				<header class="app-header">
					<div class="app-header-inner">
						{#if isProjectPage}
							<a href={resolve('/home')} class="icon-btn" aria-label="作品一覧へ戻る">
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
							<span class="header-title" title={breadcrumb}>
								<span class="header-section">{sectionLabel ?? ''}</span>
								{#each detailParts as part, i (i)}
									<span class="header-sep" aria-hidden="true">/</span>
									<span class="header-part">{part}</span>
								{/each}
							</span>
						{:else}
							<a href={resolve('/home')} class="header-logo" aria-label="ホーム">
								<Logo variant="full" size={20} title="Storift" />
							</a>
							<span class="flex:1"></span>
						{/if}
						<SyncStatus />
						{#if !isProjectPage}
							<a href={resolve('/settings')} class="header-link">設定</a>
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
							href={resolve(`/project/${projectId}/${item.path}`)}
							aria-current={isActive(item.path) ? 'page' : undefined}
							class="bottom-nav-item {isActive(item.path) ? 'is-active' : ''}"
							data-tour="nav-{item.path}"
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
								aria-hidden="true"
							>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- 固定のアイコン定義 -->
								{@html navIcons[item.icon]}
							</svg>
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
<TourOverlay />

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

	/* ヘッダーは fixed にする。画面上端に固定要素がないと iOS が上端に OS 側のぼかしを付け、文字がぼやける */
	.app-column.has-fixed-header {
		padding-top: calc(var(--safe-top) + var(--bar-height) + 1px);
	}

	.app-header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 5;
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

	/* 長い対象名は末尾を省略し、画面名と区切りは縮めない */
	.header-title {
		display: flex;
		flex: 1;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
	}

	.header-section,
	.header-sep {
		flex: none;
	}

	.header-sep {
		color: var(--color-text-secondary);
		font-weight: 400;
	}

	.header-part {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.header-part:last-child {
		flex: 1 1 auto;
	}

	.header-logo {
		display: flex;
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
