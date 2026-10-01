<script lang="ts">
	import { buttonClass } from './formStyles';

	interface Props {
		submitLabel: string;
		submitDisabled?: boolean;
		cancelLabel?: string;
		onsubmit: () => void;
		oncancel: () => void;
		/** 左側に置く補助操作（削除など） */
		extra?: import('svelte').Snippet;
	}

	let {
		submitLabel,
		submitDisabled = false,
		cancelLabel = 'キャンセル',
		onsubmit,
		oncancel,
		extra
	}: Props = $props();
</script>

<div class="flex justify-content:space-between align-items:center gap:12">
	<div>
		{#if extra}{@render extra()}{/if}
	</div>
	<div class="flex gap:12">
		<button type="button" class={buttonClass('secondary')} onclick={oncancel}>{cancelLabel}</button>
		<button
			type="button"
			class={buttonClass('primary')}
			disabled={submitDisabled}
			onclick={onsubmit}
		>
			{submitLabel}
		</button>
	</div>
</div>
