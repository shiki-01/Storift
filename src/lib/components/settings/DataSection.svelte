<script lang="ts">
	// 設定「データ」: エクスポート・インポート・全データの削除
	import { toast } from '$lib/stores/toast.svelte';
	import { db } from '$lib/db';
	import { exportAllProjects } from '$lib/services/export.service';
	import { importFromJson } from '$lib/services/import.service';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import SettingsCard from './SettingsCard.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let showImportModal = $state(false);
	let showExportModal = $state(false);
	let showClearDataModal = $state(false);
	let importFile: File | null = $state(null);
	let importProgress = $state('');
	let exportFormat = $state<'json' | 'all'>('json');

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
		} catch {
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
		} catch {
			toast.error('データの削除に失敗しました');
		}
	};
</script>

<SettingsCard
	data-tour="settings-backup"
	title="バックアップ"
	description="すべてのプロジェクトを JSON ファイルとして書き出し、読み込めます。"
>
	<SettingsRow
		label="全データをエクスポート"
		description="すべてのプロジェクトをJSONファイルとしてバックアップします。"
	>
		<Button onclick={() => (showExportModal = true)}>エクスポート</Button>
	</SettingsRow>

	<SettingsRow
		label="データをインポート"
		description="バックアップファイルからプロジェクトを復元します。"
	>
		<Button onclick={() => (showImportModal = true)} variant="secondary">インポート</Button>
	</SettingsRow>
</SettingsCard>

<SettingsCard
	tone="danger"
	title="危険な操作"
	description="取り消せない操作です。実行する前にエクスポートでバックアップしてください。"
>
	<SettingsRow
		label="全データを削除"
		description="すべてのプロジェクトとキャッシュを削除します。この操作は取り消せません。"
	>
		<Button onclick={() => (showClearDataModal = true)} variant="danger">全データを削除</Button>
	</SettingsRow>
</SettingsCard>

<!-- エクスポートモーダル -->
{#if showExportModal}
	<Modal
		title="データをエクスポート"
		onClose={() => (showExportModal = false)}
		onConfirm={handleExport}
	>
		<div class="flex flex:column gap:16">
			<p>すべてのプロジェクトをエクスポートします。</p>

			<div>
				<label for="exportFormat" class="display:block mb:8 font:14 fg:theme-text-secondary"
					>形式</label
				>
				<Select
					id="exportFormat"
					bind:value={exportFormat}
					options={[{ value: 'json', label: 'JSON (バックアップ用)' }]}
				/>
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
		<div class="flex flex:column gap:16">
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
		<div class="flex flex:column gap:16">
			<div class="flex gap:8 fg:theme-error font-semibold">
				<Icon name="alert-triangle" class="ico mt:3" />
				<p>すべてのプロジェクト、キャラクター、プロット、設定資料が削除されます。</p>
			</div>
			<p>この操作は取り消すことができません。事前にバックアップを取ることをお勧めします。</p>
			<p>本当に削除しますか?</p>
		</div>
	</Modal>
{/if}
