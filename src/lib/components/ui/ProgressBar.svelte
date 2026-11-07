<script lang="ts">
	/**
	 * 進捗バー。アプリの進捗表示はこれで揃える(トラックは --color-border、塗りは tone の色、角丸は全周)。
	 * value は 0〜1。null のときは不確定表示(左右に流れる帯。prefers-reduced-motion では止めて静止した帯にする)。
	 */
	interface Props {
		/** 0〜1。null=不確定 */
		value: number | null;
		/** バーの名前(スクリーンリーダー用。showText のときは見出しとしても出す) */
		label?: string;
		size?: 'sm' | 'md';
		tone?: 'primary' | 'success' | 'warning' | 'error';
		/** 割合(42%)と detail を文字で出す */
		showText?: boolean;
		/** 割合の横に添える補足(例: 12.3 / 45.6 MB) */
		detail?: string;
		class?: string;
	}

	let {
		value,
		label = '進捗',
		size = 'md',
		tone = 'primary',
		showText = true,
		detail,
		class: className = ''
	}: Props = $props();

	let ratio = $derived(value === null ? null : Math.min(1, Math.max(0, value)));
	let percent = $derived(ratio === null ? null : Math.floor(ratio * 100));
	let text = $derived(
		[percent === null ? null : `${percent}%`, detail].filter(Boolean).join(' ・ ')
	);
</script>

<div class="progress {className}" data-size={size} data-tone={tone}>
	{#if showText}
		<div class="head">
			<span class="label">{label}</span>
			<span class="text" data-testid="progress-bar-text">{text}</span>
		</div>
	{/if}
	<div
		class="track"
		class:indeterminate={ratio === null}
		role="progressbar"
		aria-label={label}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={percent ?? undefined}
		aria-valuetext={text || undefined}
	>
		<div class="fill" style={ratio === null ? undefined : `width: ${ratio * 100}%`}></div>
	</div>
</div>

<style>
	.progress {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		--bar-height: 6px;
		--bar-fill: var(--color-primary);
	}

	.progress[data-size='sm'] {
		--bar-height: 3px;
	}

	.progress[data-tone='success'] {
		--bar-fill: var(--color-success);
	}

	.progress[data-tone='warning'] {
		--bar-fill: var(--color-warning);
	}

	.progress[data-tone='error'] {
		--bar-fill: var(--color-error);
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
	}

	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text);
	}

	.text {
		flex: none;
		font-size: 12px;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.track {
		position: relative;
		width: 100%;
		height: var(--bar-height);
		border-radius: 999px;
		background: var(--color-border);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		border-radius: 999px;
		background: var(--bar-fill);
		transition: width 0.25s ease;
	}

	.indeterminate .fill {
		position: absolute;
		inset: 0 auto 0 0;
		width: 40%;
		animation: progress-slide 1.3s ease-in-out infinite;
	}

	@keyframes progress-slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(250%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.fill {
			transition: none;
		}

		.indeterminate .fill {
			animation: none;
			width: 100%;
			opacity: 0.5;
		}
	}
</style>
