<script lang="ts">
	// 設定「同期」: Firebase 接続・同期状態・競合ポリシー・バックアップ・同期診断・完全同期
	import { toast } from '$lib/stores/toast.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ConflictBackups from '$lib/components/ui/ConflictBackups.svelte';
	import { isFirebaseInitialized } from '$lib/firebase/config';
	import { stopAllRealtimeSync } from '$lib/firebase/sync';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { resolve } from '$app/paths';
	import { getSyncMetrics, type SyncMetric } from '$lib/utils/syncMetrics';
	import SettingsCard from './SettingsCard.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import type { SettingsForm } from './settingsForm.svelte';

	let { form }: { form: SettingsForm } = $props();

	let backupsOpen = $state(false);
	let fullSyncRunning = $state(false);

	// 完全同期: 全件を取得して照合し、他端末での削除も検知する
	const handleFullSync = async () => {
		fullSyncRunning = true;
		try {
			const { runFullSync } = await import('$lib/services/sync.service');
			await runFullSync();
			toast.success('完全同期が完了しました');
		} catch (error) {
			toast.error(`完全同期に失敗しました: ${error instanceof Error ? error.message : error}`);
		} finally {
			fullSyncRunning = false;
		}
	};
	let syncMetrics = $state<SyncMetric[]>([]);
	const metricKindLabels: Record<SyncMetric['kind'], string> = {
		processPendingChanges: '送信',
		download: 'ダウンロード',
		applyRealtime: 'リアルタイム受信',
		conflictAutoResolved: '競合を自動解決'
	};

	// 同期設定の変更
	const handleSyncToggle = async () => {
		const wasEnabled = form.settings.syncEnabled;
		form.settings.syncEnabled = !form.settings.syncEnabled;
		await form.save();

		console.log(
			`🔄 Sync toggle: ${wasEnabled ? 'ON' : 'OFF'} -> ${form.settings.syncEnabled ? 'ON' : 'OFF'}`
		);

		// Firebase同期の開始/停止
		if (typeof window !== 'undefined') {
			if (!isFirebaseInitialized()) {
				console.log('ℹ️ Firebase not configured, sync setting saved but no action taken');
				return;
			}

			if (form.settings.syncEnabled && !wasEnabled) {
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
			} else if (!form.settings.syncEnabled && wasEnabled) {
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
</script>

<!-- 同期設定 -->
<SettingsCard
	data-tour="settings-sync"
	title="クラウド同期"
	description="Firebase 連携が設定されている場合、プロジェクトデータを自動的にクラウドへ同期します。"
>
	<SettingsRow
		label="クラウド同期を有効にする"
		description="オフにすると、この端末内だけで保存します。"
		labelFor="syncEnabled"
	>
		<input
			id="syncEnabled"
			type="checkbox"
			checked={form.settings.syncEnabled}
			onchange={handleSyncToggle}
		/>
	</SettingsRow>

	{#if isFirebaseInitialized()}
		<SettingsRow label="同期の状態">
			<span class="status">
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
						{form.settings.syncEnabled ? '同期済み' : '同期無効'}
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
			</span>
			{#if syncStore.lastSyncTime}
				<span class="font:12 fg:theme-text-secondary">
					最終同期: {new Date(syncStore.lastSyncTime).toLocaleString('ja-JP')}
				</span>
			{/if}
		</SettingsRow>
	{:else}
		<div
			class="px:1rem py:1em b:1px|solid|theme-warning r:8px flex flex:column gap:.5rem mt:8"
			style="background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);"
		>
			<p class="font:bold fg:theme-warning">Firebase連携が設定されていません</p>
			<a href={resolve('/setup')} class="fg:theme-primary"> Firebase設定ページへ → </a>
		</div>
	{/if}
</SettingsCard>

<SettingsCard
	title="競合の扱い"
	description="同じデータが複数の端末で編集されたときの処理方法を選びます。"
>
	<SettingsRow
		stacked
		label="競合解決方法"
		labelFor="conflictResolution"
		description="競合した版は、下の「同期バックアップ」から復元できます。"
	>
		<select
			id="conflictResolution"
			bind:value={form.settings.conflictResolution}
			onchange={form.save}
			class="px:.75rem py:.5rem pr:30 b:1px|solid|theme-border r:8px fg:theme-text"
		>
			<option value="manual">手動で選択（推奨）</option>
			<option value="local">常にこの端末の変更を優先</option>
			<option value="remote">常にクラウドの変更を優先</option>
		</select>
	</SettingsRow>
	<div
		class="px:1rem py:.75rem r:6px"
		style="background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);"
	>
		{#if form.settings.conflictResolution === 'manual'}
			<p class="font:.875rem">競合が発生した場合、どちらの変更を採用するか手動で選択できます。</p>
		{:else if form.settings.conflictResolution === 'local'}
			<p class="font:.875rem fg:theme-warning">
				⚠️ クラウドの変更が自動的に破棄されます。他の端末での編集が失われる可能性があります。
			</p>
		{:else if form.settings.conflictResolution === 'remote'}
			<p class="font:.875rem fg:theme-warning">
				⚠️ この端末の変更が自動的に破棄されます。ローカルでの編集が失われる可能性があります。
			</p>
		{/if}
	</div>
</SettingsCard>

<SettingsCard
	title="バックアップと同期の保守"
	description="同期の履歴の確認や、全件の照合を行います。"
>
	<SettingsRow
		label="同期バックアップ"
		description="競合や他端末の削除で上書きされた版は90日間保存され、ここから復元できます。"
	>
		<Button variant="secondary" onclick={() => (backupsOpen = true)}>バックアップを表示</Button>
	</SettingsRow>
	<ConflictBackups bind:isOpen={backupsOpen} />

	{#if isFirebaseInitialized() && form.settings.syncEnabled}
		<SettingsRow
			label="完全同期"
			description="通常は前回からの変更分だけを取得します。全件を取得して照合し直し、他の端末での削除も反映します(データ量が多いと時間がかかります)。"
		>
			<Button
				variant="secondary"
				disabled={fullSyncRunning || syncStore.isSyncing}
				onclick={handleFullSync}>{fullSyncRunning ? '完全同期中...' : '完全同期を実行'}</Button
			>
		</SettingsRow>
	{/if}
</SettingsCard>

<SettingsCard title="診断" description="直近の同期処理の所要時間を確認します。">
	<div class="diag">
		<details
			class="flex flex:column gap:.5rem"
			ontoggle={(e) => {
				if (e.currentTarget.open) syncMetrics = getSyncMetrics();
			}}
		>
			<summary class="font:bold cursor:pointer">同期診断</summary>
			<p class="fg:theme-text-secondary font:.875rem mt:8">
				直近の同期処理の所要時間と件数です(最大50件。再読み込みで消えます)。
			</p>
			<div class="mt:8">
				<Button variant="secondary" onclick={() => (syncMetrics = getSyncMetrics())}>更新</Button>
			</div>
			{#if syncMetrics.length === 0}
				<p class="fg:theme-text-secondary font:.875rem mt:8">記録はまだありません。</p>
			{:else}
				<ul class="flex flex:column gap:.25rem mt:8 font:12 list-style:none p:0">
					{#each syncMetrics as m (m.at + m.kind + (m.label ?? '') + m.durationMs)}
						<li class={m.ok ? '' : 'fg:theme-error'}>
							{new Date(m.at).toLocaleTimeString('ja-JP')}
							{metricKindLabels[m.kind]}{m.label ? `(${m.label})` : ''}:
							{m.kind === 'conflictAutoResolved'
								? ''
								: `${Math.round(m.durationMs)}ms / `}{m.count}件{m.skipped !== undefined
								? ` (スキップ ${m.skipped}件)`
								: ''}{m.ok ? '' : ' / 失敗'}
						</li>
					{/each}
				</ul>
			{/if}
		</details>
	</div>
</SettingsCard>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.diag {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-top: 8px;
	}
</style>
