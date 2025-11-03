<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import title from '$lib/assets/title.svg';
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
	import { editorStore } from '$lib/stores/editor.svelte';
	import { registerServiceWorker } from '$lib/utils/sw-register';
	import { initializeErrorHandler } from '$lib/utils/errorHandler';
	import Button from '$lib/components/ui/Button.svelte';
	import SyncStatus from '$lib/components/ui/SyncStatus.svelte';

	let { children } = $props();

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

	onMount(() => {
		// グローバルエラーハンドラーを初期化
		initializeErrorHandler();

		// Service Workerを登録（開発環境では既存のSWを削除）
		if (typeof window !== 'undefined') {
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
			unsubscribe();
			stopNetworkMonitoring();
			stopSync();
		};
	});
</script>

<svelte:head>
	<title>Storift - 小説執筆PWAアプリ</title>
	<meta name="description" content="個人向け小説執筆アプリ" />
</svelte:head>

<div class="min-h:100vh bg:white">
	<header class="px:1.5rem py:1rem bb:2px|solid|black">
		<div class="max-w:1200 gap:1.5rem mx:auto flex justify-content:start align-items:center">
			<button
				aria-label="mordal"
				onclick={() => editorStore.isOpen = !editorStore.isOpen}
				class="rel w:30px h:30px cursor:pointer"
			>
				<span class="w:20px h:2px flex bg:black abs top:50% left:0 transition:all|.2s|ease-in-out {editorStore.isOpen ? 'rotate(45deg)' : 'transform:translateY(-6px)'}"
				></span>
				<span class="w:20px h:2px flex bg:black abs top:50% left:0 transition:all|.2s|ease-in-out {editorStore.isOpen ? 'rotate(90deg) opacity:0' : 'transform:translateY(0) opacity:1'}"></span>
				<span class="w:20px h:2px flex bg:black abs top:50% left:0 transition:all|.2s|ease-in-out {editorStore.isOpen ? 'rotate(-45deg)' : 'transform:translateY(6px)'}"
				></span>
			</button>
			<div class="flex align-items:center gap:24">
				<img src={title} alt="title logo" class="w:100px" />
				<SyncStatus />
			</div>
		</div>
	</header>

	<main class="mx:auto h:calc(100vh-64px) rel">
		<!-- サイドバー -->
		<aside
			class="w:240 h:100% bg:white flex flex:column abs z:2 top:0 transition:left|.2s|ease-in-out border-right:2px|solid|black {editorStore.isOpen
				? 'left:0'
				: 'left:-240px'}"
		>
			<!-- ナビゲーション -->
			<nav class="p:12 flex-grow:1">
				<a
					href="/home"
					onclick={() => (editorStore.isOpen = false)}
					class="flex align-items:center gap:12 px:16 py:12 r:8 mb:4 font:14 fg:gray-700 hover:bg:gray-100"
				>
					<span>ホーム</span>
				</a>

				{#if isProjectPage}
					<!-- プロジェクトページ用のナビゲーション -->
					<div class="mt:16 mb:8 px:16">
						<div class="font:12 font-weight:600 fg:gray-500 text-transform:uppercase">プロジェクト</div>
					</div>
					{#each projectNavItems as item}
						<a
							href="/project/{projectId}/{item.path}"
							onclick={() => (editorStore.isOpen = false)}
							class="flex align-items:center gap:12 px:16 py:12 r:8 mb:4 font:14 {isActive(item.path)
								? 'bg:gray-200 fg:black'
								: 'fg:gray-700 hover:bg:gray-100'}"
						>
							<span>{item.label}</span>
						</a>
					{/each}
				{/if}
			</nav>

			<div class="p:12 border-top:1px|solid|gray-200">
				<a
					href="/settings"
					onclick={() => (editorStore.isOpen = false)}
					class="flex align-items:center gap:12 px:16 py:12 r:8 mb:4 font:14 fg:gray-700 hover:bg:gray-100"
				>
					<span>設定</span>
				</a>
			</div>
		</aside>

		<button
			aria-label="sidebar overlay"
			onclick={() => (editorStore.isOpen = false)}
			class="w:100% h:100% abs z:1 bg:black cursor:pointer transition:opacity|.2s|ease-in-out {editorStore.isOpen
				? 'opacity:.5 pointer-events:auto'
				: 'opacity:0 pointer-events:none'}"
		></button>

		<!-- メインコンテンツ -->
		<div class="w:100% h:100%">
			{@render children()}
		</div>
	</main>
</div>
