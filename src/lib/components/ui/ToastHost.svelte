<script lang="ts">
	import { toastStore } from '$lib/stores/toast.svelte';

	const colors = {
		success: 'var(--color-success)',
		error: 'var(--color-error)',
		info: 'var(--color-info)'
	};
</script>

<div
	class="position:fixed bottom:16 right:16 left:16 z:3000 flex flex:column align-items:flex-end gap:8 pointer-events:none"
	aria-live="polite"
>
	{#each toastStore.items as t (t.id)}
		<div
			role={t.type === 'error' ? 'alert' : 'status'}
			class="pointer-events:auto flex align-items:center gap:12 px:16 py:10 r:8 bg:theme-background fg:theme-text font:14 max-w:420 b:2|solid|theme-text"
			style="border-left: 6px solid {colors[t.type]}"
		>
			<span class="flex-grow:1">{t.message}</span>
			{#if t.action}
				<button
					class="cursor:pointer fg:theme-primary font-weight:600 bg:transparent b:none"
					onclick={() => {
						t.action?.onclick();
						toastStore.dismiss(t.id);
					}}>{t.action.label}</button
				>
			{/if}
			<button
				class="cursor:pointer fg:theme-text-secondary bg:transparent b:none"
				aria-label="通知を閉じる"
				onclick={() => toastStore.dismiss(t.id)}>×</button
			>
		</div>
	{/each}
</div>
