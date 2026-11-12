<script lang="ts">
	// 設定「拡張機能」: 拡張の一覧と有効/無効の切り替え。有効にした拡張の設定をその下に出す
	import SettingsCard from './SettingsCard.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import { extensionHost } from '$lib/extensions/host.svelte';
	import MonologSettings from '$lib/extensions/builtin/monolog/MonologSettings.svelte';

	const platformLabel = { web: 'Web 版', desktop: 'デスクトップ版' } as const;
</script>

<SettingsCard
	title="拡張機能"
	description="Storift に機能を足します。有効/無効はこの端末だけの設定で、同期やバックアップには含まれません。既定はすべて無効です。"
>
	{#each extensionHost.extensions as ext (ext.manifest.id)}
		{@const supported = extensionHost.isSupported(ext.manifest.id)}
		<SettingsRow
			label={ext.manifest.name}
			labelFor={`ext-${ext.manifest.id}`}
			description={supported
				? ext.manifest.description
				: `${ext.manifest.description}(${ext.manifest.platforms.map((p) => platformLabel[p]).join('・')}で利用できます。この環境では使えません)`}
		>
			<input
				id={`ext-${ext.manifest.id}`}
				type="checkbox"
				checked={supported && extensionHost.isEnabled(ext.manifest.id)}
				disabled={!supported}
				onchange={(e) => void extensionHost.setEnabled(ext.manifest.id, e.currentTarget.checked)}
			/>
		</SettingsRow>
	{/each}
</SettingsCard>

{#if extensionHost.isEnabled('monolog') && extensionHost.isSupported('monolog')}
	<MonologSettings />
{/if}
