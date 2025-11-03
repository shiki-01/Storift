<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { projectsDB, chaptersDB, scenesDB } from '$lib/db';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { startCurrentProjectSync, stopCurrentProjectSync } from '$lib/services/sync.service';

	let { children } = $props();

	onMount(async () => {
		const projectId = $page.params.id;
		if (!projectId) return;

		currentProjectStore.isLoading = true;
		try {
			const project = await projectsDB.getById(projectId);
			const chapters = await chaptersDB.getByProjectId(projectId);
			const scenes = await scenesDB.getByProjectId(projectId);

			currentProjectStore.project = project || null;
			currentProjectStore.chapters = chapters;
			currentProjectStore.scenes = scenes;
		} finally {
			currentProjectStore.isLoading = false;
		}

		// 同期を開始（設定確認が含まれる）
		await startCurrentProjectSync(projectId);
	});

	onDestroy(() => {
		stopCurrentProjectSync();
	});
</script>

{#if currentProjectStore.isLoading}
	<div class="flex align-items:center justify-content:center h:100vh">
		<p class="fg:gray-600">読み込み中...</p>
	</div>
{:else if !currentProjectStore.project}
	<div class="flex align-items:center justify-content:center h:100vh">
		<p class="fg:red-600">プロジェクトが見つかりません</p>
	</div>
{:else}
	<div class="w:100% h:100%">
		{@render children()}
	</div>
{/if}
