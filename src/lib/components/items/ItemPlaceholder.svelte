<script lang="ts">
	/**
	 * 一覧/詳細ページの案内表示(空の一覧・項目を選んでいない詳細ペイン・絞り込み結果なし・読み込み失敗)。
	 * アイコン枠、題、補足、操作(任意)を中央に並べる。
	 */
	import type { Snippet } from 'svelte';
	import IconBadge from './IconBadge.svelte';

	interface Props {
		title: string;
		text?: string;
		/** IconBadge に出すアイコン名。無ければ枠を出さない */
		icon?: string;
		shape?: 'circle' | 'square';
		role?: 'alert' | 'status';
		children?: Snippet;
	}

	let { title, text, icon, shape = 'circle', role, children }: Props = $props();
</script>

<div class="placeholder" {role}>
	{#if icon}<IconBadge size={52} {shape} tone="neutral" {icon} />{/if}
	<p class="title">{title}</p>
	{#if text}<p class="text">{text}</p>{/if}
	{#if children}<div class="actions">{@render children()}</div>{/if}
</div>

<style>
	.placeholder {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 14rem;
		padding: 48px 24px;
		color: var(--color-text-secondary);
		text-align: center;
	}

	p {
		margin: 0;
	}

	.title {
		margin-top: 4px;
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text);
	}

	.text {
		max-width: 26rem;
		font-size: 13.5px;
		line-height: 1.8;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 8px;
	}

	.actions :global(.ico) {
		display: inline-flex;
		width: 16px;
		height: 16px;
	}

	.actions :global(.ico svg) {
		width: 100%;
		height: 100%;
	}
</style>
