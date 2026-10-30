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

<div
	class="h:100% overflow-y:auto flex align-items:center justify-content:center bg:theme-surface p:24"
>
	<div class="max-w:500 w:full bg:theme-background r:16 p:32">
		<div class="text-align:center mb:24">
			<div
				class="inline-flex align-items:center justify-content:center w:64 h:64 r:full bg:theme-surface b:1px|solid|theme-warning mb:12"
			>
				<svg class="w:32 h:32 fill:theme-warning" viewBox="0 0 24 24">
					<path
						d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
					/>
				</svg>
			</div>
			<h2 class="font:28 font:bold fg:theme-text mb:8">
				{#if errorStatus === 404}
					プロジェクトが見つかりません
				{:else}
					プロジェクトの読み込みに失敗しました
				{/if}
			</h2>
			<p class="font:14 fg:theme-text-secondary">
				{errorMessage}
			</p>
		</div>

		<div class="flex gap:12 flex-direction:column">
			<button
				onclick={goToProjects}
				class="w:full py:12 px:24 bg:theme-primary fg:theme-background font:16 font:semibold rounded:8 cursor:pointer border:none transition:all|0.2s hover:bg:theme-primary"
			>
				プロジェクト一覧に戻る
			</button>

			<button
				onclick={reload}
				class="w:full py:12 px:24 bg:theme-background fg:theme-primary font:16 font:semibold rounded:8 cursor:pointer border:1|solid|theme-primary transition:all|0.2s hover:bg:theme-surface"
			>
				再読み込み
			</button>
		</div>
	</div>
</div>
