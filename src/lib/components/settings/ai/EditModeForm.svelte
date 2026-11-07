<script lang="ts">
	// 設定「AI」: 本文の編集の扱い(プロバイダ共通)と、旧ワークスペースのフォルダ
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
		原稿のファイルは、Claude Code に渡しません。Claude Code
		は空の作業フォルダで動き、作品の本文や設定資料は、アプリのツール(MCP)を通して必要な分だけ読みます(Ollama
		や API
		経由のプロバイダも同じツールを使います)。本文の書き換えは「本文の編集」の設定に従い、アプリが行います。
	</p>
	<p class="hint">
		以前の版が書き出した原稿の写しが残っていることがあります(場所: <code
			>{workspacePath || 'workspace'}</code
		>)。今の版は、このフォルダを読み書きしません。
	</p>
	<button class="ghost" onclick={() => openWorkspace()}>以前の書き出しフォルダを開く</button>
</div>

<style>
	.workspace {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
</style>
