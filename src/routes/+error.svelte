<script lang="ts">
	import { page } from '$app/stores';

	let errorMessage = $derived($page.error?.message || '不明なエラーが発生しました');
	let errorStatus = $derived($page.status || 500);

	const goHome = () => {
		window.location.href = '/home';
	};

	const reload = () => {
		window.location.reload();
	};

	const reportError = () => {
		console.error('Error reported:', {
			status: errorStatus,
			message: errorMessage,
			url: $page.url.pathname
		});
		alert('エラーレポートを送信しました(開発中の機能です)');
	};
</script>

<div class="min-h:screen flex align-items:center justify-content:center bg:gray-50 p:24">
	<div class="max-w:600 w:full bg:white r:16 shadow:0|4|12|rgba(0,0,0,0.1) p:32">
		<!-- エラーアイコン -->
		<div class="text-align:center mb:24">
			<div
				class="inline-flex align-items:center justify-content:center w:80 h:80 r:full bg:red-100 mb:16"
			>
				<svg class="w:40 h:40 fill:red-600" viewBox="0 0 24 24">
					<path
						d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
					/>
				</svg>
			</div>
			<h1 class="font:32 font:bold fg:gray-900 mb:8">
				{#if errorStatus === 404}
					ページが見つかりません
				{:else if errorStatus === 500}
					サーバーエラー
				{:else}
					エラーが発生しました
				{/if}
			</h1>
			<p class="font:16 fg:gray-600">エラーコード: {errorStatus}</p>
		</div>

		<!-- エラーメッセージ -->
		<div class="bg:gray-50 rounded:8 p:16 mb:24">
			<p class="font:14 fg:gray-700 white-space:pre-wrap">
				{errorMessage}
			</p>
		</div>

		<!-- エラー詳細(開発モード時のみ) -->
		{#if import.meta.env.DEV && $page.error}
			<details class="bg:yellow-50 rounded:8 p:16 mb:24">
				<summary class="font:14 font:bold fg:yellow-800 cursor:pointer"> 開発者向け情報 </summary>
				<pre class="font:12 fg:gray-700 overflow:auto mt:8 white-space:pre-wrap">{JSON.stringify(
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
				class="w:full py:12 px:24 bg:blue-600 fg:white font:16 font:semibold rounded:8 cursor:pointer border:none transition:all|0.2s hover:bg:blue-700"
			>
				ホームに戻る
			</button>

			<button
				onclick={reload}
				class="w:full py:12 px:24 bg:white fg:blue-600 font:16 font:semibold rounded:8 cursor:pointer border:1|solid|blue-600 transition:all|0.2s hover:bg:blue-50"
			>
				ページを再読み込み
			</button>

			{#if import.meta.env.DEV}
				<button
					onclick={reportError}
					class="w:full py:12 px:24 bg:white fg:gray-600 font:14 rounded:8 cursor:pointer border:1|solid|gray-300 transition:all|0.2s hover:bg:gray-50"
				>
					エラーを報告
				</button>
			{/if}
		</div>

		<!-- サポート情報 -->
		<div class="mt:24 pt:24 border-top:1|solid|gray-200 text-align:center">
			<p class="font:14 fg:gray-600">
				問題が解決しない場合は、ブラウザのキャッシュをクリアしてみてください。
			</p>
			<p class="font:12 fg:gray-500 mt:8">
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
