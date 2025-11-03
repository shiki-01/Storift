<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import title from '$lib/assets/title.svg';
	import { onMount } from 'svelte';
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
	<header class="px:2rem py:1.5rem bb:2px|solid|black">
		<div class="max-w:1200 gap:1.5rem mx:auto flex justify-content:start align-items:center">
			<button
				aria-label="mordal"
				onclick={() => editorStore.isOpen = !editorStore.isOpen}
				class="rel w:30px h:30px cursor:pointer"
			>
				<span class="w:28px h:2px flex bg:black abs top:50% left:0 transition:all|.2s|ease-in-out {editorStore.isOpen ? 'rotate(45deg)' : 'transform:translateY(-10px)'}"
				></span>
				<span class="w:28px h:2px flex bg:black abs top:50% left:0 transition:all|.2s|ease-in-out {editorStore.isOpen ? 'rotate(90deg) opacity:0' : 'transform:translateY(0) opacity:1'}"></span>
				<span class="w:28px h:2px flex bg:black abs top:50% left:0 transition:all|.2s|ease-in-out {editorStore.isOpen ? 'rotate(-45deg)' : 'transform:translateY(10px)'}"
				></span>
			</button>
			<div class="flex align-items:center gap:24">
				<img src={title} alt="title logo" />
				<SyncStatus />
			</div>
		</div>
	</header>

	<main class="max-w:1200 mx:auto">
		{@render children()}
	</main>
</div>
