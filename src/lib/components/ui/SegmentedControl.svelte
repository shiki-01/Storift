<script lang="ts" generics="T extends string">
	interface Option {
		value: T;
		label: string;
		count?: number;
	}

	interface Props {
		options: Option[];
		value: T;
		ariaLabel: string;
	}

	let { options, value = $bindable(), ariaLabel }: Props = $props();
</script>

<div role="group" aria-label={ariaLabel} class="flex flex-wrap:wrap gap:4">
	{#each options as option (option.value)}
		{@const active = option.value === value}
		<button
			type="button"
			aria-pressed={active}
			class="px:12 py:6 r:6 font:14 cursor:pointer transition:all|.2s b:1|solid|theme-border {active
				? 'bg:theme-text fg:theme-background'
				: 'bg:theme-background fg:theme-text-secondary bg:theme-surface:hover'}"
			onclick={() => (value = option.value)}
		>
			{option.label}
			{#if option.count !== undefined}
				<span class="ml:4 font:12 opacity:.7">{option.count}</span>
			{/if}
		</button>
	{/each}
</div>
