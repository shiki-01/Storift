<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/stores';
	import { projectsDB, chaptersDB, scenesDB } from '$lib/db';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { startCurrentProjectSync, stopCurrentProjectSync } from '$lib/services/sync.service';

	let { children } = $props();

	let loadError = $state(false);
	let loadedId = $state<string | null>(null);

	async function loadProject(projectId: string) {
		loadedId = projectId;
		loadError = false;
		stopCurrentProjectSync();
		currentProjectStore.isLoading = true;
		try {
			const project = await projectsDB.getById(projectId);
			const chapters = await chaptersDB.getByProjectId(projectId);
			const scenes = await scenesDB.getByProjectId(projectId);

			// 読み込み中に別のプロジェクトへ移動していたら破棄する
			if (loadedId !== projectId) return;

			currentProjectStore.project = project || null;
			currentProjectStore.chapters = chapters;
			currentProjectStore.scenes = scenes;
		} catch (error) {
			console.error('Failed to load project:', error);
			if (loadedId !== projectId) return;
			currentProjectStore.project = null;
			currentProjectStore.chapters = [];
			currentProjectStore.scenes = [];
			loadError = true;
		} finally {
			if (loadedId === projectId) currentProjectStore.isLoading = false;
		}

		if (loadedId !== projectId || !currentProjectStore.project) return;

		// 同期を開始（設定確認が含まれる）
		try {
			await startCurrentProjectSync(projectId);
		} catch (error) {
			console.error('Failed to start project sync:', error);
		}
	}

	// URL の id が変わるたびに読み込み直す
	$effect(() => {
		const projectId = $page.params.id;
		if (!projectId || projectId === loadedId) return;
		untrack(() => {
			loadProject(projectId);
		});
	});

	onDestroy(() => {
		loadedId = null;
		stopCurrentProjectSync();
	});
</script>

{#if currentProjectStore.isLoading || loadedId !== $page.params.id}
	<div
		class="flex align-items:center justify-content:center h:100%"
		role="status"
		aria-live="polite"
	>
		<p class="fg:theme-text-secondary m:0">読み込み中...</p>
	</div>
{:else if !currentProjectStore.project}
	<div class="flex flex:column align-items:center justify-content:center gap:16 h:100% p:24">
		<p class="font:18 font-weight:600 m:0">
			{loadError ? 'プロジェクトの読み込みに失敗しました' : 'プロジェクトが見つかりません'}
		</p>
		<p class="fg:theme-text-secondary font:14 m:0">
			{loadError
				? '再読み込みするか、ホームに戻ってください。'
				: '削除されたか、URL が正しくない可能性があります。'}
		</p>
		<a
			href="/home"
			class="px:24 py:8 r:6 b:2|solid|theme-text bg:theme-text fg:theme-background font:14"
		>
			ホームに戻る
		</a>
	</div>
{:else}
	<div class="w:100% h:100%">
		{@render children()}
	</div>
{/if}
