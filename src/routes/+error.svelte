<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import { page } from '$app/stores';

	let errorMessage = $derived($page.error?.message || '不明なエラーが発生しました');
	let errorStatus = $derived($page.status || 500);

	const goHome = () => {
		window.location.href = '/home';
	};

	const reload = () => {
		window.location.reload();
	};

	// 外部への送信先はないため、不具合を報告するときに貼り付けられるよう詳細をコピーする
	const copyErrorDetails = async () => {
		const details = JSON.stringify(
			{
				status: errorStatus,
				message: errorMessage,
				url: $page.url.pathname,
				userAgent: navigator.userAgent,
				time: new Date().toISOString()
			},
			null,
			2
		);
		try {
			await navigator.clipboard.writeText(details);
			toast.success('エラーの詳細をコピーしました');
		} catch {
			toast.error('コピーできませんでした');
		}
	};
</script>

<div
	class="h:100% overflow-y:auto flex align-items:center justify-content:center bg:theme-surface p:24"
>
	<div class="max-w:600 w:full bg:theme-background r:16 p:32">
		<!-- エラーアイコン -->
		<div class="text-align:center mb:24">
			<div
				class="inline-flex align-items:center justify-content:center w:80 h:80 r:full bg:theme-surface b:1px|solid|theme-error mb:16"
			>
				<svg class="w:40 h:40 fill:theme-error" viewBox="0 0 24 24">
					<path
						d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
					/>
				</svg>
			</div>
			<h1 class="font:32 font:bold fg:theme-text mb:8">
				{#if errorStatus === 404}
					ページが見つかりません
				{:else if errorStatus === 500}
					サーバーエラー
				{:else}
					エラーが発生しました
				{/if}
			</h1>
			<p class="font:16 fg:theme-text-secondary">エラーコード: {errorStatus}</p>
		</div>

		<!-- エラーメッセージ -->
		<div class="bg:theme-surface rounded:8 p:16 mb:24">
			<p class="font:14 fg:theme-text-secondary white-space:pre-wrap">
				{errorMessage}
			</p>
		</div>

		<!-- エラー詳細(開発モード時のみ) -->
		{#if import.meta.env.DEV && $page.error}
			<details class="bg:theme-surface b:1px|solid|theme-warning rounded:8 p:16 mb:24">
				<summary class="font:14 font:bold fg:theme-warning cursor:pointer">
					開発者向け情報
				</summary>
				<pre
					class="font:12 fg:theme-text-secondary overflow:auto mt:8 white-space:pre-wrap">{JSON.stringify(
						$page.error,
						null,
						2
					)}</pre>
			</details>
		{/if}

		<!-- アクションボタン -->
		<div class="flex gap:12 flex-direction:column">
			<button
				onclick={goHome}
				class="w:full py:12 px:24 bg:theme-primary fg:theme-background font:16 font:semibold rounded:8 cursor:pointer border:none transition:all|0.2s hover:bg:theme-primary"
			>
				ホームに戻る
			</button>

			<button
				onclick={reload}
				class="w:full py:12 px:24 bg:theme-background fg:theme-primary font:16 font:semibold rounded:8 cursor:pointer border:1|solid|theme-primary transition:all|0.2s hover:bg:theme-surface"
			>
				ページを再読み込み
			</button>

			<button
				onclick={copyErrorDetails}
				class="w:full py:12 px:24 bg:theme-background fg:theme-text-secondary font:14 rounded:8 cursor:pointer border:1|solid|theme-border transition:all|0.2s hover:bg:theme-surface"
			>
				エラーの詳細をコピー
			</button>
		</div>

		<!-- サポート情報 -->
		<div class="mt:24 pt:24 border-top:1|solid|theme-border text-align:center">
			<p class="font:14 fg:theme-text-secondary">
				問題が解決しない場合は、ブラウザのキャッシュをクリアしてみてください。
			</p>
			<p class="font:12 fg:theme-text-secondary mt:8">
				URL: {$page.url.pathname}
			</p>
		</div>
	</div>
</div>

<style>
	details > summary::-webkit-details-marker {
		display: none;
	}
</style>
