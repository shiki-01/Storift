<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '$lib/db';
	import { themeStore, themes } from '$lib/stores/theme.svelte';
	import { exportAllProjects, exportAsJson } from '$lib/services/export.service';
	import { importFromJson } from '$lib/services/import.service';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import NotificationSettings from '$lib/components/ui/NotificationSettings.svelte';
	import type { AppSettings } from '$lib/types/settings';
	import { isFirebaseInitialized } from '$lib/firebase/config';
	import { setupRealtimeSync, stopAllRealtimeSync } from '$lib/firebase/sync';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { notificationService } from '$lib/services/notification.service';

	let settings = $state<Omit<AppSettings, 'id' | 'updatedAt'>>({
		theme: themeStore.theme.id as 'light' | 'dark' | 'auto',
		autoTheme: themeStore.isAutoTheme,
		autoSave: true,
		autoSaveInterval: 30,
		syncEnabled: true,
		shortcuts: {
			save: 'Ctrl+S',
			undo: 'Ctrl+Z',
			redo: 'Ctrl+Y',
			find: 'Ctrl+F',
			replace: 'Ctrl+H',
			newChapter: 'Ctrl+Shift+N',
			newScene: 'Ctrl+Alt+N'
		}
	});

	let showImportModal = $state(false);
	let showExportModal = $state(false);
	let showClearDataModal = $state(false);
	let importFile: File | null = $state(null);
	let importProgress = $state('');
	let exportFormat = $state<'json' | 'all'>('json');

	// Phase 2: 通知システム初期化
	onMount(() => {
		notificationService.initializeReminders();
		return () => {
			notificationService.cleanup();
		};
	});

	// テーマ変更
	async function handleThemeChange(themeId: string) {
		settings.theme = themeId as 'light' | 'dark' | 'auto';
		await themeStore.setTheme(themeId);
		await saveSettings();
	}

	// 自動テーマ切替
	const handleAutoThemeToggle = async() => {
		settings.autoTheme = !settings.autoTheme;
		await themeStore.setAutoTheme(settings.autoTheme);
		await saveSettings();
	}

	// 同期設定の変更
	const handleSyncToggle = async() => {
		const wasEnabled = settings.syncEnabled;
		settings.syncEnabled = !settings.syncEnabled;
		await saveSettings();

		console.log(
			`🔄 Sync toggle: ${wasEnabled ? 'ON' : 'OFF'} -> ${settings.syncEnabled ? 'ON' : 'OFF'}`
		);

		// Firebase同期の開始/停止
		if (typeof window !== 'undefined') {
			if (!isFirebaseInitialized()) {
				console.log('ℹ️ Firebase not configured, sync setting saved but no action taken');
				return;
			}

			if (settings.syncEnabled && !wasEnabled) {
				// 同期を有効化した場合
				try {
					// 認証状態を確認し、必要に応じて再認証
					const { getCurrentUser, signInAnonymousUser } = await import('$lib/firebase/auth');
					const { authStore } = await import('$lib/stores/auth.svelte');

					let user = getCurrentUser();
					if (!user) {
						console.log('🔐 Re-authenticating user...');
						user = await signInAnonymousUser();
						authStore.user = user;
						authStore.isInitialized = true;
					}

					// 同期システムを再初期化
					const { initializeSync } = await import('$lib/services/sync.service');
					await initializeSync();

					// プロジェクト固有の同期を開始
					const projectId = currentProjectStore.project?.id;
					if (projectId) {
						const { startCurrentProjectSync } = await import('$lib/services/sync.service');
						await startCurrentProjectSync(projectId);
						console.log('✅ Firebase sync enabled for project:', projectId);
					} else {
						console.log('ℹ️ No project selected, sync will start when project is opened');
					}

					syncStore.status = 'synced';
				} catch (error) {
					console.error('❌ Failed to start Firebase sync:', error);
					syncStore.status = 'error';
					syncStore.error = String(error);
				}
			} else if (!settings.syncEnabled && wasEnabled) {
				// 同期を無効化した場合
				try {
					// 同期システムを完全に停止
					const { stopSync } = await import('$lib/services/sync.service');
					stopSync();
					stopAllRealtimeSync();
					syncStore.status = 'offline'; // オフライン状態に
					console.log('✅ Firebase sync disabled');
				} catch (error) {
					console.error('❌ Failed to stop Firebase sync:', error);
				}
			}
		}
	}

	// 設定の保存
	const saveSettings = async() => {
		try {
			// 既存の設定を取得してFirebase設定を保持
			const existing = await db.settings.get('app-settings');
			await db.settings.put({
				id: 'app-settings',
				firebase: existing?.firebase, // Firebase設定を保持
				theme: settings.theme,
				autoTheme: settings.autoTheme,
				autoSave: settings.autoSave,
				autoSaveInterval: settings.autoSaveInterval,
				syncEnabled: settings.syncEnabled,
				shortcuts: {
					save: settings.shortcuts.save,
					undo: settings.shortcuts.undo,
					redo: settings.shortcuts.redo,
					find: settings.shortcuts.find,
					replace: settings.shortcuts.replace,
					newChapter: settings.shortcuts.newChapter,
					newScene: settings.shortcuts.newScene
				},
				updatedAt: Date.now()
			});
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	}

	// 設定の読み込み
	const loadSettings = async() => {
		try {
			const saved = await db.settings.get('app-settings');
			if (saved) {
				settings.theme = saved.theme;
				settings.autoTheme = saved.autoTheme;
				settings.autoSave = saved.autoSave;
				settings.autoSaveInterval = saved.autoSaveInterval;
				settings.syncEnabled = saved.syncEnabled;
				if (saved.shortcuts) {
					settings.shortcuts.save = saved.shortcuts.save;
					settings.shortcuts.undo = saved.shortcuts.undo;
					settings.shortcuts.redo = saved.shortcuts.redo;
					settings.shortcuts.find = saved.shortcuts.find;
					settings.shortcuts.replace = saved.shortcuts.replace;
					settings.shortcuts.newChapter = saved.shortcuts.newChapter;
					settings.shortcuts.newScene = saved.shortcuts.newScene;
				}
			}
		} catch (error) {
			console.error('Failed to load settings:', error);
		}
	}

	// エクスポート
	const handleExport = async() => {
		try {
			if (exportFormat === 'json') {
				await exportAllProjects();
			}
			showExportModal = false;
		} catch (error) {
			console.error('Export failed:', error);
			alert('エクスポートに失敗しました');
		}
	}

	// インポート
	const handleImport = async() => {
		if (!importFile) return;

		try {
			importProgress = 'インポート中...';
			const result = await importFromJson(importFile);

			if (result.success) {
				importProgress = `${result.projectIds.length}件のプロジェクトをインポートしました`;
				setTimeout(() => {
					showImportModal = false;
					importProgress = '';
					importFile = null;
				}, 2000);
			} else {
				importProgress = `エラー: ${result.errors.join(', ')}`;
			}
		} catch (error) {
			importProgress = `エラー: ${error}`;
		}
	}

	// キャッシュクリア
	const handleClearCache = async() => {
		try {
			// Service Workerのキャッシュをクリア
			if ('caches' in window) {
				const cacheNames = await caches.keys();
				await Promise.all(cacheNames.map((name) => caches.delete(name)));
			}
			alert('キャッシュをクリアしました');
			showClearDataModal = false;
		} catch (error) {
			alert('キャッシュのクリアに失敗しました');
		}
	}

	// 全データ削除
	const handleClearAllData = async() => {
		try {
			await db.delete();
			await db.open();
			await handleClearCache();
			alert('全データを削除しました。ページをリロードします。');
			window.location.href = '/';
		} catch (error) {
			alert('データの削除に失敗しました');
		}
	}

	// ページ読み込み時に設定を読み込む
	$effect(() => {
		(async () => {
			await loadSettings();
			// 設定読み込み後、同期状態を確認
			if (typeof window !== 'undefined' && isFirebaseInitialized() && settings.syncEnabled) {
				// 同期が有効な場合、現在のプロジェクトがあれば同期を確保
				const projectId = currentProjectStore.project?.id;
				if (projectId && syncStore.status === 'offline') {
					console.log('🔄 Restoring sync on settings page');
					const { startCurrentProjectSync } = await import('$lib/services/sync.service');
					await startCurrentProjectSync(projectId);
				}
			}
		})();
	});
</script>

<div class="w:100% h:100% overflow-y:auto px:4rem py:2rem">
	<h1 class="font:1.25rem">設定</h1>

	<!-- テーマ設定 -->
	<Card class="flex flex:column gap:1rem">
		<h2 class="font:bold">テーマ</h2>

		<div class="px:4rem">
			<label class="flex align-items:center gap:1rem cursor:pointer">
				<input
					type="checkbox"
					checked={settings.autoTheme}
					onchange={handleAutoThemeToggle}
					class="w-4 h-4"
				/>
				<span>システム設定に従う</span>
			</label>
		</div>

		<div class="flex flex:column gap:.5rem px:4rem">
			{#each Object.values(themes) as theme}
				<button
					onclick={() => handleThemeChange(theme.id)}
					class="p:4 r:8px b:2px|solid|black cursor:pointer flex flex:row ai:center jc:center gap:2rem rel {settings.autoTheme ? 'opacity:.5' : ''}"
					style="background-color: {theme.colors.background}; color: {theme.colors.text};"
					disabled={settings.autoTheme}
				>
					{#if settings.theme === theme.id && !settings.autoTheme}
						<div class="abs top:50% left:1rem transform:translateY(-50%)">
							<span
								class="w:8px h:2px flex transform:rotate(45deg)|translate(0,6px)"
								style="background-color: {theme.colors.text};"
							></span>
							<span
								class="w:16px h:2px flex transform:rotate(-45deg)"
								style="background-color: {theme.colors.text};"
							></span>
						</div>
					{/if}
					<div class="">{theme.name}</div>
					<div class="flex gap:1rem justify-content:center">
						<div class="w:8px h:8px r:full" style="background-color: {theme.colors.primary};"></div>
						<div class="w:8px h:8px r:full" style="background-color: {theme.colors.secondary};"></div>
						<div class="w:8px h:8px r:full" style="background-color: {theme.colors.accent};"></div>
					</div>
				</button>
			{/each}
		</div>
	</Card>

	<!-- Phase 2: 通知設定 -->
	<Card class="">
		<h2 class="font:bold">通知とリマインダー</h2>
		{#if currentProjectStore.project}
			<NotificationSettings projectId={currentProjectStore.project.id} />
		{:else}
			<p class="text-gray-600">プロジェクトを開いて通知を設定してください</p>
		{/if}
	</Card>

	<!-- エディタ設定 -->
	<Card class="mb-6">
		<h2 class="text-xl font-semibold mb-4">エディタ</h2>

		<div class="space-y-4">
			<div>
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						bind:checked={settings.autoSave}
						onchange={saveSettings}
						class="w-4 h-4"
					/>
					<span>自動保存を有効にする</span>
				</label>
			</div>

			{#if settings.autoSave}
				<div>
					<label for="autoSaveInterval" class="block mb-2">自動保存間隔 (秒)</label>
					<input
						id="autoSaveInterval"
						type="number"
						bind:value={settings.autoSaveInterval}
						onchange={saveSettings}
						min="10"
						max="300"
						class="w-32 px-3 py-2 border rounded"
					/>
				</div>
			{/if}
		</div>
	</Card>

	<!-- 同期設定 -->
	<Card class="mb-6">
		<h2 class="text-xl font-semibold mb-4">同期</h2>

		<div class="space-y-4">
			<div>
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						checked={settings.syncEnabled}
						onchange={handleSyncToggle}
						class="w-4 h-4"
					/>
					<span>クラウド同期を有効にする</span>
				</label>
				<p class="text-sm text-gray-600 mt-2">
					Firebase連携が設定されている場合、プロジェクトデータを自動的にクラウドに同期します。
				</p>
			</div>

			{#if isFirebaseInitialized()}
				<div class="p-3 bg-gray-100 dark:bg-gray-800 rounded">
					<div class="flex items-center gap-2 text-sm">
						<span
							class="w-2 h-2 rounded-full"
							class:bg-green-500={syncStore.status === 'synced'}
							class:bg-yellow-500={syncStore.status === 'syncing'}
							class:bg-red-500={syncStore.status === 'error'}
							class:bg-gray-400={syncStore.status === 'offline'}
						></span>
						<span>
							{#if syncStore.status === 'synced'}
								{settings.syncEnabled ? '同期済み' : '同期無効'}
							{:else if syncStore.status === 'syncing'}
								同期中...
							{:else if syncStore.status === 'error'}
								エラー: {syncStore.error}
							{:else if syncStore.status === 'offline'}
								オフライン
							{:else}
								待機中
							{/if}
						</span>
					</div>
					{#if syncStore.lastSyncTime}
						<p class="text-xs text-gray-600 dark:text-gray-400 mt-1">
							最終同期: {new Date(syncStore.lastSyncTime).toLocaleString('ja-JP')}
						</p>
					{/if}
				</div>
			{:else}
				<div
					class="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded"
				>
					<p class="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
						⚠️ Firebase連携が設定されていません
					</p>
					<a href="/setup" class="text-sm text-blue-600 dark:text-blue-400 hover:underline">
						Firebase設定ページへ →
					</a>
				</div>
			{/if}
		</div>
	</Card>

	<!-- ショートカットキー -->
	<Card class="mb-6">
		<h2 class="text-xl font-semibold mb-4">ショートカットキー</h2>

		<div class="space-y-3">
			{#each Object.entries(settings.shortcuts) as [action, key]}
				<div class="flex items-center justify-between">
					<span class="capitalize">{action.replace(/([A-Z])/g, ' $1')}</span>
					<kbd class="px-3 py-1 bg-gray-100 border border-gray-300 rounded text-sm font-mono">
						{key}
					</kbd>
				</div>
			{/each}
		</div>
	</Card>

	<!-- データ管理 -->
	<Card class="mb-6">
		<h2 class="text-xl font-semibold mb-4">データ管理</h2>

		<div class="space-y-4">
			<div>
				<Button onclick={() => (showExportModal = true)} class="w-full">
					全データをエクスポート
				</Button>
				<p class="text-sm text-gray-600 mt-1">
					すべてのプロジェクトをJSONファイルとしてバックアップします。
				</p>
			</div>

			<div>
				<Button onclick={() => (showImportModal = true)} variant="secondary" class="w-full">
					データをインポート
				</Button>
				<p class="text-sm text-gray-600 mt-1">バックアップファイルからプロジェクトを復元します。</p>
			</div>

			<div>
				<Button onclick={() => (showClearDataModal = true)} variant="danger" class="w-full">
					全データを削除
				</Button>
				<p class="text-sm text-gray-600 mt-1">
					すべてのプロジェクトとキャッシュを削除します。この操作は取り消せません。
				</p>
			</div>
		</div>
	</Card>

	<!-- バージョン情報 -->
	<Card>
		<h2 class="text-xl font-semibold mb-4">バージョン情報</h2>
		<div class="text-sm text-gray-600">
			<p>Storift v0.0.1</p>
			<p>SvelteKit + Master CSS + TypeScript</p>
		</div>
	</Card>
</div>

<!-- エクスポートモーダル -->
{#if showExportModal}
	<Modal
		title="データをエクスポート"
		onClose={() => (showExportModal = false)}
		onConfirm={handleExport}
	>
		<div class="space-y-4">
			<p>すべてのプロジェクトをエクスポートします。</p>

			<div>
				<label for="exportFormat" class="block mb-2">形式</label>
				<select id="exportFormat" bind:value={exportFormat} class="w-full px-3 py-2 border rounded">
					<option value="json">JSON (バックアップ用)</option>
				</select>
			</div>
		</div>
	</Modal>
{/if}

<!-- インポートモーダル -->
{#if showImportModal}
	<Modal
		title="データをインポート"
		onClose={() => {
			showImportModal = false;
			importProgress = '';
			importFile = null;
		}}
		onConfirm={handleImport}
	>
		<div class="space-y-4">
			<div>
				<label for="importFile" class="block mb-2">バックアップファイルを選択</label>
				<input
					id="importFile"
					type="file"
					accept=".json"
					onchange={(e) => {
						const target = e.target as HTMLInputElement;
						importFile = target.files?.[0] || null;
					}}
					class="w-full"
				/>
			</div>

			{#if importProgress}
				<div class="p-3 bg-gray-100 rounded">
					{importProgress}
				</div>
			{/if}

			<p class="text-sm text-gray-600">
				※ 既存のプロジェクトと同じタイトルの場合、新しいプロジェクトとして追加されます。
			</p>
		</div>
	</Modal>
{/if}

<!-- データ削除確認モーダル -->
{#if showClearDataModal}
	<Modal
		title="全データを削除"
		onClose={() => (showClearDataModal = false)}
		onConfirm={handleClearAllData}
		confirmText="削除"
		confirmVariant="danger"
	>
		<div class="space-y-4">
			<p class="text-red-600 font-semibold">
				⚠️ すべてのプロジェクト、キャラクター、プロット、設定資料が削除されます。
			</p>
			<p>この操作は取り消すことができません。事前にバックアップを取ることをお勧めします。</p>
			<p>本当に削除しますか?</p>
		</div>
	</Modal>
{/if}
