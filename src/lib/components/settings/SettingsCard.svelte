<script lang="ts">
	// 設定のグループ。見出し(h3)・説明文・本文をそろえて表示する
	import Card from '$lib/components/ui/Card.svelte';

	interface SettingsCardProps {
		title: string;
		/** 見出しの下の説明(1 〜 2 文) */
		description?: string;
		/** warning: 注意が要る項目 / danger: 取り消せない操作 */
		tone?: 'default' | 'warning' | 'danger';
		children?: import('svelte').Snippet;
		/** data-tour などの data-* 属性は、そのまま外側の要素に渡す */
		[key: `data-${string}`]: string | undefined;
	}

	let { title, description, tone = 'default', children, ...rest }: SettingsCardProps = $props();
</script>

<Card class="settings-card settings-card--{tone}" {...rest}>
	<header class="settings-card-head">
		<h3 class="settings-card-title">{title}</h3>
		{#if description}
			<p class="settings-card-desc">{description}</p>
		{/if}
	</header>
	{#if children}
		<div class="settings-card-body">
			{@render children()}
		</div>
	{/if}
</Card>

<style>
	/* Card の枠線(ユーティリティクラス)より優先させるため、:global で詳細度を上げる */
	:global(div.settings-card) {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	:global(div.settings-card--warning) {
		border-color: var(--color-warning);
	}

	:global(div.settings-card--danger) {
		border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border));
		background: color-mix(in srgb, var(--color-error) 4%, var(--color-background));
	}

	.settings-card-head {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-bottom: 12px;
		margin-bottom: 4px;
		border-bottom: 1px solid var(--color-border);
	}

	.settings-card-title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	:global(div.settings-card--danger) .settings-card-title {
		color: var(--color-error);
	}

	.settings-card-desc {
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.settings-card-body {
		display: flex;
		flex-direction: column;
	}

	/* 行(SettingsRow)以外のブロックが続くときの間隔 */
	.settings-card-body > :global(* + :not(.settings-row)) {
		margin-top: 12px;
	}
</style>
