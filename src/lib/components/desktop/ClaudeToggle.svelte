<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { claudeStore } from '$lib/stores/claude.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';

	// デスクトップ版だけ。プロット・人物・設定資料・進捗の各画面から Claude Code パネルを開閉する
	const desktop = isDesktop();
</script>

{#if desktop && !viewport.isMobile}
	<button
		type="button"
		class="claude-toggle"
		class:on={claudeStore.open}
		aria-pressed={claudeStore.open}
		onclick={() => claudeStore.toggle()}
		aria-label="Claude Code パネル (Ctrl+Shift+L)"
		title="Claude Code パネル (Ctrl+Shift+L)"
	>
		<Icon name="sparkles" class="w:18px" />
		<span>Claude</span>
	</button>
{/if}

<style>
	.claude-toggle {
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

	.claude-toggle:hover {
		background: var(--color-background);
	}

	.claude-toggle.on {
		background: var(--selected, var(--color-primary));
		color: var(--color-background);
		border-color: transparent;
	}
</style>
