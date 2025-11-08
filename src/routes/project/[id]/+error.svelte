<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	let errorMessage = $derived($page.error?.message || '不明なエラーが発生しました');
	let errorStatus = $derived($page.status || 500);

	const goToProjects = () => {
		goto('/home');
	};

	const reload = () => {
		window.location.reload();
	};
</script>

<div class="min-h:screen flex align-items:center justify-content:center bg:gray-50 p:24">
	<div class="max-w:500 w:full bg:white r:16 shadow:0|4|12|rgba(0,0,0,0.1) p:32">
		<div class="text-align:center mb:24">
			<div
				class="inline-flex align-items:center justify-content:center w:64 h:64 r:full bg:orange-100 mb:12"
			>
				<svg class="w:32 h:32 fill:orange-600" viewBox="0 0 24 24">
					<path
						d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
					/>
				</svg>
			</div>
			<h2 class="font:28 font:bold fg:gray-900 mb:8">
				{#if errorStatus === 404}
					プロジェクトが見つかりません
				{:else}
					プロジェクトの読み込みに失敗しました
				{/if}
			</h2>
			<p class="font:14 fg:gray-600">
				{errorMessage}
			</p>
		</div>

		<div class="flex gap:12 flex-direction:column">
			<button
				onclick={goToProjects}
				class="w:full py:12 px:24 bg:blue-600 fg:white font:16 font:semibold rounded:8 cursor:pointer border:none transition:all|0.2s hover:bg:blue-700"
			>
				プロジェクト一覧に戻る
			</button>

			<button
				onclick={reload}
				class="w:full py:12 px:24 bg:white fg:blue-600 font:16 font:semibold rounded:8 cursor:pointer border:1|solid|blue-600 transition:all|0.2s hover:bg:blue-50"
			>
				再読み込み
			</button>
		</div>
	</div>
</div>
