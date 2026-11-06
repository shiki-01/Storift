<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { projectsDB, chaptersDB, scenesDB } from '$lib/db';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { slide } from 'svelte/transition';
	import AiPanel from '$lib/components/desktop/AiPanel.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { aiStore } from '$lib/stores/ai.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { startCurrentProjectSync, stopCurrentProjectSync } from '$lib/services/sync.service';
	import ProjectAccessBanner from '$lib/components/ui/ProjectAccessBanner.svelte';

	let { children } = $props();

	// AI パネルは作品の全画面(執筆・プロット・人物・設定資料・進捗)で共通に右へ出す
	const desktop = isDesktop();
	let showAi = $derived(desktop && aiStore.open && !viewport.isMobile && !editorStore.focusMode);

	onMount(async () => {
		const projectId = page.params.id;
		if (!projectId) return;

		try {
			localStorage.setItem('storift:last-project', projectId);
		} catch {
			// 保存できなくても動作には影響しない
		}

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
	<div class="flex ai:center jc:center h:100%">
		<p class="fg:theme-text-secondary">読み込み中...</p>
	</div>
{:else if !currentProjectStore.project}
	<div class="flex ai:center jc:center h:100%">
		<p class="fg:theme-error">プロジェクトが見つかりません</p>
	</div>
{:else}
	<!-- 執筆・プロットなどの切り替え時に、内容を軽く滑り込ませる -->
	<div class="project-shell">
		<div class="project-content">
			<ProjectAccessBanner projectId={currentProjectStore.project.id} />
			{#key page.url.pathname}
				<div class="section-enter w:100% h:100%">
					{@render children()}
				</div>
			{/key}
		</div>
		{#if showAi}
			<div class="ai-slot" transition:slide={{ axis: 'x', duration: 220 }}>
				<AiPanel />
			</div>
		{/if}
	</div>
{/if}

<style>
	.project-shell {
		display: flex;
		width: 100%;
		height: 100%;
	}

	.project-content {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.ai-slot {
		flex: none;
		display: flex;
		min-height: 0;
	}

	.section-enter {
		flex: 1;
		min-height: 0;
		animation: section-enter 0.26s cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	@keyframes section-enter {
		from {
			opacity: 0;
			transform: translateX(10px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.section-enter {
			animation: none;
		}
	}
</style>
