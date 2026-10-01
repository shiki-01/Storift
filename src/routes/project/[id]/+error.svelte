<script lang="ts">
	import { page } from '$app/stores';
	import ErrorView from '$lib/components/ui/ErrorView.svelte';

	let title = $derived(
		$page.status === 404 ? 'プロジェクトが見つかりません' : 'プロジェクトの読み込みに失敗しました'
	);
</script>

<svelte:head>
	<title>{title} | Storift</title>
</svelte:head>

<ErrorView {title} homeLabel="プロジェクト一覧に戻る" />
