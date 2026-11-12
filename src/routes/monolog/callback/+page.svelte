<script lang="ts">
	// Monolog. の認可の戻り先(Web 版)。state を検証し、トークンを交換して設定へ戻る
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { completeAuthorization } from '$lib/extensions/builtin/monolog/service.svelte';

	let message = $state('Monolog. に接続しています…');
	let failed = $state(false);

	onMount(() => {
		// 認可コードは 1 回限り。URL から取り出したら、履歴に残らないようクエリを消す
		const url = location.href;
		history.replaceState(history.state, '', location.pathname);
		void (async () => {
			try {
				await completeAuthorization(url);
				toast.success('Monolog. に接続しました');
				// resolve() にはハッシュを渡せないので、解決したパスに付ける
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- パスは resolve() 済み
				await goto(`${resolve('/settings')}#extensions`, { replaceState: true });
			} catch (error) {
				failed = true;
				message = error instanceof Error ? error.message : '接続に失敗しました';
			}
		})();
	});
</script>

<div class="wrap">
	<p role={failed ? 'alert' : 'status'} class="msg">{message}</p>
	{#if failed}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- パスは resolve() 済み -->
		<Button onclick={() => goto(`${resolve('/settings')}#extensions`, { replaceState: true })}>
			設定へ戻る
		</Button>
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		min-height: 60vh;
		padding: 24px;
		text-align: center;
	}

	.msg {
		margin: 0;
		font-size: 14px;
		color: var(--color-text-secondary);
	}
</style>
