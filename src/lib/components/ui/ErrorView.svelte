<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { toast } from '$lib/stores/toast.svelte';
	import {
		buildErrorReport,
		buildMailtoUrl,
		copyErrorReport,
		downloadErrorReport
	} from '$lib/utils/errorReport';

	interface ErrorViewProps {
		title: string;
		/** 補足の説明（省略するとエラーメッセージのみ） */
		hint?: string;
		homeLabel?: string;
	}

	let { title, hint, homeLabel = 'ホームに戻る' }: ErrorViewProps = $props();

	// レポートには日時やブラウザ情報を含むため、SSR との不一致を避けてクライアントでのみ生成する
	let mounted = $state(false);
	onMount(() => (mounted = true));

	let errorMessage = $derived($page.error?.message || '不明なエラーが発生しました');
	let errorStatus = $derived($page.status || 500);
	let report = $derived(
		mounted
			? buildErrorReport({
					status: errorStatus,
					message: errorMessage,
					path: $page.url.pathname,
					detail: $page.error
				})
			: ''
	);

	const buttonBase = 'px:16 py:8 r:6 b:2|solid|theme-text cursor:pointer font:14 text-align:center';

	async function handleCopy() {
		if (await copyErrorReport(report)) {
			toast.success('エラー情報をコピーしました');
		} else {
			toast.error('コピーに失敗しました。ファイル保存をお試しください');
		}
	}

	function handleDownload() {
		downloadErrorReport(report);
		toast.success('エラー情報を保存しました');
	}
</script>

<div class="flex align-items:center justify-content:center min-h:calc(100vh-66px) p:24">
	<div class="max-w:560 w:100% b:2|solid|theme-text r:8 p:32 flex flex:column gap:24">
		<div class="flex flex:column gap:8">
			<p class="font:14 fg:theme-text-secondary m:0">エラーコード {errorStatus}</p>
			<h1 class="font:24 font-weight:600 m:0">{title}</h1>
			{#if hint}
				<p class="font:14 fg:theme-text-secondary m:0">{hint}</p>
			{/if}
		</div>

		<div class="bg:theme-surface b:1|solid|theme-border r:6 p:16">
			<p class="font:14 m:0 white-space:pre-wrap word-break:break-all">{errorMessage}</p>
		</div>

		<div class="flex flex:column gap:12">
			<a href="/home" class="{buttonBase} bg:theme-text fg:theme-background">{homeLabel}</a>
			<button
				type="button"
				onclick={() => window.location.reload()}
				class="{buttonBase} bg:theme-background fg:theme-text"
			>
				ページを再読み込み
			</button>
		</div>

		<details class="b:1|solid|theme-border r:6 p:16">
			<summary class="font:14 cursor:pointer">問題を報告する</summary>
			{#if mounted}
				<div class="flex flex:column gap:12 mt:12">
					<p class="font:13 fg:theme-text-secondary m:0">
						エラー情報はこの端末の中で作成され、自動では送信されません。コピー・保存・メール作成のいずれかで共有してください。
					</p>
					<pre
						class="font:12 bg:theme-surface b:1|solid|theme-border r:6 p:12 m:0 max-h:200 overflow:auto white-space:pre-wrap word-break:break-all">{report}</pre>
					<div class="flex flex-wrap:wrap gap:8">
						<button
							type="button"
							onclick={handleCopy}
							class="{buttonBase} bg:theme-background fg:theme-text"
						>
							コピー
						</button>
						<button
							type="button"
							onclick={handleDownload}
							class="{buttonBase} bg:theme-background fg:theme-text"
						>
							ファイルに保存
						</button>
						<a href={buildMailtoUrl(report)} class="{buttonBase} bg:theme-background fg:theme-text">
							メールで送る
						</a>
					</div>
				</div>
			{/if}
		</details>

		<p class="font:12 fg:theme-text-secondary m:0">
			問題が解決しない場合は、ブラウザのキャッシュをクリアしてみてください。
		</p>
	</div>
</div>
