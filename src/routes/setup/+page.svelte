<script lang="ts">
	import { goto } from '$app/navigation';
	import { settingsDB } from '$lib/db';
	import { initializeFirebase, signInAnonymousUser } from '$lib/firebase';
	import { authStore } from '$lib/stores/auth.svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { initializeSync } from '$lib/services/sync.service';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { isValidFirebaseConfig } from '$lib/utils/validation';
	import type { FirebaseConfig } from '$lib/types';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toast } from '$lib/stores/toast.svelte';

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
	};

	const handleTest = async () => {
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
			testResult = '接続に成功しました';
			toast.success('Firebase に接続できました');
		} catch (e: any) {
			error = e.message || '接続に失敗しました';
		} finally {
			isLoading = false;
		}
	};

	const handleSave = async () => {
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

			toast.success('Firebase の設定を保存しました');
			// ホームへ遷移
			goto('/home');
		} catch (e: any) {
			error = e.message || '保存に失敗しました';
		} finally {
			isLoading = false;
		}
	};
</script>

<svelte:head>
	<title>Firebase初期設定 | Storift</title>
</svelte:head>

<div
	class="max-h:calc(100vh-66px) overflow-y:auto bg:theme-background flex ai:start jc:center p:24"
>
	<div class="max-w:600 w:full b:2|solid|theme-text r:8 p:32 flex flex:column gap:24">
		<div class="flex flex:column gap:8">
			<h1 class="font:24 font-weight:600 m:0">Firebase初期設定</h1>
			<p class="font:14 fg:theme-text-secondary m:0">
				Firebase Consoleで取得した設定情報を入力すると、端末間でデータを同期できます。
			</p>
		</div>

		<!-- 一括ペーストセクション -->
		<div class="bg:theme-surface p:16 r:8 b:1|solid|theme-border flex flex:column gap:12">
			<h2 class="flex flex:row ai:center gap:8 font:16 font-weight:600 m:0">
				<Icon name="rocket" /> 設定を一括入力
			</h2>
			<p class="font:14 fg:theme-text-secondary m:0">
				Firebase Consoleからコピーした設定をそのまま貼り付けてください
			</p>
			<textarea
				bind:value={configText}
				aria-label="Firebase の設定"
				placeholder="apiKey: 'AIzaSy...',
authDomain: 'your-project.firebaseapp.com',
projectId: 'your-project',
..."
				class="w:full p:12 r:6 b:1|solid|theme-border bg:theme-background fg:theme-text outline:none border-color:theme-primary:focus font:14 font-family:monospace min-h:120 resize:vertical"
			></textarea>
			<div class="flex gap:8">
				<Button
					type="button"
					onclick={handlePaste}
					disabled={!configText}
					class="b:2|solid|theme-text"
				>
					設定を読み込む
				</Button>
			</div>
		</div>

		{#if showManualInput || apiKey}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
				class="flex flex-direction:column gap:16"
			>
				<Input bind:value={apiKey} label="API Key" placeholder="AIza..." required />
				<Input
					bind:value={authDomain}
					label="Auth Domain"
					placeholder="your-project.firebaseapp.com"
					required
				/>
				<Input bind:value={projectId} label="Project ID" placeholder="your-project" required />
				<Input
					bind:value={storageBucket}
					label="Storage Bucket"
					placeholder="your-project.appspot.com"
					required
				/>
				<Input
					bind:value={messagingSenderId}
					label="Messaging Sender ID"
					placeholder="123456789"
					required
				/>
				<Input bind:value={appId} label="App ID" placeholder="1:123456789:web:..." required />

				{#if error}
					<div class="fg:theme-error p:12|16 r:6 b:2|solid|theme-error font:14" role="alert">
						{error}
					</div>
				{/if}

				{#if testResult}
					<div class="fg:theme-success p:12|16 r:6 b:2|solid|theme-success font:14" role="status">
						{testResult}
					</div>
				{/if}

				<div class="flex gap:12 mt:8">
					<Button
						type="button"
						variant="secondary"
						onclick={handleTest}
						disabled={isLoading}
						class="b:2|solid|theme-text"
					>
						{isLoading ? '接続中...' : '接続テスト'}
					</Button>
					<Button type="submit" disabled={isLoading} class="b:2|solid|theme-text">
						{isLoading ? '保存中...' : '保存して開始'}
					</Button>
				</div>
			</form>
		{:else if error}
			<div class="fg:theme-error p:12|16 r:6 b:2|solid|theme-error font:14" role="alert">
				{error}
			</div>
		{/if}

		<!-- 設定が入力されたら表示 -->
		{#if apiKey && !showManualInput}
			<div class="p:12 bg:theme-surface r:6 b:1|solid|theme-border flex flex:column gap:8">
				<p class="font:14 font-weight:600 m:0">現在の設定</p>
				<ul class="font:13 fg:theme-text-secondary m:0 p:0|0|0|20">
					<li>Project ID: <code>{projectId}</code></li>
					<li>Auth Domain: <code>{authDomain}</code></li>
				</ul>
				<Button
					type="button"
					variant="secondary"
					onclick={() => (showManualInput = true)}
					class="w:fit b:2|solid|theme-text"
				>
					手動で編集
				</Button>
			</div>
		{/if}
	</div>
</div>
