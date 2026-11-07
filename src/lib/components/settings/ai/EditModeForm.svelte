<script lang="ts">
	// 設定「AI」: 本文の編集の扱い(プロバイダ共通)とワークスペース
	import { onMount } from 'svelte';
	import { aiStore, EDIT_MODE_HINTS, EDIT_MODE_LABELS, type EditMode } from '$lib/stores/ai.svelte';
	import { getWorkspacePath, openWorkspace } from '$lib/desktop/ai';

	let workspacePath = $state('');

	onMount(async () => {
		workspacePath = (await getWorkspacePath()).path;
	});
</script>

<div class="modes" role="radiogroup" aria-label="本文の編集">
	{#each Object.entries(EDIT_MODE_LABELS) as [value, label] (value)}
		<label class="mode" class:on={aiStore.settings.editMode === value}>
			<input
				type="radio"
				name="ai-edit-mode"
				{value}
				checked={aiStore.settings.editMode === value}
				onchange={() => aiStore.updateSettings({ editMode: value as EditMode })}
			/>
			<span class="mode-label">{label}</span>
			<span class="mode-hint">{EDIT_MODE_HINTS[value as EditMode]}</span>
		</label>
	{/each}
</div>

<div class="workspace">
	<p class="hint">
		原稿は送信のたびに <code>{workspacePath || 'workspace'}</code> へ Markdown で書き出され(未保存の本文も含む)、Claude
		Code はそこを読み取り専用で参照します(Ollama や API 経由のプロバイダではアプリのツール経由で読みます)。本文の書き換えは「本文の編集」の設定に従い、アプリが行います。
	</p>
	<button class="ghost" onclick={() => openWorkspace()}>ワークスペースを開く</button>
</div>

<style>
	.workspace {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
</style>
