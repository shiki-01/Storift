<script lang="ts">
	// 設定「共有」: 表示名・他の人のカーソル・アクセス/設定コード/ルール・接続診断
	import AccessSettings from '$lib/components/ui/AccessSettings.svelte';
	import DisplayNameSetting from '$lib/components/ui/DisplayNameSetting.svelte';
	import RemoteCursorSetting from '$lib/components/ui/RemoteCursorSetting.svelte';
	import AccessDiagnostics from '$lib/components/ui/AccessDiagnostics.svelte';
	import { isFirebaseInitialized } from '$lib/firebase/config';
	import SettingsCard from './SettingsCard.svelte';
</script>

<!-- 共有時の表示名 -->
<DisplayNameSetting />

<!-- 共同編集での他の人のカーソル表示 -->
<RemoteCursorSetting />

<!-- オーナー鍵・設定コード・Firebase ルール -->
<AccessSettings />

{#if isFirebaseInitialized()}
	<SettingsCard title="診断" description="Firebase への接続とアクセス権の状態を確認します。">
		<AccessDiagnostics />
	</SettingsCard>
{/if}
