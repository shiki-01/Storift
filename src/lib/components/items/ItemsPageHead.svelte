<script lang="ts">
	/**
	 * 一覧/詳細ページの見出し行(人物・設定資料)。左にページ名と件数、右に操作(AI の切り替え・表示の切り替え・新規作成)。
	 * スマホでは上のヘッダーにページ名が出ているので、見出しは読み上げ用だけにする。
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** 件数の表示(例: 「12 人」)。無ければ出さない */
		total?: string;
		children?: Snippet;
	}

	let { title, total, children }: Props = $props();
</script>

<header class="page-head">
	<div class="heading">
		<h1>{title}</h1>
		{#if total}<span class="total">{total}</span>{/if}
	</div>
	{#if children}<div class="head-actions">{@render children()}</div>{/if}
</header>

<style>
	.page-head {
		position: relative;
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 16px;
		padding: 20px 24px 14px;
	}

	.heading {
		display: flex;
		align-items: baseline;
		gap: 12px;
		min-width: 0;
	}

	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.total {
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.head-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.head-actions :global(.ico) {
		display: inline-flex;
		flex: none;
		width: 16px;
		height: 16px;
	}

	.head-actions :global(.ico svg) {
		width: 100%;
		height: 100%;
	}

	@media (max-width: 768px) {
		.page-head {
			padding: 12px 16px 10px;
		}

		.heading {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}

		.head-actions {
			width: 100%;
		}
	}
</style>
