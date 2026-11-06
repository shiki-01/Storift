<script lang="ts">
	// 設定「AI」(デスクトップ版のみ): プロバイダの選択と、選んだプロバイダの設定、本文の編集の扱い。
	// 新しいプロバイダを足すときは、src/lib/ai/providers/ に実装を追加し、ここへ設定フォームを 1 つ加える
	import { aiStore } from '$lib/stores/ai.svelte';
	import SettingsCard from './SettingsCard.svelte';
	import ProviderPicker from './ai/ProviderPicker.svelte';
	import ClaudeCodeForm from './ai/ClaudeCodeForm.svelte';
	import OllamaForm from './ai/OllamaForm.svelte';
	import OpenAiCompatibleForm from './ai/OpenAiCompatibleForm.svelte';
	import EditModeForm from './ai/EditModeForm.svelte';
</script>

<div class="ai-settings">
	<SettingsCard
		title="プロバイダ"
		description="質問に答える AI を選びます。選んだプロバイダに、質問と原稿の一部が送られます。"
	>
		<ProviderPicker />
	</SettingsCard>

	<SettingsCard title={aiStore.provider.label} data-ai-provider-settings={aiStore.provider.id}>
		<div class="form">
			{#if aiStore.provider.id === 'ollama'}
				<OllamaForm />
			{:else if aiStore.provider.id === 'openai-compatible'}
				<OpenAiCompatibleForm />
			{:else}
				<ClaudeCodeForm />
			{/if}
		</div>
	</SettingsCard>

	<SettingsCard title="本文の編集" description="AI が本文や項目を書き換えるときの扱いです。">
		<div class="form">
			<EditModeForm />
		</div>
	</SettingsCard>
</div>

<style>
	.ai-settings {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.form,
	.ai-settings :global(.modes) {
		display: flex;
		flex-direction: column;
		gap: 18px;
		font-size: 14px;
	}

	.ai-settings :global(.status) {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
	}

	.ai-settings :global(.dot) {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-text-secondary);
	}

	.ai-settings :global(.dot.ok) {
		background: var(--color-success);
	}

	.ai-settings :global(.dot.ng) {
		background: var(--color-error);
	}

	.ai-settings :global(.status-body) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.ai-settings :global(.status-main) {
		font-weight: 600;
	}

	.ai-settings :global(.status-actions) {
		display: flex;
		gap: 6px;
	}

	.ai-settings :global(.field) {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 12px;
		align-items: start;
	}

	.ai-settings :global(.field > label),
	.ai-settings :global(.field-label) {
		padding-top: 7px;
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.ai-settings :global(.field-body) {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	.ai-settings :global(select),
	.ai-settings :global(input[type='text']),
	.ai-settings :global(input[type='password']) {
		width: 100%;
		height: 36px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background-color: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 14px;
	}

	.ai-settings :global(.modes) {
		gap: 6px;
	}

	.ai-settings :global(.mode) {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 10px;
		row-gap: 2px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}

	.ai-settings :global(.mode:hover) {
		background: var(--hover);
	}

	.ai-settings :global(.mode.on) {
		border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border));
		background: var(--selected);
	}

	.ai-settings :global(.mode input) {
		grid-row: span 4;
		margin-top: 3px;
		accent-color: var(--color-primary);
	}

	.ai-settings :global(.mode-label) {
		font-weight: 600;
	}

	.ai-settings :global(.mode-hint) {
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.ai-settings :global(.check) {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
	}

	.ai-settings :global(.check input) {
		accent-color: var(--color-primary);
	}

	.ai-settings :global(.hint) {
		margin: 0;
		font-size: 12px;
		line-height: 1.7;
		color: var(--color-text-secondary);
		word-break: break-all;
	}

	.ai-settings :global(.hint.error) {
		color: var(--color-error);
	}

	.ai-settings :global(code) {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 12px;
		color: var(--color-text-secondary);
		word-break: break-all;
	}

	.ai-settings :global(.ghost) {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 12.5px;
		white-space: nowrap;
		cursor: pointer;
	}

	.ai-settings :global(.ghost:hover:not(:disabled)) {
		background: var(--hover);
	}

	.ai-settings :global(.ghost:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.ai-settings :global(.field) {
			grid-template-columns: 1fr;
			gap: 6px;
		}

		.ai-settings :global(.status) {
			flex-wrap: wrap;
		}
	}
</style>
