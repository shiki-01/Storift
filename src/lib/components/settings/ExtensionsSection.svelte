<script lang="ts">
	// 設定「拡張機能」: 拡張を 1 つずつのカードで並べる(有効/無効・プライバシー・拡張固有の設定)。
	// 拡張の名前・説明・対応環境・扱う情報は、各拡張のマニフェスト(extensions/<id>/manifest.json)から出す
	import SettingsCard from './SettingsCard.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import ExtensionCard from './ExtensionCard.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { extensionHost } from '$lib/extensions/host.svelte';
	import { IDLE_MINUTES_OPTIONS } from '$lib/extensions/session';
	import { sessionSettings } from '$lib/extensions/sessionSettings.svelte';
</script>

<p class="intro">
	Storift
	に機能を足します。既定はすべて無効で、有効にするときは、その拡張が扱う情報を確認して同意します。有効/無効と同意の記録はこの端末だけのもので、同期やバックアップには含まれません。
</p>

<div class="list">
	{#each extensionHost.extensions as ext (ext.manifest.id)}
		<ExtensionCard extension={ext} />
	{/each}
</div>

<SettingsCard
	title="執筆セッション"
	description="拡張が使う「執筆している時間」の判定です。最初の編集で始まり、一定時間編集がなければ終わります。AI の提案の適用は含めません。"
>
	<SettingsRow
		label="無操作で終了するまでの時間"
		labelFor="session-idle"
		description="最後の編集からこの時間操作がなければ、執筆セッションを終了します。"
	>
		<Select
			id="session-idle"
			value={String(sessionSettings.value.idleMinutes)}
			onchange={(v) => sessionSettings.update({ idleMinutes: Number(v) })}
			options={IDLE_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: `${m} 分` }))}
		/>
	</SettingsRow>
</SettingsCard>

<style>
	.intro {
		margin: 0 0 4px;
		font-size: 13px;
		line-height: 1.7;
		color: var(--color-text-secondary);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
