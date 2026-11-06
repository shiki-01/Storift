<script lang="ts">
	// 設定「AI」: プロバイダの選択(カード形式)
	import { aiStore } from '$lib/stores/ai.svelte';
	import { registry } from '$lib/ai/registry';

	const providers = registry.list();
</script>

<div class="notice" role="note">
	選んだプロバイダに、質問と原稿の一部(AI がツールで読んだ範囲)が送られます。
</div>

<div class="modes" role="radiogroup" aria-label="プロバイダ">
	{#each providers as p (p.id)}
		<label class="mode" class:on={aiStore.settings.provider === p.id} data-provider={p.id}>
			<input
				type="radio"
				name="ai-provider"
				value={p.id}
				checked={aiStore.settings.provider === p.id}
				onchange={() => aiStore.updateSettings({ provider: p.id })}
			/>
			<span class="mode-label">{p.label}</span>
			<span class="mode-hint">{p.description}</span>
			<span class="mode-meta"><b>必要なもの</b>{p.requires}</span>
			<span class="mode-meta"><b>送信先</b>{p.destination}</span>
		</label>
	{/each}
</div>

<style>
	.notice {
		padding: 10px 12px;
		border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
		border-radius: 10px;
		background: var(--selected);
		font-size: 13px;
		line-height: 1.7;
	}

	.mode-meta {
		grid-column: 2;
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.mode-meta b {
		margin-right: 8px;
		font-weight: 600;
	}
</style>
