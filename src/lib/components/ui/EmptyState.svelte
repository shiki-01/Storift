<script lang="ts">
	interface Props {
		message: string;
		actionLabel?: string;
		onaction?: () => void;
	}

	let { message, actionLabel, onaction }: Props = $props();
</script>

<div
	class="flex flex-direction:column align-items:center justify-content:center gap:16 py:64 px:24 bg:theme-surface b:1|solid|theme-border r:8 text-align:center"
>
	<p class="fg:theme-text-secondary font:16 m:0">{message}</p>
	{#if actionLabel && onaction}
		<button
			type="button"
			class="px:16 py:8 r:6 font:14 cursor:pointer bg:theme-primary fg:theme-background b:2|solid|theme-text"
			onclick={onaction}
		>
			{actionLabel}
		</button>
	{/if}
</div>
