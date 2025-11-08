<script lang="ts">
	import { goto } from '$app/navigation';
	import { settingsDB } from '$lib/db';
	import { initializeFirebase, signInAnonymousUser } from '$lib/firebase';
	import { authStore } from '$lib/stores/auth.svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { initializeSync } from '$lib/services/sync.service';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { isValidFirebaseConfig } from '$lib/utils/validation';
	import type { FirebaseConfig } from '$lib/types';
	import Icon from '$lib/components/ui/Icon.svelte';

	let apiKey = $state('');
	let authDomain = $state('');
	let projectId = $state('');
	let storageBucket = $state('');
	let messagingSenderId = $state('');
	let appId = $state('');
	let error = $state('');
	let isLoading = $state(false);
	let testResult = $state('');
	let configText = $state('');
	let showManualInput = $state(false);

	const handlePaste = () => {
		try {
			// まずJSON形式をトライ
			const config = JSON.parse(configText);
			
			if (config.apiKey) apiKey = config.apiKey;
			if (config.authDomain) authDomain = config.authDomain;
			if (config.projectId) projectId = config.projectId;
			if (config.storageBucket) storageBucket = config.storageBucket;
			if (config.messagingSenderId) messagingSenderId = config.messagingSenderId;
			if (config.appId) appId = config.appId;
			
			configText = '';
			error = '';
		} catch {
			// JSON形式でない場合、正規表現でパース
			try {
				const apiKeyMatch = configText.match(/apiKey[:\s]*["']([^"']+)["']/);
				const authDomainMatch = configText.match(/authDomain[:\s]*["']([^"']+)["']/);
				const projectIdMatch = configText.match(/projectId[:\s]*["']([^"']+)["']/);
				const storageBucketMatch = configText.match(/storageBucket[:\s]*["']([^"']+)["']/);
				const messagingSenderIdMatch = configText.match(/messagingSenderId[:\s]*["']([^"']+)["']/);
				const appIdMatch = configText.match(/appId[:\s]*["']([^"']+)["']/);

				if (apiKeyMatch) apiKey = apiKeyMatch[1];
				if (authDomainMatch) authDomain = authDomainMatch[1];
				if (projectIdMatch) projectId = projectIdMatch[1];
				if (storageBucketMatch) storageBucket = storageBucketMatch[1];
				if (messagingSenderIdMatch) messagingSenderId = messagingSenderIdMatch[1];
				if (appIdMatch) appId = appIdMatch[1];

				configText = '';
				error = '';
			} catch (e) {
				error = '設定情報の解析に失敗しました';
			}
		}
	}

	const handleTest = async() => {
		error = '';
		testResult = '';
		isLoading = true;

		try {
			const config: FirebaseConfig = {
				apiKey,
				authDomain,
				projectId,
				storageBucket,
				messagingSenderId,
				appId
			};

			if (!isValidFirebaseConfig(config)) {
				throw new Error('すべての項目を入力してください');
			}

			initializeFirebase(config);
			await signInAnonymousUser();
			testResult = '✓ 接続成功!';
		} catch (e: any) {
			error = e.message || '接続に失敗しました';
		} finally {
			isLoading = false;
		}
	}

	const handleSave = async() => {
		error = '';
		isLoading = true;

		try {
			const config: FirebaseConfig = {
				apiKey,
				authDomain,
				projectId,
				storageBucket,
				messagingSenderId,
				appId
			};

			if (!isValidFirebaseConfig(config)) {
				throw new Error('すべての項目を入力してください');
			}

			// 保存前にもう一度接続テスト
			initializeFirebase(config);
			const user = await signInAnonymousUser();
			authStore.user = user;
			authStore.isInitialized = true;

			// IndexedDBに保存
			await settingsDB.setFirebaseConfig(config);

			// 同期システムを初期化
			try {
				await initializeSync();
			} catch (syncError) {
				console.error('Sync initialization error:', syncError);
				// 同期エラーでもアプリは使える
			}

			// ホームへ遷移
			goto('/home');
		} catch (e: any) {
			error = e.message || '保存に失敗しました';
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="min-h:100vh bg:gray-50 flex align-items:center justify-content:center p:24">
	<div class="max-w:600 w:full">
		<h1 class="font:36 font-weight:700 text-align:center m:0|0|32|0">Storift</h1>

		<Card padding="lg">
			<h2 class="font:24 font-weight:600 m:0|0|24|0">Firebase初期設定</h2>

			<!-- 一括ペーストセクション -->
			<div class="bg:blue-50 p:16 r:8 mb:24 border:1|solid|blue-200">
				<h3 class="flex flex:row gap:.5em font:16 font-weight:600 m:0|0|12|0 fg:blue-900">
					<Icon name="rocket" /> 設定を一括入力
				</h3>
				<p class="font:14 fg:blue-800 m:0|0|12|0">
					Firebase Consoleからコピーした設定をそのまま貼り付けてください
				</p>
				<textarea
					bind:value={configText}
					placeholder="apiKey: 'AIzaSy...',
authDomain: 'your-project.firebaseapp.com',
projectId: 'your-project',
..."
					class="w:full p:12 r:6 border:1|solid|blue-300 font:14 font-family:monospace min-h:120 resize:vertical"
				></textarea>
				<div class="flex gap:8 mt:12">
					<Button type="button" onclick={handlePaste} disabled={!configText}>
						設定を読み込む
					</Button>
					<Button
						type="button"
						variant="secondary"
						onclick={() => (showManualInput = !showManualInput)}
					>
						{showManualInput ? '手動入力を隠す' : '手動で入力'}
					</Button>
				</div>
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
				class="flex flex-direction:column gap:16"
				class:display\:none={!showManualInput && !apiKey}
			>
				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="apiKey">API Key</label>
					<Input bind:value={apiKey} type="text" placeholder="AIza..." required />
				</div>

				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="authDomain"
						>Auth Domain</label
					>
					<Input
						bind:value={authDomain}
						type="text"
						placeholder="your-project.firebaseapp.com"
						required
					/>
				</div>

				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="projectId"
						>Project ID</label
					>
					<Input bind:value={projectId} type="text" placeholder="your-project" required />
				</div>

				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="storageBucket"
						>Storage Bucket</label
					>
					<Input
						bind:value={storageBucket}
						type="text"
						placeholder="your-project.appspot.com"
						required
					/>
				</div>

				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="messagingSenderId"
						>Messaging Sender ID</label
					>
					<Input bind:value={messagingSenderId} type="text" placeholder="123456789" required />
				</div>

				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="appId">App ID</label>
					<Input bind:value={appId} type="text" placeholder="1:123456789:web:..." required />
				</div>

				{#if error}
					<div class="bg:red-50 fg:red-700 p:12|16 r:6 border:1|solid|red-200">
						{error}
					</div>
				{/if}

				{#if testResult}
					<div class="bg:green-50 fg:green-700 p:12|16 r:6 border:1|solid|green-200">
						{testResult}
					</div>
				{/if}

				<div class="flex gap:12 mt:16">
					<Button type="button" variant="secondary" onclick={handleTest} disabled={isLoading}>
						{isLoading ? '接続中...' : '接続テスト'}
					</Button>
					<Button type="submit" disabled={isLoading}>
						{isLoading ? '保存中...' : '保存して開始'}
					</Button>
				</div>
			</form>

			<!-- 設定が入力されたら表示 -->
			{#if apiKey && !showManualInput}
				<div class="mt:16 p:12 bg:gray-50 r:6 border:1|solid|gray-200">
					<p class="font:14 font-weight:600 m:0|0|8|0">現在の設定:</p>
					<ul class="font:13 fg:gray-700 m:0 p:0|0|0|20">
						<li>Project ID: <code>{projectId}</code></li>
						<li>Auth Domain: <code>{authDomain}</code></li>
					</ul>
					<Button
						type="button"
						variant="secondary"
						onclick={() => (showManualInput = true)}
						class="mt:8"
					>
						手動で編集
					</Button>
				</div>
			{/if}
		</Card>

		<p class="text-align:center fg:gray-600 font:14 mt:24">
			Firebase Consoleで取得した設定情報を入力してください
		</p>
	</div>
</div>
