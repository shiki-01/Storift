<script lang="ts">
	import Button from './Button.svelte';
	import { runAccessDiagnostics } from '$lib/services/access.service';
	import type { DiagnosticItem } from '$lib/firebase/owner';

	let items = $state<DiagnosticItem[]>([]);
	let running = $state(false);

	const statusLabel = { ok: '成功', ng: '失敗', unknown: '不明' } as const;
	const statusClass = { ok: 'fg:theme-success', ng: 'fg:theme-error', unknown: '' } as const;

	async function run() {
		running = true;
		try {
			items = await runAccessDiagnostics();
		} catch (error) {
			console.warn('Diagnostics failed:', error);
		} finally {
			running = false;
		}
	}
</script>

<details
	class="flex flex:column gap:.5rem"
	ontoggle={(e) => {
		if (e.currentTarget.open) void run();
	}}
>
	<summary class="font:bold cursor:pointer">接続診断</summary>
	<p class="fg:theme-text-secondary font:.875rem mt:8">
		Firestore への到達、匿名認証、ルールの版、オーナー登録を確認します(読み取りのみ)。
	</p>
	<div class="mt:8">
		<Button variant="secondary" onclick={run} disabled={running}>
			{running ? '確認中...' : '再確認'}
		</Button>
	</div>
	{#if items.length > 0}
		<ul class="flex flex:column gap:.25rem mt:8 font:13 list-style:none p:0">
			{#each items as item (item.id)}
				<li>
					<span class="font:bold {statusClass[item.status]}">[{statusLabel[item.status]}]</span>
					{item.label}: {item.detail}
				</li>
			{/each}
		</ul>
	{/if}
</details>
