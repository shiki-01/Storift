<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { aiStore } from '$lib/stores/ai.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';

	// デスクトップ版だけ。プロット・人物・設定資料・進捗の各画面から AI パネルを開閉する
	const desktop = isDesktop();
</script>

{#if desktop && !viewport.isMobile}
	<button
		type="button"
		class="ai-toggle"
		class:on={aiStore.open}
		aria-pressed={aiStore.open}
		onclick={() => aiStore.toggle()}
		aria-label="AI パネル"
		title={aiStore.open ? 'AI パネルを閉じる (Ctrl+Shift+L)' : 'AI パネルを開く (Ctrl+Shift+L)'}
	>
		<Icon name="sparkles" class="w:18px" />
		<span>AI</span>
	</button>
{/if}

<style>
	.ai-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 13px;
		cursor: pointer;
	}

	.ai-toggle:hover {
		background: var(--color-background);
	}

	/* 開いている状態は「選択中」の見た目。--selected は半透明の薄い色なので、文字色を背景色にすると
	   読めず disabled に見えていた。アクセント色の文字と枠で示す */
	.ai-toggle.on {
		background: var(--selected);
		color: var(--color-primary);
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
		font-weight: 600;
	}

	.ai-toggle.on:hover {
		background: color-mix(in srgb, var(--color-primary) 20%, transparent);
	}

	.ai-toggle:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
</style>
