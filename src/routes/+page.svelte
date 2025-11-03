<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { settingsDB } from '$lib/db';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { initializeFirebase, signInAnonymousUser } from '$lib/firebase';
	import { initializeSync } from '$lib/services/sync.service';

	onMount(async () => {
		// 設定を読み込む
		const settings = await settingsDB.get();
		settingsStore.settings = settings;

		// Firebase設定があれば初期化
		if (settings.firebase) {
			try {
				initializeFirebase(settings.firebase);
				const user = await signInAnonymousUser();
				authStore.user = user;
				authStore.isInitialized = true;

				// 同期システムを初期化
				if (settings.syncEnabled) {
					try {
						await initializeSync();
					} catch (syncError) {
						console.error('Sync initialization error:', syncError);
						// 同期エラーでもアプリは使える
					}
				}

				goto('/home');
			} catch (error) {
				console.error('Firebase initialization error:', error);
				// 初期化エラーの場合はセットアップへ
				goto('/setup');
			}
		} else {
			goto('/setup');
		}
	});
</script>

<div class="flex align-items:center justify-content:center h:100vh">
	<div class="text-align:center">
		<h1 class="font:32 font-weight:700 m:0|0|16|0">Storift</h1>
		<p class="fg:gray-600">読み込み中...</p>
	</div>
</div>
