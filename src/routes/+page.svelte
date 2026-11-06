<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { settingsDB } from '$lib/db';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { initializeFirebase, signInAnonymousUser } from '$lib/firebase';
	import { initializeSync } from '$lib/services/sync.service';
	import { initAccessMode } from '$lib/services/access.service';

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

				// アクセスモードのキャッシュを反映し、判定をバックグラウンドで始める(待たない)
				await initAccessMode();

				// 同期システムを初期化
				if (settings.syncEnabled) {
					try {
						await initializeSync();
					} catch (syncError) {
						console.error('Sync initialization error:', syncError);
						// 同期エラーでもアプリは使える
					}
				}

				goto(resolve('/home'));
			} catch (error) {
				console.error('Firebase initialization error:', error);
				// 初期化エラーの場合はセットアップへ
				goto(resolve('/setup'));
			}
		} else if (settings.setupCompleted) {
			// 同期なしで始めた場合は、そのままホームへ
			goto(resolve('/home'));
		} else {
			goto(resolve('/setup'));
		}
	});
</script>

<div class="flex ai:center jc:center h:100%">
	<div class="text-align:center">
		<h1 class="font:32 font-weight:700 m:0|0|16|0">Storift</h1>
		<p class="fg:theme-text-secondary">読み込み中...</p>
	</div>
</div>
