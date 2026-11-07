<script lang="ts">
	/**
	 * 詳細の閲覧ビューの 1 節(見出し + 全文)。長文も省略せず、改行を保って表示する。
	 * 本文は選択できる(.selectable)。
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** 本文。空なら emptyText を薄く出す(children があればそちらを使う) */
		text?: string;
		emptyText?: string;
		children?: Snippet;
	}

	let { title, text = '', emptyText = '未記入', children }: Props = $props();
</script>

<section class="section">
	<h3>{title}</h3>
	{#if children}
		<div class="body selectable">{@render children()}</div>
	{:else if text.trim()}
		<p class="body selectable">{text}</p>
	{:else}
		<p class="body empty">{emptyText}</p>
	{/if}
</section>

<style>
	.section {
		margin: 0;
	}

	h3 {
		margin: 0 0 6px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	.body {
		margin: 0;
		font-size: 15px;
		line-height: 1.85;
		color: var(--color-text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.empty {
		color: var(--color-text-secondary);
		opacity: 0.7;
		font-size: 13.5px;
	}
</style>
