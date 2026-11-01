<script lang="ts">
	/**
	 * タグの入力欄。Enter・カンマで確定し、候補はボタンで足せる。
	 */
	import { normalizeTag } from '$lib/utils/memos';

	interface Props {
		value?: string[];
		suggestions?: string[];
		label: string;
		placeholder?: string;
	}

	let { value = $bindable([]), suggestions = [], label, placeholder = 'タグ' }: Props = $props();

	let input = $state('');

	let unused = $derived(suggestions.filter((s) => !value.includes(s)));

	function add(raw: string) {
		const tag = normalizeTag(raw);
		if (tag && !value.includes(tag)) value = [...value, tag];
		input = '';
	}

	function remove(tag: string) {
		value = value.filter((t) => t !== tag);
	}

	function onKeydown(e: KeyboardEvent) {
		// 変換中の Enter は確定に使われるので無視する
		if (e.isComposing || e.keyCode === 229) return;
		if ((e.key === 'Enter' && input.trim()) || e.key === ',' || e.key === '、') {
			e.preventDefault();
			add(input);
		} else if (e.key === 'Backspace' && !input && value.length > 0) {
			value = value.slice(0, -1);
		}
	}
</script>

<div class="tag-input">
	<div class="chips">
		{#each value as tag (tag)}
			<span class="chip">
				#{tag}
				<button type="button" onclick={() => remove(tag)} aria-label="{tag} を外す">×</button>
			</span>
		{/each}
		<input
			type="text"
			bind:value={input}
			onkeydown={onKeydown}
			onblur={() => add(input)}
			{placeholder}
			aria-label={label}
		/>
	</div>
	{#if unused.length > 0}
		<div class="suggest">
			{#each unused as s (s)}
				<button type="button" class="sug" onclick={() => add(s)}>+{s}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.tag-input {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		min-height: 34px;
		padding: 4px 6px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 1px 4px 1px 8px;
		border-radius: 999px;
		background: var(--selected);
		color: var(--color-primary);
		font-size: 12px;
	}

	.chip button,
	.sug {
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.chips input {
		flex: 1;
		min-width: 80px;
		border: none;
		outline: none;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: 13px;
		padding: 2px;
	}

	.suggest {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.sug {
		padding: 2px 8px;
		border: 1px dashed var(--color-border);
		border-radius: 999px;
		color: var(--color-text-secondary);
		font-size: 12px;
	}

	.sug:hover {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}
</style>
