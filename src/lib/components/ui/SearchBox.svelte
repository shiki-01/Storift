<script lang="ts">
	interface Props {
		value?: string;
		placeholder?: string;
		ariaLabel: string;
	}

	let { value = $bindable(''), placeholder = '検索...', ariaLabel }: Props = $props();
</script>

<div class="position:relative flex-grow:1 min-w:200">
	<input
		type="search"
		bind:value
		{placeholder}
		aria-label={ariaLabel}
		class="w:full pl:12 pr:36 py:10 b:1|solid|theme-border bg:theme-background fg:theme-text r:8 font:16 outline:none focus:b:$(theme.primary) transition:all|.2s"
	/>
	{#if value}
		<button
			type="button"
			aria-label="検索語をクリア"
			class="position:absolute right:8 top:50% transform:translateY(-50%) w:24 h:24 r:full bg:transparent b:none fg:theme-text-secondary cursor:pointer fg:theme-text:hover"
			onclick={() => (value = '')}
		>
			×
		</button>
	{/if}
</div>
