<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { projectsDB, chaptersDB, scenesDB } from '$lib/db';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { startCurrentProjectSync, stopCurrentProjectSync } from '$lib/services/sync.service';
	import { editorStore } from '$lib/stores/editor.svelte';

	let { children } = $props();

	const navItems = [
		{ path: 'editor', label: '執筆' },
		{ path: 'plot', label: 'プロット' },
		{ path: 'characters', label: 'キャラクター' },
		{ path: 'worldbuilding', label: '設定資料' },
		{ path: 'progress', label: '進捗' }
	];

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

	function isActive(path: string): boolean {
		return $page.url.pathname.includes(`/project/${$page.params.id}/${path}`);
	}
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
	<div class="flex w:100% h:100% min-h:calc(100vh-80px) rel">
		<!-- サイドバー -->
		<aside
			class="w:240 h:calc(100vh-80px) bg:white flex flex:col abs z:2 top:0 transition:left|.2s|ease-in-out {editorStore.isOpen
				? 'left:0'
				: 'left:-240px'}"
		>
			<!-- ナビゲーション -->
			<nav class="flex:1 p:12">
				{#each navItems as item}
					<a
						href="/project/{$page.params.id}/{item.path}"
						onclick={() => (editorStore.isOpen = false)}
						class="flex align-items:center gap:12 px:16 py:12 r:8 mb:4 font:14 {isActive(item.path)
							? 'bg:gray fg:black'
							: 'fg:gray-700 hover:bg:gray-100'}"
					>
						<span>{item.label}</span>
					</a>
				{/each}
			</nav>
		</aside>

		<button
			aria-label="sidebar"
			onclick={() => (editorStore.isOpen = !editorStore.isOpen)}
			class="w:100% h:calc(100vh-80px) abs z:1 bg:black cursor:pointer transition:opacity|.2s|ease-in-out {editorStore.isOpen
				? 'opacity:.5 pointer-events:auto'
				: 'opacity:0 pointer-events:none'}"
		></button>

		<!-- メインコンテンツ -->
		<main class="flex:1 overflow:hidden">
			{@render children()}
		</main>
	</div>
{/if}
