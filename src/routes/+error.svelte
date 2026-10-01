<script lang="ts">
	import { page } from '$app/stores';
	import ErrorView from '$lib/components/ui/ErrorView.svelte';

	let title = $derived(
		$page.status === 404
			? 'ページが見つかりません'
			: $page.status >= 500
				? 'サーバーエラー'
				: 'エラーが発生しました'
	);
</script>

<svelte:head>
	<title>{title} | Storift</title>
</svelte:head>

<ErrorView {title} />
