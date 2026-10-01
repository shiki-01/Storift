<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '$lib/db';
	import { themeStore, themes } from '$lib/stores/theme.svelte';
	import { exportAllProjects } from '$lib/services/export.service';
	import { importFromJson } from '$lib/services/import.service';
	import Modal from '$lib/components/ui/Modal.svelte';
	import NotificationSettings from '$lib/components/ui/NotificationSettings.svelte';
	import type { AppSettings } from '$lib/types/settings';
	import { isFirebaseInitialized } from '$lib/firebase/config';
	import { stopAllRealtimeSync } from '$lib/firebase/sync';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { conflictStore } from '$lib/stores/conflicts.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { notificationService } from '$lib/services/notification.service';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirmDialog } from '$lib/stores/confirm.svelte';
	import {
		DEFAULT_SHORTCUTS,
		SHORTCUT_LABELS,
		formatShortcut,
		isValidShortcut,
		type ShortcutAction
	} from '$lib/utils/shortcuts';

	const DEFAULT_FORMATTING = {
		fontSize: 16,
		lineHeight: 2,
		letterSpacing: 0,
		paragraphSpacing: 16
	};

	// 自動保存間隔は保存時はミリ秒（AppSettings.autoSaveInterval）、画面では秒で扱う
	const MIN_AUTO_SAVE_SEC = 10;
	const MAX_AUTO_SAVE_SEC = 300;

	let settings = $state<Omit<AppSettings, 'id' | 'updatedAt'>>({
		theme: themeStore.theme.id as 'light' | 'dark' | 'auto',
		autoTheme: themeStore.isAutoTheme,
		autoSave: true,
		autoSaveInterval: 30000,
		syncEnabled: true,
		conflictResolution: 'manual',
		editorFormatting: { ...DEFAULT_FORMATTING },
		shortcuts: { ...DEFAULT_SHORTCUTS },
		exportPatterns: []
	});

	let autoSaveSeconds = $state(30);

	let showImportModal = $state(false);
	let showExportModal = $state(false);
	let importFile: File | null = $state(null);
	let importProgress = $state('');
	let isImporting = $state(false);
	let exportFormat = $state<'json' | 'all'>('json');

	// ショートカット編集
	let recordingAction = $state<ShortcutAction | null>(null);
	let shortcutError = $state('');

	const formattingFields = [
		{
			key: 'fontSize',
			label: 'フォントサイズ',
			min: 12,
			max: 24,
			step: 1,
			format: (v: number) => `${v}px`,
			minLabel: '小 (12px)',
			maxLabel: '大 (24px)'
		},
		{
			key: 'lineHeight',
			label: '行間',
			min: 1,
			max: 3,
			step: 0.1,
			format: (v: number) => v.toFixed(1),
			minLabel: '狭い (1.0)',
			maxLabel: '広い (3.0)'
		},
		{
			key: 'letterSpacing',
			label: '字間',
			min: -0.05,
			max: 0.2,
			step: 0.01,
			format: (v: number) => `${v.toFixed(2)}em`,
			minLabel: '狭い (-0.05em)',
			maxLabel: '広い (0.2em)'
		},
		{
			key: 'paragraphSpacing',
			label: '段落間隔',
			min: 0,
			max: 48,
			step: 4,
			format: (v: number) => `${v}px`,
			minLabel: 'なし (0px)',
			maxLabel: '広い (48px)'
		}
	] as const;

	// UI 共通のクラス
	const sectionClass = 'b:2|solid|theme-text r:8 p:24 flex flex:column gap:16';
	const headingClass = 'font:18 font-weight:600 m:0';
	const hintClass = 'font:13 fg:theme-text-secondary m:0';
	const fieldClass =
		'px:12 py:8 b:2|solid|theme-text r:6 bg:theme-background fg:theme-text font:14 outline:none';
	const outlineButtonClass =
		'px:16 py:8 r:6 b:2|solid|theme-text bg:theme-background fg:theme-text font:14 cursor:pointer';
	const solidButtonClass =
		'px:16 py:8 r:6 b:2|solid|theme-text bg:theme-text fg:theme-background font:14 cursor:pointer';

	// 通知システム初期化
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

	// 自動保存間隔（秒 → ミリ秒）
	const handleAutoSaveIntervalChange = async () => {
		const seconds = Number.isFinite(autoSaveSeconds) ? autoSaveSeconds : 30;
		autoSaveSeconds = Math.min(MAX_AUTO_SAVE_SEC, Math.max(MIN_AUTO_SAVE_SEC, Math.round(seconds)));
		settings.autoSaveInterval = autoSaveSeconds * 1000;
		await saveSettings();
	};

	// 同期設定の変更
	const handleSyncToggle = async () => {
		const wasEnabled = settings.syncEnabled;
		settings.syncEnabled = !settings.syncEnabled;
		await saveSettings();

		// Firebase同期の開始/停止
		if (typeof window !== 'undefined') {
			if (!isFirebaseInitialized()) {
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
					}

					syncStore.status = 'synced';
					toast.success('クラウド同期を有効にしました');
				} catch (error) {
					console.error('Failed to start Firebase sync:', error);
					syncStore.status = 'error';
					syncStore.error = String(error);
					toast.error('クラウド同期の開始に失敗しました');
				}
			} else if (!settings.syncEnabled && wasEnabled) {
				// 同期を無効化した場合
				try {
					// 同期システムを完全に停止
					const { stopSync } = await import('$lib/services/sync.service');
					stopSync();
					stopAllRealtimeSync();
					syncStore.status = 'offline'; // オフライン状態に
					toast.info('クラウド同期を無効にしました');
				} catch (error) {
					console.error('Failed to stop Firebase sync:', error);
					toast.error('クラウド同期の停止に失敗しました');
				}
			}
		}
	};

	// 設定の保存
	const saveSettings = async (): Promise<boolean> => {
		try {
			// 既存の設定を取得してFirebase設定を保持
			const existing = await db.settings.get('app-settings');

			// プレーンなオブジェクトに変換（Svelteのリアクティブプロパティを除去）
			const plainSettings: AppSettings = {
				// editorFont / editorWritingMode / previewSettings など、この画面で扱わない項目はそのまま保持する
				...existing,
				id: 'app-settings' as const,
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
				shortcuts: { ...settings.shortcuts },
				exportPatterns: existing?.exportPatterns || [],
				updatedAt: Date.now()
			};

			await db.settings.put(plainSettings);
			// 他の画面（エディタなど）が参照するストアにも反映する
			settingsStore.settings = plainSettings;
			return true;
		} catch (error) {
			console.error('Failed to save settings:', error);
			toast.error('設定の保存に失敗しました');
			return false;
		}
	};

	// 設定の読み込み
	const loadSettings = async () => {
		try {
			const saved = await db.settings.get('app-settings');
			if (saved) {
				settings.theme = saved.theme;
				settings.autoTheme = saved.autoTheme;
				settings.autoSave = saved.autoSave ?? true;
				settings.autoSaveInterval = saved.autoSaveInterval ?? 30000;
				autoSaveSeconds = Math.round(settings.autoSaveInterval / 1000);
				settings.syncEnabled = saved.syncEnabled;
				settings.conflictResolution = saved.conflictResolution || 'manual';
				settings.editorFormatting = { ...DEFAULT_FORMATTING, ...saved.editorFormatting };
				settings.shortcuts = { ...DEFAULT_SHORTCUTS, ...saved.shortcuts };
				settingsStore.settings = { ...saved, autoSaveInterval: settings.autoSaveInterval };
			}
		} catch (error) {
			console.error('Failed to load settings:', error);
			toast.error('設定の読み込みに失敗しました');
		}
	};

	// 書式設定のリセット
	const resetFormatting = async () => {
		settings.editorFormatting = { ...DEFAULT_FORMATTING };
		if (await saveSettings()) toast.success('書式設定をデフォルトに戻しました');
	};

	// ショートカットの編集
	const startRecording = (action: ShortcutAction) => {
		shortcutError = '';
		recordingAction = action;
	};

	const stopRecording = () => {
		recordingAction = null;
	};

	const handleRecordKeydown = async (e: KeyboardEvent) => {
		if (!recordingAction) return;
		e.preventDefault();
		e.stopPropagation();

		if (e.key === 'Escape') {
			stopRecording();
			return;
		}

		const shortcut = formatShortcut(e);
		if (!shortcut) return; // 修飾キーのみ

		if (!isValidShortcut(shortcut)) {
			shortcutError = 'Ctrl または Alt と組み合わせたキーを指定してください';
			return;
		}

		const duplicate = (Object.keys(settings.shortcuts) as ShortcutAction[]).find(
			(a) => a !== recordingAction && settings.shortcuts[a] === shortcut
		);
		if (duplicate) {
			shortcutError = `${shortcut} は「${SHORTCUT_LABELS[duplicate]}」で使用中です`;
			return;
		}

		const action = recordingAction;
		settings.shortcuts[action] = shortcut;
		stopRecording();
		shortcutError = '';
		if (await saveSettings())
			toast.success(`「${SHORTCUT_LABELS[action]}」を ${shortcut} に変更しました`);
	};

	const resetShortcut = async (action: ShortcutAction) => {
		const conflict = (Object.keys(settings.shortcuts) as ShortcutAction[]).find(
			(a) => a !== action && settings.shortcuts[a] === DEFAULT_SHORTCUTS[action]
		);
		if (conflict) {
			shortcutError = `${DEFAULT_SHORTCUTS[action]} は「${SHORTCUT_LABELS[conflict]}」で使用中のため戻せません`;
			return;
		}
		shortcutError = '';
		settings.shortcuts[action] = DEFAULT_SHORTCUTS[action];
		await saveSettings();
	};

	const resetAllShortcuts = async () => {
		shortcutError = '';
		settings.shortcuts = { ...DEFAULT_SHORTCUTS };
		if (await saveSettings()) toast.success('ショートカットをデフォルトに戻しました');
	};

	// エクスポート
	const handleExport = async () => {
		try {
			if (exportFormat === 'json') {
				await exportAllProjects();
			}
			showExportModal = false;
			toast.success('エクスポートしました');
		} catch (error) {
			console.error('Export failed:', error);
			toast.error('エクスポートに失敗しました');
		}
	};

	// インポート
	const handleImport = async () => {
		if (!importFile) return;

		try {
			isImporting = true;
			importProgress = 'インポート中...';
			const result = await importFromJson(importFile);

			if (result.success) {
				toast.success(`${result.projectIds.length}件のプロジェクトをインポートしました`);
				showImportModal = false;
				importProgress = '';
				importFile = null;
			} else {
				importProgress = `エラー: ${result.errors.join(', ')}`;
				toast.error('インポートに失敗しました');
			}
		} catch (error) {
			importProgress = `エラー: ${error}`;
			toast.error('インポートに失敗しました');
		} finally {
			isImporting = false;
		}
	};

	// キャッシュクリア
	const clearCaches = async () => {
		if ('caches' in window) {
			const cacheNames = await caches.keys();
			await Promise.all(cacheNames.map((name) => caches.delete(name)));
		}
	};

	const handleClearCache = async () => {
		try {
			await clearCaches();
			toast.success('キャッシュをクリアしました');
		} catch (error) {
			console.error('Failed to clear cache:', error);
			toast.error('キャッシュのクリアに失敗しました');
		}
	};

	// 全データ削除
	const handleClearAllData = async () => {
		const confirmed = await confirmDialog({
			title: '全データを削除',
			message:
				'すべてのプロジェクト、キャラクター、プロット、設定資料が削除されます。\nこの操作は取り消せません。本当に削除しますか?',
			confirmText: '削除',
			danger: true
		});
		if (!confirmed) return;

		try {
			await db.delete();
			await db.open();
			await clearCaches();
			toast.success('全データを削除しました。ページをリロードします。');
			setTimeout(() => (window.location.href = '/'), 1200);
		} catch (error) {
			console.error('Failed to clear all data:', error);
			toast.error('データの削除に失敗しました');
		}
	};

	// ページ読み込み時に設定を読み込む
	onMount(async () => {
		await loadSettings();
		// 設定読み込み後、同期状態を確認
		if (isFirebaseInitialized() && settings.syncEnabled) {
			// 同期が有効な場合、現在のプロジェクトがあれば同期を確保
			const projectId = currentProjectStore.project?.id;
			if (projectId && syncStore.status === 'offline') {
				const { startCurrentProjectSync } = await import('$lib/services/sync.service');
				await startCurrentProjectSync(projectId);
			}
		}
	});
</script>

<svelte:head>
	<title>設定 | Storift</title>
</svelte:head>

<svelte:window onkeydowncapture={handleRecordKeydown} />

<div class="w:100% h:100% overflow-y:auto px:24 py:24">
	<div class="max-w:760 mx:auto flex flex:column gap:24">
		<h1 class="font:24 font-weight:600 m:0">設定</h1>

		<!-- テーマ設定 -->
		<section class={sectionClass}>
			<h2 class={headingClass}>テーマ</h2>

			<label class="flex align-items:center gap:8 cursor:pointer">
				<input type="checkbox" checked={settings.autoTheme} onchange={handleAutoThemeToggle} />
				<span>システム設定に従う</span>
			</label>

			<div class="flex flex:column gap:8">
				{#each Object.values(themes) as theme (theme.id)}
					<button
						type="button"
						onclick={() => handleThemeChange(theme.id)}
						aria-pressed={settings.theme === theme.id && !settings.autoTheme}
						class="p:12 r:8 b:2|solid|theme-text cursor:pointer flex ai:center jc:space-between gap:16 {settings.autoTheme
							? 'opacity:.5 cursor:not-allowed'
							: ''}"
						style="background-color: {theme.colors.background}; color: {theme.colors.text};"
						disabled={settings.autoTheme}
					>
						<span class="flex ai:center gap:8">
							<span class="w:16 inline-block text-align:center">
								{settings.theme === theme.id && !settings.autoTheme ? '✓' : ''}
							</span>
							{theme.name}
						</span>
						<span class="flex gap:8">
							<span class="w:8 h:8 r:full" style="background-color: {theme.colors.primary};"></span>
							<span class="w:8 h:8 r:full" style="background-color: {theme.colors.secondary};"
							></span>
							<span class="w:8 h:8 r:full" style="background-color: {theme.colors.accent};"></span>
						</span>
					</button>
				{/each}
			</div>
		</section>

		<!-- 通知設定 -->
		<section class={sectionClass}>
			<h2 class={headingClass}>通知とリマインダー</h2>
			{#if currentProjectStore.project}
				<NotificationSettings projectId={currentProjectStore.project.id} />
			{:else}
				<p class={hintClass}>プロジェクトを開いて通知を設定してください</p>
			{/if}
		</section>

		<!-- エディタ設定 -->
		<section class={sectionClass}>
			<h2 class={headingClass}>エディタ</h2>

			<label class="flex ai:center gap:8 cursor:pointer">
				<input type="checkbox" bind:checked={settings.autoSave} onchange={saveSettings} />
				<span>自動保存を有効にする</span>
			</label>

			{#if settings.autoSave}
				<div class="flex flex:column gap:8">
					<label for="autoSaveInterval" class="font:14 font-weight:600">自動保存間隔 (秒)</label>
					<input
						id="autoSaveInterval"
						type="number"
						bind:value={autoSaveSeconds}
						onchange={handleAutoSaveIntervalChange}
						min={MIN_AUTO_SAVE_SEC}
						max={MAX_AUTO_SAVE_SEC}
						class="{fieldClass} w:120"
					/>
					<p class={hintClass}>{MIN_AUTO_SAVE_SEC}〜{MAX_AUTO_SAVE_SEC}秒の範囲で指定できます。</p>
				</div>
			{/if}
		</section>

		<!-- 書式設定 -->
		<section class={sectionClass}>
			<h2 class={headingClass}>書式設定</h2>
			<p class={hintClass}>エディタのテキスト表示形式を一括で調整できます。</p>

			<div class="flex flex:column gap:24">
				{#each formattingFields as field (field.key)}
					<div class="flex flex:column gap:8">
						<div class="flex justify-content:space-between align-items:center">
							<label for={field.key} class="font:14 font-weight:600">{field.label}</label>
							<span class="fg:theme-text-secondary font:14">
								{field.format(settings.editorFormatting[field.key])}
							</span>
						</div>
						<input
							id={field.key}
							type="range"
							bind:value={settings.editorFormatting[field.key]}
							onchange={saveSettings}
							min={field.min}
							max={field.max}
							step={field.step}
							class="w:100%"
						/>
						<div class="flex justify-content:space-between fg:theme-text-secondary font:12">
							<span>{field.minLabel}</span>
							<span>{field.maxLabel}</span>
						</div>
					</div>
				{/each}

				<!-- プレビュー -->
				<div class="p:16 b:2|solid|theme-border r:8 bg:theme-surface">
					<p class="font:12 fg:theme-text-secondary m:0|0|8">プレビュー</p>
					<div
						class="fg:theme-text"
						style="
							font-size: {settings.editorFormatting.fontSize}px;
							line-height: {settings.editorFormatting.lineHeight};
							letter-spacing: {settings.editorFormatting.letterSpacing}em;
						"
					>
						<p style="margin: 0 0 {settings.editorFormatting.paragraphSpacing}px;">
							吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。
						</p>
						<p style="margin: 0;">
							何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。
						</p>
					</div>
				</div>

				<button type="button" onclick={resetFormatting} class="{outlineButtonClass} w:fit">
					デフォルトに戻す
				</button>
			</div>
		</section>

		<!-- 同期設定 -->
		<section class={sectionClass}>
			<h2 class={headingClass}>同期</h2>

			<div class="flex flex:column gap:4">
				<label class="flex ai:center gap:8 cursor:pointer">
					<input type="checkbox" checked={settings.syncEnabled} onchange={handleSyncToggle} />
					<span>クラウド同期を有効にする</span>
				</label>
				<p class={hintClass}>
					Firebase連携が設定されている場合、プロジェクトデータを自動的にクラウドに同期します。
				</p>
			</div>

			<div class="flex flex:column gap:8">
				<label for="conflictResolution" class="font:14 font-weight:600">競合解決方法</label>
				<p class={hintClass}>同じデータが複数の端末で編集された場合の処理方法を選択します。</p>
				<select
					id="conflictResolution"
					bind:value={settings.conflictResolution}
					onchange={saveSettings}
					class={fieldClass}
				>
					<option value="manual">手動で選択（推奨）</option>
					<option value="local">常にこの端末の変更を優先</option>
					<option value="remote">常にクラウドの変更を優先</option>
				</select>
				{#if settings.conflictResolution === 'manual'}
					<p class="font:13 m:0">
						競合が発生した場合、どちらの変更を採用するか手動で選択できます。
					</p>
				{:else}
					<p class="font:13 fg:theme-warning m:0">
						{settings.conflictResolution === 'local'
							? 'クラウドの変更が自動的に破棄されます。他の端末での編集が失われる可能性があります。'
							: 'この端末の変更が自動的に破棄されます。ローカルでの編集が失われる可能性があります。'}
					</p>
				{/if}
			</div>

			{#if conflictStore.count > 0}
				<div
					class="p:16 b:2|solid|theme-error r:8 flex ai:center jc:space-between gap:16 flex-wrap:wrap"
				>
					<p class="font:14 fg:theme-error m:0">
						未解決の競合が {conflictStore.count} 件あります。
					</p>
					<button type="button" onclick={() => conflictStore.open()} class={solidButtonClass}>
						競合を解決する
					</button>
				</div>
			{/if}

			{#if isFirebaseInitialized()}
				<div class="flex flex:column gap:4">
					<div class="flex ai:center gap:8">
						<span
							class="w:12 h:12 block r:full {syncStore.status === 'synced'
								? 'bg:theme-success'
								: syncStore.status === 'syncing'
									? 'bg:theme-warning'
									: syncStore.status === 'error' || syncStore.status === 'conflict'
										? 'bg:theme-error'
										: 'bg:theme-border'}"
						></span>
						<span class="font:14">
							{#if syncStore.status === 'synced'}
								{settings.syncEnabled ? '同期済み' : '同期無効'}
							{:else if syncStore.status === 'syncing'}
								同期中...
							{:else if syncStore.status === 'conflict'}
								競合があります
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
						<p class={hintClass}>
							最終同期: {new Date(syncStore.lastSyncTime).toLocaleString('ja-JP')}
						</p>
					{/if}
				</div>
			{:else}
				<div class="p:16 b:2|solid|theme-warning r:8 flex flex:column gap:8">
					<p class="font:14 font-weight:600 fg:theme-warning m:0">
						Firebase連携が設定されていません
					</p>
					<a href="/setup" class="fg:theme-primary font:14">Firebase設定ページへ →</a>
				</div>
			{/if}
		</section>

		<!-- ショートカットキー -->
		<section class={sectionClass}>
			<h2 class={headingClass}>ショートカットキー</h2>
			<p class={hintClass}>
				「変更」を押してから、割り当てたいキーの組み合わせを押してください（Esc でキャンセル）。
			</p>

			<div class="flex flex:column gap:8">
				{#each Object.keys(settings.shortcuts) as action (action)}
					{@const key = action as ShortcutAction}
					<div class="flex ai:center jc:space-between gap:12 flex-wrap:wrap">
						<span class="font:14">{SHORTCUT_LABELS[key]}</span>
						<div class="flex ai:center gap:8">
							{#if recordingAction === key}
								<kbd class="px:8 py:2 b:2|dashed|theme-primary r:6 font:13 fg:theme-primary">
									キーを押してください
								</kbd>
								<button type="button" onclick={stopRecording} class="{outlineButtonClass} font:13">
									キャンセル
								</button>
							{:else}
								<kbd class="px:8 py:2 bg:theme-surface b:1|solid|theme-border r:6 font:13">
									{settings.shortcuts[key]}
								</kbd>
								<button
									type="button"
									onclick={() => startRecording(key)}
									class="{outlineButtonClass} font:13"
								>
									変更
								</button>
								<button
									type="button"
									onclick={() => resetShortcut(key)}
									disabled={settings.shortcuts[key] === DEFAULT_SHORTCUTS[key]}
									class="{outlineButtonClass} font:13 opacity:.4:disabled cursor:not-allowed:disabled"
								>
									初期値
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			{#if shortcutError}
				<p class="font:13 fg:theme-error m:0" role="alert">{shortcutError}</p>
			{/if}

			<button type="button" onclick={resetAllShortcuts} class="{outlineButtonClass} w:fit">
				すべて初期値に戻す
			</button>
		</section>

		<!-- データ管理 -->
		<section class={sectionClass}>
			<h2 class={headingClass}>データ管理</h2>

			<div class="flex flex:column gap:4">
				<button
					type="button"
					onclick={() => (showExportModal = true)}
					class="{solidButtonClass} w:fit"
				>
					全データをエクスポート
				</button>
				<p class={hintClass}>すべてのプロジェクトをJSONファイルとしてバックアップします。</p>
			</div>

			<div class="flex flex:column gap:4">
				<button
					type="button"
					onclick={() => (showImportModal = true)}
					class="{outlineButtonClass} w:fit"
				>
					データをインポート
				</button>
				<p class={hintClass}>バックアップファイルからプロジェクトを復元します。</p>
			</div>

			<div class="flex flex:column gap:4">
				<button type="button" onclick={handleClearCache} class="{outlineButtonClass} w:fit">
					キャッシュをクリア
				</button>
				<p class={hintClass}>アプリのキャッシュを削除します。作品のデータは削除されません。</p>
			</div>

			<div class="flex flex:column gap:4">
				<button
					type="button"
					onclick={handleClearAllData}
					class="px:16 py:8 r:6 b:2|solid|theme-error bg:theme-background fg:theme-error font:14 cursor:pointer w:fit"
				>
					全データを削除
				</button>
				<p class={hintClass}>
					すべてのプロジェクトとキャッシュを削除します。この操作は取り消せません。
				</p>
			</div>
		</section>

		<!-- バージョン情報 -->
		<section class={sectionClass}>
			<h2 class={headingClass}>バージョン情報</h2>
			<div class="fg:theme-text-secondary font:14">
				<p class="m:0">Storift v0.0.1</p>
				<p class="m:0">&copy; shiki 2025</p>
			</div>
		</section>
	</div>
</div>

<!-- エクスポートモーダル -->
<Modal
	bind:isOpen={showExportModal}
	title="データをエクスポート"
	onConfirm={handleExport}
	confirmText="エクスポート"
>
	<div class="flex flex:column gap:16">
		<p class="m:0">すべてのプロジェクトをエクスポートします。</p>

		<div class="flex flex:column gap:8">
			<label for="exportFormat" class="font:14 font-weight:600">形式</label>
			<select id="exportFormat" bind:value={exportFormat} class={fieldClass}>
				<option value="json">JSON (バックアップ用)</option>
			</select>
		</div>
	</div>
</Modal>

<!-- インポートモーダル -->
<Modal
	bind:isOpen={showImportModal}
	title="データをインポート"
	onClose={() => {
		importProgress = '';
		importFile = null;
	}}
	onConfirm={handleImport}
	confirmText="インポート"
	confirmDisabled={!importFile || isImporting}
>
	<div class="flex flex:column gap:16">
		<div class="flex flex:column gap:8">
			<label for="importFile" class="font:14 font-weight:600">バックアップファイルを選択</label>
			<input
				id="importFile"
				type="file"
				accept=".json"
				onchange={(e) => {
					const target = e.target as HTMLInputElement;
					importFile = target.files?.[0] || null;
				}}
				class="w:100%"
			/>
		</div>

		{#if importProgress}
			<div class="p:12 bg:theme-surface b:1|solid|theme-border r:6" role="status">
				{importProgress}
			</div>
		{/if}

		<p class={hintClass}>
			※ 既存のプロジェクトと同じタイトルの場合、新しいプロジェクトとして追加されます。
		</p>
	</div>
</Modal>

<style>
	input[type='checkbox'],
	input[type='range'] {
		accent-color: var(--color-primary);
	}

	input[type='checkbox'] {
		width: 1rem;
		height: 1rem;
	}
</style>
