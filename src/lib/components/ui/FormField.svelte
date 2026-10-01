<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		required?: boolean;
		hint?: string;
		children: Snippet<[string]>;
	}

	let { label, required = false, hint, children }: Props = $props();

	// label と入力欄を結び付ける id（children に渡す）
	const fieldId = `field-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="flex flex-direction:column gap:8">
	<label for={fieldId} class="font:14 font-weight:600 fg:theme-text">
		{label}
		{#if required}<span class="fg:theme-error" aria-hidden="true">*</span>{/if}
	</label>
	{@render children(fieldId)}
	{#if hint}
		<p class="font:12 fg:theme-text-secondary m:0">{hint}</p>
	{/if}
</div>
