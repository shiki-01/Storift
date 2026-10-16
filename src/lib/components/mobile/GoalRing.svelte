<script lang="ts">
	interface Props {
		/** 0〜1 (超過しても可) */
		ratio?: number;
		size?: number;
		label?: string;
	}

	let { ratio = 0, size = 16, label = '' }: Props = $props();

	const stroke = 2.5;
	let radius = $derived((size - stroke) / 2);
	let circumference = $derived(2 * Math.PI * radius);
	let clamped = $derived(Math.max(0, Math.min(1, ratio)));
	let done = $derived(ratio >= 1);
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 {size} {size}"
	role="img"
	aria-label={label || `目標の達成率 ${Math.round(ratio * 100)}%`}
	class="ring"
>
	<circle
		cx={size / 2}
		cy={size / 2}
		r={radius}
		fill="none"
		stroke="var(--color-border)"
		stroke-width={stroke}
	/>
	<circle
		cx={size / 2}
		cy={size / 2}
		r={radius}
		fill="none"
		stroke={done ? 'var(--color-success)' : 'var(--color-primary)'}
		stroke-width={stroke}
		stroke-linecap="round"
		stroke-dasharray={circumference}
		stroke-dashoffset={circumference * (1 - clamped)}
		transform="rotate(-90 {size / 2} {size / 2})"
		style="transition: stroke-dashoffset 0.4s ease"
	/>
</svg>

<style>
	.ring {
		flex: none;
		display: block;
	}
</style>
