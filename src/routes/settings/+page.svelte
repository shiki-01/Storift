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
		conflictResolution: 'manual',
		editorFormatting: {
			fontSize: 16,
			lineHeight: 2,
			letterSpacing: 0,
			paragraphSpacing: 16
		},
		shortcuts: {
			save: 'Ctrl+S',
			undo: 'Ctrl+Z',
			redo: 'Ctrl+Y',
			find: 'Ctrl+F',
			replace: 'Ctrl+H',
			newChapter: 'Ctrl+Shift+N',
			newScene: 'Ctrl+Alt+N'
		},
		exportPatterns: []
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
	const handleAutoThemeToggle = async () => {
		settings.autoTheme = !settings.autoTheme;
		await themeStore.setAutoTheme(settings.autoTheme);
		await saveSettings();
	};

	// 同期設定の変更
	const handleSyncToggle = async () => {
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
	};

	// 設定の保存
	const saveSettings = async () => {
		try {
			// 既存の設定を取得してFirebase設定を保持
			const existing = await db.settings.get('app-settings');

			// プレーンなオブジェクトに変換（Svelteのリアクティブプロパティを除去）
			const plainSettings = {
				id: 'app-settings' as const,
				firebase: existing?.firebase,
				theme: settings.theme,
				autoTheme: settings.autoTheme,
				autoSave: settings.autoSave,
				autoSaveInterval: settings.autoSaveInterval,
				syncEnabled: settings.syncEnabled,
				conflictResolution: settings.conflictResolution,
				editorFormatting: {
					fontSize: settings.editorFormatting.fontSize,
					lineHeight: settings.editorFormatting.lineHeight,
					letterSpacing: settings.editorFormatting.letterSpacing,
					paragraphSpacing: settings.editorFormatting.paragraphSpacing
				},
				shortcuts: {
					save: settings.shortcuts.save,
					undo: settings.shortcuts.undo,
					redo: settings.shortcuts.redo,
					find: settings.shortcuts.find,
					replace: settings.shortcuts.replace,
					newChapter: settings.shortcuts.newChapter,
					newScene: settings.shortcuts.newScene
				},
				exportPatterns: existing?.exportPatterns || [],
				updatedAt: Date.now()
			};

			await db.settings.put(plainSettings);
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	};

	// 設定の読み込み
	const loadSettings = async () => {
		try {
			const saved = await db.settings.get('app-settings');
			if (saved) {
				settings.theme = saved.theme;
				settings.autoTheme = saved.autoTheme;
				settings.autoSave = saved.autoSave;
				settings.autoSaveInterval = saved.autoSaveInterval;
				settings.syncEnabled = saved.syncEnabled;
				settings.conflictResolution = saved.conflictResolution || 'manual';
				settings.editorFormatting = saved.editorFormatting || {
					fontSize: 16,
					lineHeight: 2,
					letterSpacing: 0,
					paragraphSpacing: 16
				};
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
	};

	// エクスポート
	const handleExport = async () => {
		try {
			if (exportFormat === 'json') {
				await exportAllProjects();
			}
			showExportModal = false;
		} catch (error) {
			console.error('Export failed:', error);
			alert('エクスポートに失敗しました');
		}
	};

	// インポート
	const handleImport = async () => {
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
	};

	// キャッシュクリア
	const handleClearCache = async () => {
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
	};

	// 全データ削除
	const handleClearAllData = async () => {
		try {
			await db.delete();
			await db.open();
			await handleClearCache();
			alert('全データを削除しました。ページをリロードします。');
			window.location.href = '/';
		} catch (error) {
			alert('データの削除に失敗しました');
		}
	};

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

<div class="w:100% h:100% overflow-y:auto px:4rem py:2rem flex flex-direction:column gap:2rem">
	<h1 class="font:1.25rem">設定</h1>

	<!-- テーマ設定 -->
	<Card class="flex flex-direction:column gap:1rem b:2px|solid|var(--color-text)">
		<h2 class="font:bold">テーマ</h2>

		<div class="px:4rem">
			<label class="flex align-items:center gap:.5rem cursor:pointer">
				<input
					type="checkbox"
					checked={settings.autoTheme}
					onchange={handleAutoThemeToggle}
					class="w-4 h-4"
				/>
				<span>システム設定に従う</span>
			</label>
		</div>

		<div class="flex flex-direction:column gap:.5rem px:4rem">
			{#each Object.values(themes) as theme}
				<button
					onclick={() => handleThemeChange(theme.id)}
					class="p:4 r:8px b:2px|solid|var(--color-text) cursor:pointer flex flex-direction:row ai:center jc:center gap:2rem rel {settings.autoTheme
						? 'opacity:.5'
						: ''}"
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
						<div
							class="w:8px h:8px r:full"
							style="background-color: {theme.colors.secondary};"
						></div>
						<div class="w:8px h:8px r:full" style="background-color: {theme.colors.accent};"></div>
					</div>
				</button>
			{/each}
		</div>
	</Card>

	<!-- Phase 2: 通知設定 -->
	<Card class="b:2px|solid|var(--color-text)">
		<h2 class="font:bold">通知とリマインダー</h2>
		{#if currentProjectStore.project}
			<NotificationSettings projectId={currentProjectStore.project.id} />
		{:else}
			<p class="text-gray-600">プロジェクトを開いて通知を設定してください</p>
		{/if}
	</Card>

	<!-- エディタ設定 -->
	<Card class="b:2px|solid|var(--color-text) flex flex-direction:column gap:1rem">
		<h2 class="font:bold">エディタ</h2>

		<div class="flex flex-direction:column gap:1rem">
			<div>
				<label class="flex ai:center gap:.5rem cursor:pointer">
					<input
						type="checkbox"
						bind:checked={settings.autoSave}
						onchange={saveSettings}
						class="w:1rem h:1rem"
					/>
					<span>自動保存を有効にする</span>
				</label>
			</div>

			{#if settings.autoSave}
				<div class="flex flex-direction:column gap:.5rem">
					<label for="autoSaveInterval" class="block">自動保存間隔 (秒)</label>
					<input
						id="autoSaveInterval"
						type="number"
						bind:value={settings.autoSaveInterval}
						onchange={saveSettings}
						min="10"
						max="300"
						class="px:.5rem py:.1rem b:2px|solid|theme-text r:8px"
					/>
				</div>
			{/if}
		</div>
	</Card>

	<!-- 書式設定 -->
	<Card class="b:2px|solid|var(--color-text) flex flex-direction:column gap:1rem">
		<h2 class="font:bold">書式設定</h2>
		<p class="fg:theme-text-secondary font:.875rem">
			エディタのテキスト表示形式を一括で調整できます。
		</p>

		<div class="flex flex-direction:column gap:1.5rem">
			<!-- フォントサイズ -->
			<div class="flex flex-direction:column gap:.5rem">
				<div class="flex justify-content:space-between align-items:center">
					<label for="fontSize" class="font-weight:500">フォントサイズ</label>
					<span class="fg:theme-text-secondary font:.875rem"
						>{settings.editorFormatting.fontSize}px</span
					>
				</div>
				<input
					id="fontSize"
					type="range"
					bind:value={settings.editorFormatting.fontSize}
					onchange={saveSettings}
					min="12"
					max="24"
					step="1"
					class="w:full"
				/>
				<div class="flex justify-content:space-between fg:theme-text-secondary font:.75rem">
					<span>小 (12px)</span>
					<span>大 (24px)</span>
				</div>
			</div>

			<!-- 行間 -->
			<div class="flex flex-direction:column gap:.5rem">
				<div class="flex justify-content:space-between align-items:center">
					<label for="lineHeight" class="font-weight:500">行間</label>
					<span class="fg:theme-text-secondary font:.875rem"
						>{settings.editorFormatting.lineHeight.toFixed(1)}</span
					>
				</div>
				<input
					id="lineHeight"
					type="range"
					bind:value={settings.editorFormatting.lineHeight}
					onchange={saveSettings}
					min="1.0"
					max="3.0"
					step="0.1"
					class="w:full"
				/>
				<div class="flex justify-content:space-between fg:theme-text-secondary font:.75rem">
					<span>狭い (1.0)</span>
					<span>広い (3.0)</span>
				</div>
			</div>

			<!-- 字間 -->
			<div class="flex flex-direction:column gap:.5rem">
				<div class="flex justify-content:space-between align-items:center">
					<label for="letterSpacing" class="font-weight:500">字間</label>
					<span class="fg:theme-text-secondary font:.875rem"
						>{settings.editorFormatting.letterSpacing.toFixed(2)}em</span
					>
				</div>
				<input
					id="letterSpacing"
					type="range"
					bind:value={settings.editorFormatting.letterSpacing}
					onchange={saveSettings}
					min="-0.05"
					max="0.2"
					step="0.01"
					class="w:full"
				/>
				<div class="flex justify-content:space-between fg:theme-text-secondary font:.75rem">
					<span>狭い (-0.05em)</span>
					<span>広い (0.2em)</span>
				</div>
			</div>

			<!-- 段落間隔 -->
			<div class="flex flex-direction:column gap:.5rem">
				<div class="flex justify-content:space-between align-items:center">
					<label for="paragraphSpacing" class="font-weight:500">段落間隔</label>
					<span class="fg:theme-text-secondary font:.875rem"
						>{settings.editorFormatting.paragraphSpacing}px</span
					>
				</div>
				<input
					id="paragraphSpacing"
					type="range"
					bind:value={settings.editorFormatting.paragraphSpacing}
					onchange={saveSettings}
					min="0"
					max="48"
					step="4"
					class="w:full"
				/>
				<div class="flex justify-content:space-between fg:theme-text-secondary font:.75rem">
					<span>なし (0px)</span>
					<span>広い (48px)</span>
				</div>
			</div>

			<!-- プレビュー -->
			<div class="p:1rem b:2px|solid|theme-border r:8px bg:theme-background-secondary">
				<p class="font:.75rem fg:theme-text-secondary mb:.5rem">プレビュー</p>
				<div
					class="fg:theme-text"
					style="
						font-size: {settings.editorFormatting.fontSize}px;
						line-height: {settings.editorFormatting.lineHeight};
						letter-spacing: {settings.editorFormatting.letterSpacing}em;
					"
				>
					<p style="margin-bottom: {settings.editorFormatting.paragraphSpacing}px;">
						吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。
					</p>
					<p>何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。</p>
				</div>
			</div>

			<!-- リセットボタン -->
			<Button
				onclick={() => {
					settings.editorFormatting = {
						fontSize: 16,
						lineHeight: 2,
						letterSpacing: 0,
						paragraphSpacing: 16
					};
					saveSettings();
				}}
				variant="secondary"
				class="w:fit"
			>
				デフォルトに戻す
			</Button>
		</div>
	</Card>

	<!-- 同期設定 -->
	<Card class="b:2px|solid|var(--color-text)  flex flex-direction:column gap:1rem">
		<h2 class="font:bold">同期</h2>

		<div class="flex flex-direction:column gap:1rem">
			<div>
				<label class="flex ai:center gap:.5rem cursor:pointer">
					<input
						type="checkbox"
						checked={settings.syncEnabled}
						onchange={handleSyncToggle}
						class="w:1rem h:1rem"
					/>
					<span>クラウド同期を有効にする</span>
				</label>
				<p class="">
					Firebase連携が設定されている場合、プロジェクトデータを自動的にクラウドに同期します。
				</p>
			</div>

			<div class="flex flex-direction:column gap:.5rem">
				<label for="conflictResolution" class="font:bold">競合解決方法</label>
				<p class="fg:theme-text-secondary font:.875rem">
					同じデータが複数の端末で編集された場合の処理方法を選択します。
				</p>
				<select
					id="conflictResolution"
					bind:value={settings.conflictResolution}
					onchange={saveSettings}
					class="px:.75rem py:.5rem b:2px|solid|theme-text r:8px bg:theme-background fg:theme-text"
				>
					<option value="manual">手動で選択（推奨）</option>
					<option value="local">常にこの端末の変更を優先</option>
					<option value="remote">常にクラウドの変更を優先</option>
				</select>
				<div
					class="px:1rem py:.75rem r:6px"
					style="background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);"
				>
					{#if settings.conflictResolution === 'manual'}
						<p class="font:.875rem">
							競合が発生した場合、どちらの変更を採用するか手動で選択できます。
						</p>
					{:else if settings.conflictResolution === 'local'}
						<p class="font:.875rem fg:theme-warning">
							⚠️ クラウドの変更が自動的に破棄されます。他の端末での編集が失われる可能性があります。
						</p>
					{:else if settings.conflictResolution === 'remote'}
						<p class="font:.875rem fg:theme-warning">
							⚠️ この端末の変更が自動的に破棄されます。ローカルでの編集が失われる可能性があります。
						</p>
					{/if}
				</div>
			</div>

			{#if isFirebaseInitialized()}
				<div class="flex">
					<div class="flex ai:center gap:.5rem">
						<span
							class="w:1rem h:1rem block r:full {syncStore.status === 'synced'
								? 'bg:theme-success'
								: syncStore.status === 'syncing'
									? 'bg:theme-wraning'
									: syncStore.status === 'error'
										? 'bg:theme-error'
										: 'bg:theme-border'}"
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
					class="px:1rem py:1em b:2px|solid|theme-warning r:8px flex flex-direction:column gap:1rem"
					style="background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);"
				>
					<p class="font:bold fg:theme-warning">Firebase連携が設定されていません</p>
					<a href="/setup" class=""> Firebase設定ページへ → </a>
				</div>
			{/if}
		</div>
	</Card>

	<!-- ショートカットキー -->
	<Card class="b:2px|solid|var(--color-text)  flex flex-direction:column gap:1rem">
		<h2 class="font:bold">ショートカットキー</h2>

		<div class="flex flex-direction:column gap:.6rem">
			{#each Object.entries(settings.shortcuts) as [action, key]}
				<div class="flex flex-direction:row ai:center jc:space-between">
					<span class="capitalize">{action.replace(/([A-Z])/g, ' $1')}</span>
					<kbd class="px:.4rem py:.1rem bg:theme-border b:1px|solid|theme-text-secondary r:6px">
						{key}
					</kbd>
				</div>
			{/each}
		</div>
	</Card>

	<!-- データ管理 -->
	<Card class="b:2px|solid|var(--color-text)  flex flex-direction:column gap:1rem">
		<h2 class="font:bold">データ管理</h2>

		<div class="flex flex-direction:column gap:1rem">
			<div class="flex flex-direction:column gap:.6rem">
				<Button
					onclick={() => (showExportModal = true)}
					class="p:.5rem|1rem b:2px|solid|theme-text"
				>
					全データをエクスポート
				</Button>
				<p class="">すべてのプロジェクトをJSONファイルとしてバックアップします。</p>
			</div>

			<div class="flex flex-direction:column gap:.6rem">
				<Button
					onclick={() => (showImportModal = true)}
					variant="secondary"
					class="p:.5rem|1rem b:2px|solid|theme-text"
				>
					データをインポート
				</Button>
				<p class="">バックアップファイルからプロジェクトを復元します。</p>
			</div>

			<div class="flex flex-direction:column gap:.6rem">
				<Button
					onclick={() => (showClearDataModal = true)}
					variant="danger"
					class="p:.5rem|1rem b:2px|solid|theme-text"
				>
					全データを削除
				</Button>
				<p class="">すべてのプロジェクトとキャッシュを削除します。この操作は取り消せません。</p>
			</div>
		</div>
	</Card>

	<!-- バージョン情報 -->
	<Card class="b:2px|solid|var(--color-text)  flex flex-direction:column gap:1rem">
		<h2 class="font:bold">バージョン情報</h2>
		<div class="fg:theme-text-secondary">
			<p>Storift v0.0.1</p>
			<p>&copy shiki 2025</p>
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
