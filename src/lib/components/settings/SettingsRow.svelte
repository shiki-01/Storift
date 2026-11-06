<script lang="ts">
	// 設定の 1 行: 左にラベルと補足説明、右に操作をそろえる(狭い幅では縦に並べる)
	interface SettingsRowProps {
		label: string;
		/** 補足説明。長くなる場合は要点だけにする */
		description?: string;
		/** 操作(input など)の id。指定するとラベルと関連付ける */
		labelFor?: string;
		/** 操作が横長のとき(スライダーなど)は、操作を行の下に広げる */
		stacked?: boolean;
		/** ラベルの右に出す補助表示(現在値など) */
		value?: string;
		children?: import('svelte').Snippet;
	}

	let {
		label,
		description,
		labelFor,
		stacked = false,
		value,
		children
	}: SettingsRowProps = $props();
</script>

<div class="row settings-row" class:stacked>
	<div class="text">
		<div class="label-line">
			{#if labelFor}
				<label class="label" for={labelFor}>{label}</label>
			{:else}
				<span class="label">{label}</span>
			{/if}
			{#if value}<span class="value">{value}</span>{/if}
		</div>
		{#if description}
			<p class="desc">{description}</p>
		{/if}
	</div>
	{#if children}
		<div class="control">
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 0;
	}

	:global(.settings-row + .settings-row) {
		border-top: 1px solid var(--color-border);
	}

	.row:last-child {
		padding-bottom: 0;
	}

	.text {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.label-line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.label {
		font-size: 14px;
		font-weight: 500;
	}

	.value {
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.desc {
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.control {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 8px;
		max-width: 100%;
	}

	.stacked {
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
	}

	.stacked .control {
		justify-content: stretch;
	}

	.stacked .control > :global(*) {
		flex: 1 1 auto;
	}

	/* 狭い幅では、収まらない操作を次の行へ折り返す */
	@media (max-width: 768px) {
		.row:not(.stacked) {
			flex-wrap: wrap;
			gap: 10px 16px;
		}

		.row:not(.stacked) .text {
			flex-basis: 8rem;
		}
	}
</style>
