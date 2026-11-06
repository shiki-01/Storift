<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import JoinPanel from '$lib/components/ui/JoinPanel.svelte';

	// 招待リンクのフラグメント(#以降)。秘密を含むことがあるので、読み取り後にすぐ URL・履歴から消す
	let initialText = $state('');
	let ready = $state(false);

	onMount(() => {
		const fragment = location.hash.slice(1);
		if (fragment) {
			replaceState(resolve('/join'), {});
			initialText = fragment;
		}
		ready = true;
	});
</script>

<svelte:head>
	<title>共有プロジェクトに参加 - Storift</title>
	<meta name="robots" content="noindex" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="join-page">
	<h1>共有プロジェクトに参加</h1>
	{#if ready}
		<JoinPanel {initialText} />
	{/if}
</div>

<style>
	.join-page {
		max-width: 36rem;
		height: 100%;
		margin: 0 auto;
		padding: 48px 24px;
		overflow-y: auto;
	}

	h1 {
		margin: 0 0 24px;
		font-size: 1.5rem;
	}
</style>
