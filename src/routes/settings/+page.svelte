<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import { onMount } from 'svelte';
	import { db, settingsDB } from '$lib/db';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import {
		DEFAULT_SHORTCUTS,
		FIXED_SHORTCUTS,
		SHORTCUT_LABELS,
		eventToShortcut,
		findConflicts,
		type ShortcutAction
	} from '$lib/utils/shortcuts';
	import { themeStore, themes } from '$lib/stores/theme.svelte';
	import { exportAllProjects, exportAsJson } from '$lib/services/export.service';
	import { importFromJson } from '$lib/services/import.service';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ConflictBackups from '$lib/components/ui/ConflictBackups.svelte';
	import NotificationSettings from '$lib/components/ui/NotificationSettings.svelte';
	import ClaudeSettings from '$lib/components/desktop/ClaudeSettings.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import type { AppSettings } from '$lib/types/settings';
	import { isFirebaseInitialized } from '$lib/firebase/config';
	import { setupRealtimeSync, stopAllRealtimeSync } from '$lib/firebase/sync';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { notificationService } from '$lib/services/notification.service';
	import { version as buildVersion } from '$app/environment';
	import { getServiceWorkerVersion, checkForUpdate } from '$lib/utils/sw-register';

	let backupsOpen = $state(false);

	let settings = $state<Omit<AppSettings, 'id' | 'updatedAt'>>({
		theme: themeStore.theme.id as 'light' | 'dark' | 'auto',
		autoTheme: themeStore.isAutoTheme,
		autoSave: true,
		autoSaveInterval: 30000,
		syncEnabled: true,
		conflictResolution: 'manual',
		editorFormatting: {
			fontSize: 16,
			lineHeight: 2,
			letterSpacing: 0,
			paragraphSpacing: 16
		},
		shortcuts: { ...DEFAULT_SHORTCUTS },
		exportPatterns: []
	});

	// 自動保存の最大待ち時間は画面では秒で扱う
	let autoSaveSeconds = $state(30);
	let recordingAction = $state<ShortcutAction | null>(null);
	let conflicts = $derived(findConflicts(settings.shortcuts));

	let swVersion = $state<string | null>(null);
	let checkingUpdate = $state(false);

	async function handleCheckUpdate() {
		checkingUpdate = true;
		try {
			await checkForUpdate();
			toast.info('更新を確認しました。新しいバージョンがあれば自動で切り替わります');
		} finally {
			checkingUpdate = false;
		}
	}

	let showImportModal = $state(false);
	let showExportModal = $state(false);
	let showClearDataModal = $state(false);
	let importFile: File | null = $state(null);
	let importProgress = $state('');
	let exportFormat = $state<'json' | 'all'>('json');

	// Phase 2: 通知システム初期化
	onMount(() => {
		void getServiceWorkerVersion().then((v) => (swVersion = v));
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

			// 既存の設定(エディタのフォントなど、この画面で扱わない項目)を保ったまま上書きする。
			// Svelte のリアクティブなプロパティは、プレーンな値に変換してから保存する
			const plainSettings = {
				...existing,
				id: 'app-settings' as const,
				theme: settings.theme,
				autoTheme: settings.autoTheme,
				autoSave: settings.autoSave,
				autoSaveInterval: settings.autoSaveInterval,
				syncEnabled: settings.syncEnabled,
				conflictResolution: settings.conflictResolution,
				editorFormatting: { ...settings.editorFormatting },
				shortcuts: { ...settings.shortcuts },
				exportPatterns: existing?.exportPatterns || [],
				updatedAt: Date.now()
			} as AppSettings;

			await db.settings.put(plainSettings);
			// 他の画面(エディタなど)にもすぐ反映する
			settingsStore.settings = { ...settingsStore.settings, ...plainSettings };
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	};

	// 設定の読み込み
	const loadSettings = async () => {
		try {
			const raw = await db.settings.get('app-settings');
			if (raw) {
				// 旧バージョンの値は settingsDB.get() で新しい仕様にそろえる
				const saved = await settingsDB.get();
				settings.theme = saved.theme;
				settings.autoTheme = saved.autoTheme;
				settings.autoSave = saved.autoSave;
				settings.autoSaveInterval = saved.autoSaveInterval;
				autoSaveSeconds = Math.round(saved.autoSaveInterval / 1000);
				settings.syncEnabled = saved.syncEnabled;
				settings.conflictResolution = saved.conflictResolution || 'manual';
				settings.editorFormatting = saved.editorFormatting || settings.editorFormatting;
				settings.shortcuts = { ...saved.shortcuts };
			}
		} catch (error) {
			console.error('Failed to load settings:', error);
		}
	};

	// 自動保存
	const handleAutoSaveToggle = async () => {
		settings.autoSave = !settings.autoSave;
		await saveSettings();
	};

	const handleAutoSaveSeconds = async () => {
		const seconds = Math.min(Math.max(Math.round(Number(autoSaveSeconds)) || 30, 5), 300);
		autoSaveSeconds = seconds;
		settings.autoSaveInterval = seconds * 1000;
		await saveSettings();
	};

	// ショートカットの割り当て: 「変更」を押したあとに押したキーを記録する
	const startRecording = (action: ShortcutAction) => {
		recordingAction = action;
	};

	const resetShortcut = async (action: ShortcutAction) => {
		settings.shortcuts[action] = DEFAULT_SHORTCUTS[action];
		await saveSettings();
	};

	$effect(() => {
		if (!recordingAction) return;
		const action = recordingAction;
		const onKeydown = async (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				recordingAction = null;
				return;
			}
			const shortcut = eventToShortcut(e);
			if (!shortcut) return; // 修飾キーだけの間は待つ
			e.preventDefault();
			e.stopPropagation();
			settings.shortcuts[action] = shortcut;
			recordingAction = null;
			await saveSettings();
		};
		window.addEventListener('keydown', onKeydown, true);
		return () => window.removeEventListener('keydown', onKeydown, true);
	});

	// エクスポート
	const handleExport = async () => {
		try {
			if (exportFormat === 'json') {
				await exportAllProjects();
			}
			showExportModal = false;
		} catch (error) {
			console.error('Export failed:', error);
			toast.error('エクスポートに失敗しました');
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
			toast.success('キャッシュをクリアしました');
			showClearDataModal = false;
		} catch (error) {
			toast.error('キャッシュのクリアに失敗しました');
		}
	};

	// 全データ削除
	const handleClearAllData = async () => {
		try {
			await db.delete();
			await db.open();
			await handleClearCache();
			toast.success('全データを削除しました。ページをリロードします。');
			window.location.href = '/';
		} catch (error) {
			toast.error('データの削除に失敗しました');
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

<div class="settings-scroll">
	<div class="settings-page">
		<h1 class="settings-title">設定</h1>

		{#if isDesktop()}
			<Card class="flex flex-direction:column gap:1rem b:1px|solid|theme-border">
				<h2 id="claude" class="font:bold">Claude Code</h2>
				<ClaudeSettings />
			</Card>
		{/if}

		<!-- テーマ設定 -->
		<Card class="flex flex-direction:column gap:1rem b:1px|solid|theme-border">
			<h2 class="font:bold">テーマ</h2>

			<div>
				<label class="flex align-items:center gap:.5rem cursor:pointer">
					<input type="checkbox" checked={settings.autoTheme} onchange={handleAutoThemeToggle} />
					<span>システム設定に従う</span>
				</label>
			</div>

			<!-- テーマの見本: 紙の色に、題字と本文の線、差し色の点を載せる -->
			<div class="theme-grid" role="radiogroup" aria-label="テーマ">
				{#each Object.values(themes) as theme (theme.id)}
					{@const selected = settings.theme === theme.id && !settings.autoTheme}
					<button
						class="theme-card"
						class:selected
						role="radio"
						aria-checked={selected}
						onclick={() => handleThemeChange(theme.id)}
						disabled={settings.autoTheme}
					>
						<span
							class="theme-swatch"
							style="background:{theme.editor.background};color:{theme.colors
								.text};border-color:{theme.colors.border}"
						>
							<span class="swatch-title">あ</span>
							<span class="swatch-lines">
								<span style="background:{theme.colors.text}"></span>
								<span style="background:{theme.colors.textSecondary}"></span>
								<span style="background:{theme.colors.textSecondary}"></span>
							</span>
							<span class="swatch-dots">
								<span style="background:{theme.colors.primary}"></span>
								<span style="background:{theme.colors.accent}"></span>
								<span style="background:{theme.colors.success}"></span>
							</span>
						</span>
						<span class="theme-name">
							{theme.name}
							{#if selected}
								<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"
									><path
										d="M2.5 6.2l2.3 2.3 4.7-5"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									/></svg
								>
							{/if}
						</span>
					</button>
				{/each}
			</div>
		</Card>

		<!-- Phase 2: 通知設定 -->
		<Card class="b:1px|solid|theme-border">
			<h2 class="font:bold">通知とリマインダー</h2>
			{#if currentProjectStore.project}
				<NotificationSettings projectId={currentProjectStore.project.id} />
			{:else}
				<p class="fg:theme-text-secondary">プロジェクトを開いて通知を設定してください</p>
			{/if}
		</Card>

		<!-- 書式設定 -->
		<Card class="b:1px|solid|theme-border flex flex-direction:column gap:1rem">
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
				<div class="p:1rem b:1px|solid|theme-border r:8px bg:theme-surface">
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
		<Card class="b:1px|solid|theme-border  flex flex-direction:column gap:1rem">
			<h2 class="font:bold">同期</h2>

			<div class="flex flex-direction:column gap:1rem">
				<div>
					<label class="flex ai:center gap:.5rem cursor:pointer">
						<input type="checkbox" checked={settings.syncEnabled} onchange={handleSyncToggle} />
						<span>クラウド同期を有効にする</span>
					</label>
					<p class="fg:theme-text-secondary font:.875rem mt:6 ml:26">
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
						class="px:.75rem py:.5rem pr:30 b:1px|solid|theme-border r:8px fg:theme-text"
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
								⚠️
								クラウドの変更が自動的に破棄されます。他の端末での編集が失われる可能性があります。
							</p>
						{:else if settings.conflictResolution === 'remote'}
							<p class="font:.875rem fg:theme-warning">
								⚠️
								この端末の変更が自動的に破棄されます。ローカルでの編集が失われる可能性があります。
							</p>
						{/if}
					</div>
				</div>

				<div class="flex flex-direction:column gap:.5rem">
					<span class="font:bold">同期バックアップ</span>
					<p class="fg:theme-text-secondary font:.875rem">
						競合や他端末の削除で上書きされた版は90日間保存され、ここから復元できます。
					</p>
					<div>
						<Button variant="secondary" onclick={() => (backupsOpen = true)}
							>バックアップを表示</Button
						>
					</div>
				</div>
				<ConflictBackups bind:isOpen={backupsOpen} />

				{#if isFirebaseInitialized()}
					<div class="flex">
						<div class="flex ai:center gap:.5rem">
							<span
								class="w:1rem h:1rem block r:full {syncStore.status === 'synced'
									? 'bg:theme-success'
									: syncStore.status === 'syncing'
										? 'bg:theme-warning'
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
							<p class="font:12 fg:theme-text-secondary mt:4">
								最終同期: {new Date(syncStore.lastSyncTime).toLocaleString('ja-JP')}
							</p>
						{/if}
					</div>
				{:else}
					<div
						class="px:1rem py:1em b:1px|solid|theme-warning r:8px flex flex-direction:column gap:1rem"
						style="background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);"
					>
						<p class="font:bold fg:theme-warning">Firebase連携が設定されていません</p>
						<a href="/setup" class="fg:theme-primary"> Firebase設定ページへ → </a>
					</div>
				{/if}
			</div>
		</Card>

		<!-- エディタ(自動保存) -->
		<Card class="b:1px|solid|theme-border flex flex-direction:column gap:1rem">
			<h2 class="font:bold">エディタ</h2>

			<label class="flex ai:center gap:.5rem cursor:pointer">
				<input type="checkbox" checked={settings.autoSave} onchange={handleAutoSaveToggle} />
				<span>自動保存を有効にする</span>
			</label>
			<p class="fg:theme-text-secondary font:.875rem">
				入力が止まって約2秒後に保存します。オフにすると、Ctrl+S や「今すぐ保存」で保存します。
			</p>

			{#if settings.autoSave}
				<label class="flex flex-direction:column gap:.5rem">
					<span>入力し続けているときの最大の待ち時間（秒）</span>
					<input
						type="number"
						min="5"
						max="300"
						step="5"
						bind:value={autoSaveSeconds}
						onchange={handleAutoSaveSeconds}
						class="w:8rem px:.75rem py:.5rem b:1px|solid|theme-border r:8px bg:theme-background fg:theme-text"
					/>
				</label>
			{/if}
		</Card>

		<!-- ショートカットキー -->
		<Card class="b:1px|solid|theme-border  flex flex-direction:column gap:1rem">
			<h2 class="font:bold">ショートカットキー</h2>
			<p class="fg:theme-text-secondary font:.875rem">
				「変更」を押してからキーを押すと割り当てられます（Ctrl または Alt
				と組み合わせてください）。Mac では Cmd が Ctrl として扱われます。
			</p>

			<div class="flex flex-direction:column gap:.6rem">
				{#each Object.entries(settings.shortcuts) as [name, key] (name)}
					{@const action = name as ShortcutAction}
					{@const fixed = FIXED_SHORTCUTS.includes(action)}
					<div class="flex flex-direction:row ai:center jc:space-between gap:.75rem">
						<span>{SHORTCUT_LABELS[action]}</span>
						<span class="flex ai:center gap:.5rem">
							<kbd class="shortcut-key" class:recording={recordingAction === action}>
								{recordingAction === action ? 'キーを押してください…' : key}
							</kbd>
							{#if fixed}
								<span class="fg:theme-text-secondary font:.75rem">固定</span>
							{:else}
								<button class="link-btn" onclick={() => startRecording(action)}>変更</button>
								{#if key !== DEFAULT_SHORTCUTS[action]}
									<button class="link-btn" onclick={() => resetShortcut(action)}>初期値</button>
								{/if}
							{/if}
						</span>
					</div>
				{/each}
			</div>

			{#each conflicts as group (group.join())}
				<p class="fg:theme-warning font:.875rem" role="alert">
					{group.map((a) => SHORTCUT_LABELS[a]).join('・')} に同じキーが割り当てられています。
				</p>
			{/each}
		</Card>

		<!-- データ管理 -->
		<Card class="b:1px|solid|theme-border  flex flex-direction:column gap:1rem">
			<h2 class="font:bold">データ管理</h2>

			<div class="flex flex-direction:column gap:1rem">
				<div class="flex flex-direction:column gap:.6rem">
					<Button
						onclick={() => (showExportModal = true)}
						class="p:.5rem|1rem b:1px|solid|theme-border"
					>
						全データをエクスポート
					</Button>
					<p class="">すべてのプロジェクトをJSONファイルとしてバックアップします。</p>
				</div>

				<div class="flex flex-direction:column gap:.6rem">
					<Button
						onclick={() => (showImportModal = true)}
						variant="secondary"
						class="p:.5rem|1rem b:1px|solid|theme-border"
					>
						データをインポート
					</Button>
					<p class="">バックアップファイルからプロジェクトを復元します。</p>
				</div>

				<div class="flex flex-direction:column gap:.6rem">
					<Button
						onclick={() => (showClearDataModal = true)}
						variant="danger"
						class="p:.5rem|1rem b:1px|solid|theme-border"
					>
						全データを削除
					</Button>
					<p class="">すべてのプロジェクトとキャッシュを削除します。この操作は取り消せません。</p>
				</div>
			</div>
		</Card>

		<!-- バージョン情報 -->
		<Card class="b:1px|solid|theme-border  flex flex-direction:column gap:1rem">
			<h2 class="font:bold">バージョン情報</h2>
			<div class="fg:theme-text-secondary">
				<p>Storift v0.0.1</p>
				<p class="font:.875rem">ビルド: {buildVersion}</p>
				<p class="font:.875rem">
					オフライン対応: {swVersion
						? `有効 (${swVersion})`
						: '未有効(初回の読み込み後に有効になります)'}
				</p>
				<button class="link-btn" onclick={handleCheckUpdate} disabled={checkingUpdate}>
					更新を確認
				</button>
				<p>&copy shiki 2025</p>
			</div>
		</Card>
	</div>
</div>

<!-- エクスポートモーダル -->
{#if showExportModal}
	<Modal
		title="データをエクスポート"
		onClose={() => (showExportModal = false)}
		onConfirm={handleExport}
	>
		<div class="flex flex-direction:column gap:16">
			<p>すべてのプロジェクトをエクスポートします。</p>

			<div>
				<label for="exportFormat" class="display:block mb:8 font:14 fg:theme-text-secondary"
					>形式</label
				>
				<select id="exportFormat" bind:value={exportFormat} class="w:full">
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
		<div class="flex flex-direction:column gap:16">
			<div>
				<label for="importFile" class="display:block mb:8 font:14 fg:theme-text-secondary"
					>バックアップファイルを選択</label
				>
				<input
					id="importFile"
					type="file"
					accept=".json"
					onchange={(e) => {
						const target = e.target as HTMLInputElement;
						importFile = target.files?.[0] || null;
					}}
					class="w:full"
				/>
			</div>

			{#if importProgress}
				<div class="p:12 bg:theme-surface r:8 font:14">
					{importProgress}
				</div>
			{/if}

			<p class="font:13 fg:theme-text-secondary">
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
		<div class="flex flex-direction:column gap:16">
			<p class="fg:theme-error font-semibold">
				⚠️ すべてのプロジェクト、キャラクター、プロット、設定資料が削除されます。
			</p>
			<p>この操作は取り消すことができません。事前にバックアップを取ることをお勧めします。</p>
			<p>本当に削除しますか?</p>
		</div>
	</Modal>
{/if}

<style>
	.shortcut-key {
		padding: 2px 8px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface);
		font-family: inherit;
		font-size: 13px;
	}

	.shortcut-key.recording {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.link-btn {
		border: none;
		background: transparent;
		padding: 4px 6px;
		font-size: 13px;
		color: var(--color-primary);
		cursor: pointer;
	}

	.settings-scroll {
		height: 100%;
		overflow-y: auto;
	}

	.settings-page {
		max-width: 48rem;
		margin: 0 auto;
		padding: 40px 48px 80px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}

	.theme-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0;
		border: none;
		background: none;
		color: var(--color-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.theme-card:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.theme-swatch {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
		aspect-ratio: 4 / 3;
		padding: 12px 14px;
		border: 1px solid;
		border-radius: 10px;
		transition:
			box-shadow 0.15s,
			transform 0.2s ease;
	}

	.theme-card:hover:not(:disabled) .theme-swatch {
		transform: translateY(-2px);
	}

	.theme-card.selected .theme-swatch {
		box-shadow:
			0 0 0 2px var(--color-background),
			0 0 0 4px var(--color-primary);
	}

	.swatch-title {
		font-family: 'Noto Serif JP', serif;
		font-size: 18px;
		font-weight: 600;
		line-height: 1;
	}

	.swatch-lines {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.swatch-lines span {
		height: 3px;
		border-radius: 2px;
		opacity: 0.55;
	}

	.swatch-lines span:nth-child(1) {
		width: 80%;
	}

	.swatch-lines span:nth-child(2) {
		width: 92%;
	}

	.swatch-lines span:nth-child(3) {
		width: 60%;
	}

	.swatch-dots {
		position: absolute;
		right: 12px;
		bottom: 10px;
		display: flex;
		gap: 4px;
	}

	.swatch-dots span {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.theme-name {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding-left: 2px;
		font-size: 13px;
	}

	.theme-card.selected .theme-name {
		font-weight: 600;
		color: var(--color-primary);
	}

	.settings-title {
		margin: 0 0 8px;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	/* 各項目の見出し */
	.settings-page :global(h2) {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	/* チェックボックスと文言の行 */
	.settings-page :global(label:has(> input[type='checkbox'])) {
		gap: 10px;
	}

	@media (max-width: 768px) {
		.settings-page {
			padding: 20px 16px 40px;
		}

		.theme-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
