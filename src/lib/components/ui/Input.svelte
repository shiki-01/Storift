<script lang="ts">
	interface InputProps {
		value?: string;
		type?: 'text' | 'password' | 'email' | 'number';
		placeholder?: string;
		disabled?: boolean;
		required?: boolean;
		label?: string;
		/** label を使わない入力欄に、外側の <label for> を結び付けるための id */
		id?: string;
		ariaLabel?: string;
		oninput?: (e: Event) => void;
	}

	let {
		value = $bindable(''),
		type = 'text',
		placeholder = '',
		disabled = false,
		required = false,
		label,
		id,
		ariaLabel,
		oninput
	}: InputProps = $props();
</script>

{#if label}
	{@const inputId = `input-${Math.random().toString(36).slice(2, 9)}`}
	<div class="flex flex-direction:column gap:8">
		<label for={inputId} class="font:14 font:semibold fg:theme-text">{label}</label>
		<input
			id={inputId}
			class="w:full px:12 py:10 b:1|solid|theme-border bg:theme-background fg:theme-text r:8 font:16 outline:none focus:border-color:theme-primary transition:all|.2s disabled:bg:theme-surface"
			{type}
			{placeholder}
			{disabled}
			{required}
			bind:value
			{oninput}
		/>
	</div>
{:else}
	<input
		{id}
		aria-label={ariaLabel}
		class="w:full px:12 py:10 b:1|solid|theme-border bg:theme-background fg:theme-text r:8 font:16 outline:none focus:border-color:theme-primary transition:all|.2s disabled:bg:theme-surface"
		{type}
		{placeholder}
		{disabled}
		{required}
		bind:value
		{oninput}
	/>
{/if}
