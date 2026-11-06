<script lang="ts">
	import Button from './Button.svelte';
	import SharingDialog from './SharingDialog.svelte';
	import { readOnlyReason } from '$lib/utils/readOnly';

	interface Props {
		projectId: string;
	}

	let { projectId }: Props = $props();

	const reason = $derived(readOnlyReason(projectId));
	let isSharingOpen = $state(false);
</script>

{#if reason}
	<div
		class="flex ai:center jc:space-between gap:12 px:1rem py:.5rem font:.8125rem b:1px|solid|theme-warning"
		role="status"
		style="flex: none"
	>
		<span class="fg:theme-warning">
			{#if reason === 'revoked'}
				このプロジェクトへのアクセス権が無効です。ローカルのコピーは残ります(新しい招待リンクで再参加できます)
			{:else}
				閲覧専用です。このプロジェクトは編集できません
			{/if}
		</span>
		<Button variant="secondary" size="sm" onclick={() => (isSharingOpen = true)}>共有の設定</Button>
	</div>
	{#if isSharingOpen}
		<SharingDialog bind:isOpen={isSharingOpen} {projectId} />
	{/if}
{/if}
