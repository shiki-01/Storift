<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { settingsDB } from '$lib/db';
	import { initializeFirebase, signInAnonymousUser } from '$lib/firebase';
	import { authStore } from '$lib/stores/auth.svelte';
	import { initializeSync } from '$lib/services/sync.service';
	import { initAccessMode } from '$lib/services/access.service';
	import {
		decodeSettingsCode,
		looksLikeSettingsCode,
		SETTINGS_CODE_ERROR_MESSAGES
	} from '$lib/firebase/settingsCode';
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
	// 設定コードから読み込んだオーナー鍵(保存時に登録に使う)
	let pendingOwnerKey = $state<string | undefined>(undefined);

	const handlePaste = () => {
		// 設定コード(storift1:...)は、Firebase 設定とオーナー鍵をまとめて読み込む
		if (looksLikeSettingsCode(configText)) {
			const decoded = decodeSettingsCode(configText);
			if (!decoded.ok) {
				error = SETTINGS_CODE_ERROR_MESSAGES[decoded.error];
				return;
			}
			({ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId } = decoded.config);
			pendingOwnerKey = decoded.ownerKey;
			configText = '';
			error = '';
			return;
		}

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
			} catch {
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
			testResult = '✓ 接続成功!';
		} catch (e) {
			error = (e instanceof Error ? e.message : '') || '接続に失敗しました';
		} finally {
			isLoading = false;
		}
	};

	// 同期を使わずに始める(Firebase は設定画面から後で設定できる)
	const handleSkip = async () => {
		await settingsDB.update({ setupCompleted: true });
		goto(resolve('/home'));
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
			// オーナー鍵は設定コードで貼られたときだけ持つ。別の Firebase に切り替える場合に古い鍵を残さない
			await settingsDB.update({
				firebase: config,
				ownerKey: pendingOwnerKey,
				accessMode: undefined,
				setupCompleted: true
			});
			authStore.accessMode = null;

			// アクセスモードの判定はバックグラウンドで始める(同期の開始より前に、キャッシュを反映する)
			await initAccessMode();

			// 同期システムを初期化
			try {
				await initializeSync();
			} catch (syncError) {
				console.error('Sync initialization error:', syncError);
				// 同期エラーでもアプリは使える
			}

			// ホームへ遷移
			goto(resolve('/home'));
		} catch (e) {
			error = (e instanceof Error ? e.message : '') || '保存に失敗しました';
		} finally {
			isLoading = false;
		}
	};
</script>

<div class="h:100% overflow-y:auto bg:theme-background flex ai:start jc:center p:24">
	<div class="max-w:600 w:full">
		<Card padding="lg">
			<h2 class="font:24 font-weight:600 m:0|0|8|0">Firebase初期設定(任意)</h2>
			<p class="font:14 fg:theme-text-secondary m:0|0|24|0">
				複数の端末で作品を同期したい場合だけ設定します。設定しなくても、作品はこの端末に保存されて使えます。あとから設定画面でも設定できます。
			</p>

			<!-- 一括ペーストセクション -->
			<div class="bg:theme-surface p:16 r:8 mb:24 b:1|solid|theme-border">
				<h3
					class="flex flex-direction:row gap:.5em font:16 font-weight:600 m:0|0|12|0 fg:theme-primary"
				>
					<Icon name="rocket" /> 設定を一括入力
				</h3>
				<p class="font:14 fg:theme-primary m:0|0|12|0">
					Firebase
					Consoleからコピーした設定、または別の端末で表示した「設定コード」をそのまま貼り付けてください
				</p>
				<textarea
					bind:value={configText}
					placeholder="apiKey: 'AIzaSy...',
authDomain: 'your-project.firebaseapp.com',
projectId: 'your-project',
..."
					class="w:full p:12 r:6 focus:outline:none font:14 font-family:monospace min-h:120 resize:vertical"
				></textarea>
				<div class="flex gap:8 mt:12">
					<Button type="button" onclick={handlePaste} disabled={!configText}>設定を読み込む</Button>
				</div>
				{#if pendingOwnerKey}
					<p class="font:13 fg:theme-success m:12|0|0|0">
						設定コードを読み込みました。保存すると、この端末をオーナー端末として登録します。
					</p>
				{/if}
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
				class="flex flex:column gap:16"
				class:display\:none={!showManualInput && !apiKey}
			>
				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="apiKey">API Key</label>
					<Input bind:value={apiKey} type="text" placeholder="AIza..." required />
				</div>

				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="authDomain">Auth Domain</label
					>
					<Input
						bind:value={authDomain}
						type="text"
						placeholder="your-project.firebaseapp.com"
						required
					/>
				</div>

				<div>
					<label class="display:block font-weight:500 m:0|0|8|0" for="projectId">Project ID</label>
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
					<div
						class="fg:theme-error p:12|16 r:6 border:1|solid|theme-error"
						style="background-color: color-mix(in srgb, var(--color-error) 10%, transparent);"
					>
						{error}
					</div>
				{/if}

				{#if testResult}
					<div
						class="fg:theme-success p:12|16 r:6 border:1|solid|theme-success"
						style="background-color: color-mix(in srgb, var(--color-success) 10%, transparent);"
					>
						{testResult}
					</div>
				{/if}

				<div class="flex gap:12 mt:16">
					<Button
						type="button"
						variant="secondary"
						onclick={handleTest}
						disabled={isLoading}
						class="px:8px py:4px"
					>
						{isLoading ? '接続中...' : '接続テスト'}
					</Button>
					<Button type="submit" disabled={isLoading}>
						{isLoading ? '保存中...' : '保存して開始'}
					</Button>
				</div>
			</form>

			<!-- 設定が入力されたら表示 -->
			{#if apiKey && !showManualInput}
				<div class="mt:16 p:12 bg:theme-surface r:6 border:1|solid|theme-border">
					<p class="font:14 font-weight:600 m:0|0|8|0">現在の設定:</p>
					<ul class="font:13 fg:theme-text-secondary m:0 p:0|0|0|20">
						<li>Project ID: <code>{projectId}</code></li>
						<li>Auth Domain: <code>{authDomain}</code></li>
					</ul>
					<Button
						type="button"
						variant="secondary"
						onclick={() => (showManualInput = true)}
						class="mt:8 px:8px py:4px"
					>
						手動で編集
					</Button>
				</div>
			{/if}
		</Card>

		<div class="text-align:center mt:24">
			<Button type="button" variant="secondary" onclick={handleSkip}>設定せずに始める</Button>
		</div>

		<p class="text-align:center fg:theme-text-secondary font:14 mt:24">
			Firebase Consoleで取得した設定情報を入力してください
		</p>
	</div>
</div>
