<script lang="ts">
	// 設定「このアプリについて」: バージョン・アップデート・チュートリアル
	import { onMount } from 'svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import UpdateSettings from '$lib/components/desktop/UpdateSettings.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { tourStore } from '$lib/tutorial/tour.svelte';
	import { version as buildVersion } from '$app/environment';
	import { getServiceWorkerVersion, checkForUpdate } from '$lib/utils/sw-register';
	import SettingsCard from './SettingsCard.svelte';
	import SettingsRow from './SettingsRow.svelte';

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

	onMount(() => {
		void getServiceWorkerVersion().then((v) => (swVersion = v));
	});
</script>

<SettingsCard title="バージョン情報">
	<div class="fg:theme-text-secondary">
		<div class="mb:12"><Logo variant="full" size={28} /></div>
		{#if isDesktop()}
			<UpdateSettings />
		{:else}
			<p>Storift v{__APP_VERSION__}</p>
			<p class="font:.875rem">ビルド: {buildVersion}</p>
			<p class="font:.875rem">
				オフライン対応: {swVersion
					? `有効 (${swVersion})`
					: '未有効(初回の読み込み後に有効になります)'}
			</p>
			<div class="mt:8">
				<Button variant="secondary" size="sm" onclick={handleCheckUpdate} disabled={checkingUpdate}>
					更新を確認
				</Button>
			</div>
		{/if}
		<p class="mt:12">&copy shiki 2025</p>
	</div>
</SettingsCard>

<SettingsCard title="使い方">
	<SettingsRow
		label="チュートリアル"
		description="サンプル作品を使った操作の案内を、もう一度見られます。"
	>
		<Button variant="secondary" onclick={() => tourStore.start()}
			>チュートリアルをもう一度見る</Button
		>
	</SettingsRow>
</SettingsCard>
