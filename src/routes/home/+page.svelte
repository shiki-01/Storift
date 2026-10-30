<script lang="ts">
	import { toast, confirmDialog } from '$lib/stores/toast.svelte';
	import { longpress } from '$lib/utils/longpress';
	import title from '$lib/assets/title.svg';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { projectsDB } from '$lib/db';
	import { projectsStore } from '$lib/stores/projects.svelte';
	import { queueChange } from '$lib/services/sync.service';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SyncStatus from '$lib/components/ui/SyncStatus.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import { formatRelativeTime } from '$lib/utils/dateUtils';
	import { createProjectContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import type { Project, ProjectCreateInput } from '$lib/types';
	import { exportProject } from '$lib/services/export.service';

	let isCreateModalOpen = $state(false);
	let isRenameModalOpen = $state(false);
	let newProjectTitle = $state('');
	let newProjectDescription = $state('');
	let renameValue = $state('');
	let isCreating = $state(false);

	// コンテキストメニュー
	let contextMenu = $state<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
		targetProject?: Project;
	}>({ visible: false, x: 0, y: 0, items: [] });

	onMount(async () => {
		await loadProjects();

		// Firebaseが初期化済みで、同期状態がofflineの場合、オンラインに戻す
		const { isFirebaseInitialized } = await import('$lib/firebase');
		const { syncStore } = await import('$lib/stores/sync.svelte');
		if (isFirebaseInitialized() && navigator.onLine && syncStore.status === 'offline') {
			syncStore.status = 'synced';
		}
	});

	const loadProjects = async () => {
		projectsStore.isLoading = true;
		try {
			const projects = await projectsDB.getAll();
			projectsStore.projects = projects;
		} finally {
			projectsStore.isLoading = false;
		}
	};

	const handleCreateProject = async () => {
		if (!newProjectTitle.trim()) return;

		isCreating = true;
		try {
			const input: ProjectCreateInput = {
				title: newProjectTitle,
				description: newProjectDescription
			};
			const project = await projectsDB.create(input);
			projectsStore.projects = [project, ...projectsStore.projects];
			isCreateModalOpen = false;
			newProjectTitle = '';
			newProjectDescription = '';

			// 同期キューに追加
			await queueChange('projects', project.id, 'create');

			goto(`/project/${project.id}/editor`);
		} catch (error) {
			console.error('Failed to create project:', error);
		} finally {
			isCreating = false;
		}
	};

	function handleSearchInput(e: Event) {
		const target = e.target as HTMLInputElement;
		projectsStore.searchQuery = target.value;
	}

	const statusLabels = {
		draft: '下書き',
		writing: '執筆中',
		completed: '完成'
	};

	// 前回開いた作品(続きから書く)
	let lastProject = $derived.by(() => {
		let id: string | null = null;
		try {
			id = localStorage.getItem('storift:last-project');
		} catch {
			id = null;
		}
		return projectsStore.projects.find((p) => p.id === id) ?? null;
	});

	// コンテキストメニュー - プロジェクト
	function handleProjectContextMenu(
		e: Pick<MouseEvent, 'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation'>,
		project: Project
	) {
		e.preventDefault();
		e.stopPropagation();

		const items = createProjectContextMenu({
			onOpen: () => goto(`/project/${project.id}/editor`),
			onRename: () => handleRenameProject(project),
			onDuplicate: () => handleDuplicateProject(project),
			onExport: () => handleExportProject(project),
			onDelete: () => handleDeleteProject(project)
		});

		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items,
			targetProject: project
		};
	}

	// リネーム処理
	function handleRenameProject(project: Project) {
		renameValue = project.title;
		isRenameModalOpen = true;
		contextMenu.targetProject = project;
	}

	const applyRename = async () => {
		if (!renameValue.trim() || !contextMenu.targetProject) return;

		try {
			await projectsDB.update(contextMenu.targetProject.id, { title: renameValue });
			const index = projectsStore.projects.findIndex((p) => p.id === contextMenu.targetProject!.id);
			if (index !== -1) {
				projectsStore.projects[index] = { ...projectsStore.projects[index], title: renameValue };
			}
			await queueChange('projects', contextMenu.targetProject.id, 'update');
			isRenameModalOpen = false;
			renameValue = '';
		} catch (error) {
			console.error('Failed to rename project:', error);
			toast.error('プロジェクト名の変更に失敗しました');
		}
	};

	// 削除処理
	async function handleDeleteProject(project: Project) {
		if (
			!(await confirmDialog({
				message: `プロジェクト「${project.title}」を削除しますか?\nこの操作は取り消せません。`,
				danger: true
			}))
		)
			return;

		try {
			// プロジェクト関連のすべてのデータを削除
			const { chaptersDB, scenesDB, charactersDB, plotsDB, worldbuildingDB, progressLogsDB } =
				await import('$lib/db');

			// 各種データを削除
			const chapters = await chaptersDB.getByProjectId(project.id);
			for (const chapter of chapters) {
				const scenes = await scenesDB.getByChapterId(chapter.id);
				for (const scene of scenes) {
					await scenesDB.delete(scene.id);
					await queueChange('scenes', scene.id, 'delete');
				}
				await chaptersDB.delete(chapter.id);
				await queueChange('chapters', chapter.id, 'delete');
			}

			const characters = await charactersDB.getByProjectId(project.id);
			for (const char of characters) {
				await charactersDB.delete(char.id);
				await queueChange('characters', char.id, 'delete');
			}

			const plots = await plotsDB.getByProjectId(project.id);
			for (const plot of plots) {
				await plotsDB.delete(plot.id);
				await queueChange('plots', plot.id, 'delete');
			}

			const worldbuildings = await worldbuildingDB.getByProjectId(project.id);
			for (const wb of worldbuildings) {
				await worldbuildingDB.delete(wb.id);
				await queueChange('worldbuilding', wb.id, 'delete');
			}

			const logs = await progressLogsDB.getByProjectId(project.id);
			for (const log of logs) {
				await progressLogsDB.delete(log.id);
			}

			// プロジェクト本体を削除
			await projectsDB.delete(project.id);
			await queueChange('projects', project.id, 'delete');

			projectsStore.projects = projectsStore.projects.filter((p) => p.id !== project.id);
		} catch (error) {
			console.error('Failed to delete project:', error);
			toast.error('プロジェクトの削除に失敗しました');
		}
	}

	// 複製処理
	async function handleDuplicateProject(project: Project) {
		try {
			const newProject = await projectsDB.create({
				title: `${project.title} (コピー)`,
				description: project.description
			});

			projectsStore.projects = [newProject, ...projectsStore.projects];
			await queueChange('projects', newProject.id, 'create');

			// チャプターとシーンも複製
			const { chaptersDB, scenesDB } = await import('$lib/db');
			const chapters = await chaptersDB.getByProjectId(project.id);

			for (const chapter of chapters) {
				const newChapter = await chaptersDB.create({
					projectId: newProject.id,
					title: chapter.title,
					synopsis: chapter.synopsis
				});
				await queueChange('chapters', newChapter.id, 'create');

				const scenes = await scenesDB.getByChapterId(chapter.id);
				for (const scene of scenes) {
					const newScene = await scenesDB.create({
						chapterId: newChapter.id,
						projectId: newProject.id,
						title: scene.title,
						content: scene.content
					});
					await queueChange('scenes', newScene.id, 'create');
				}
			}

			toast.success('プロジェクトを複製しました');
		} catch (error) {
			console.error('Failed to duplicate project:', error);
			toast.error('プロジェクトの複製に失敗しました');
		}
	}

	// エクスポート処理
	async function handleExportProject(project: Project) {
		try {
			await exportProject(project.id, { format: 'txt' });
		} catch (error) {
			console.error('Failed to export project:', error);
			toast.error('エクスポートに失敗しました');
		}
	}
</script>

<div class="home-page">
	<header class="home-head">
		<div class="home-heading">
			<h1>作品</h1>
			{#if projectsStore.projects.length > 0}
				<span class="home-total">{projectsStore.projects.length}作品</span>
			{/if}
		</div>
		<div class="home-actions">
			<input
				class="home-search"
				type="search"
				value={projectsStore.searchQuery}
				placeholder="作品を検索"
				aria-label="作品を検索"
				oninput={handleSearchInput}
			/>
			<Button onclick={() => (isCreateModalOpen = true)}>＋ 新しい作品</Button>
		</div>
	</header>

	{#if lastProject && !projectsStore.searchQuery}
		<a class="continue" href="/project/{lastProject.id}/editor">
			<span class="continue-body">
				<span class="continue-label">続きから書く</span>
				<span class="continue-title">{lastProject.title}</span>
			</span>
			<span class="continue-meta">{formatRelativeTime(lastProject.updatedAt)}に更新</span>
			<svg
				class="continue-arrow"
				viewBox="0 0 24 24"
				width="18"
				height="18"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg
			>
		</a>
	{/if}

	{#if projectsStore.isLoading}
		<p class="home-empty">読み込み中...</p>
	{:else if projectsStore.filteredProjects.length === 0}
		<div class="home-empty">
			<p>
				{projectsStore.searchQuery ? '作品が見つかりませんでした' : 'まだ作品がありません'}
			</p>
			{#if !projectsStore.searchQuery}
				<Button onclick={() => (isCreateModalOpen = true)}>最初の作品を作成</Button>
			{/if}
		</div>
	{:else}
		<div class="project-grid">
			{#each projectsStore.filteredProjects as project (project.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="project-item"
					use:longpress={{ onLongPress: (e) => handleProjectContextMenu(e, project) }}
					oncontextmenu={(e) => handleProjectContextMenu(e, project)}
				>
					<a class="project-link" href="/project/{project.id}/editor">
						<span class="cover" data-status={project.status}>
							<span class="cover-title">{project.title}</span>
							<span class="cover-status">{statusLabels[project.status]}</span>
						</span>
						<span class="project-title">{project.title}</span>
						{#if project.description}
							<span class="project-desc">{project.description}</span>
						{/if}
						<span class="project-meta">{formatRelativeTime(project.updatedAt)}に更新</span>
					</a>
					<button
						class="project-more"
						aria-label="{project.title}のメニュー"
						onclick={(e) => {
							const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
							handleProjectContextMenu(
								{
									clientX: r.right - 160,
									clientY: r.bottom,
									preventDefault: () => {},
									stopPropagation: () => {}
								},
								project
							);
						}}
					>
						<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"
							><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle
								cx="19"
								cy="12"
								r="1.6"
							/></svg
						>
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<Modal bind:isOpen={isCreateModalOpen} title="新規作品を作成">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleCreateProject();
		}}
		class="flex flex-direction:column gap:16"
	>
		<div>
			<label class="display:block font-weight:500 m:0|0|8|0" for="title">タイトル</label>
			<Input bind:value={newProjectTitle} placeholder="作品のタイトル" required />
		</div>

		<div>
			<label class="display:block font-weight:500 m:0|0|8|0" for="description">説明（任意）</label>
			<textarea
				bind:value={newProjectDescription}
				placeholder="作品の説明や構想メモ"
				class="w:full p:12|16 border:1|solid|theme-border r:6 font:16 outline:none focus:border-color:theme-primary min-h:100 resize:vertical"
			></textarea>
		</div>

		<div class="flex justify-content:flex-end gap:12 mt:16">
			<Button type="button" variant="secondary" onclick={() => (isCreateModalOpen = false)}>
				キャンセル
			</Button>
			<Button type="submit" disabled={isCreating || !newProjectTitle.trim()}>
				{isCreating ? '作成中...' : '作成'}
			</Button>
		</div>
	</form>
</Modal>

<!-- リネームモーダル -->
<Modal bind:isOpen={isRenameModalOpen} title="プロジェクト名を変更">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			applyRename();
		}}
	>
		<div class="mb:16">
			<label class="display:block font-weight:500 m:0|0|8|0" for="renameValue">新しい名前</label>
			<Input bind:value={renameValue} placeholder="プロジェクト名を入力" required />
		</div>
		<div class="flex justify-content:flex-end gap:12">
			<Button type="button" variant="secondary" onclick={() => (isRenameModalOpen = false)}>
				キャンセル
			</Button>
			<Button type="submit" disabled={!renameValue.trim()}>変更</Button>
		</div>
	</form>
</Modal>

<!-- コンテキストメニュー -->
<ContextMenu
	visible={contextMenu.visible}
	x={contextMenu.x}
	y={contextMenu.y}
	items={contextMenu.items}
	onClose={() => (contextMenu.visible = false)}
/>

<style>
	.home-page {
		max-width: 68rem;
		height: 100%;
		margin: 0 auto;
		padding: 40px 48px 64px;
		overflow-y: auto;
	}

	.home-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 28px;
	}

	.home-heading {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}

	.home-heading h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.home-total {
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.home-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.home-search {
		width: 15rem;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 13.5px;
	}

	.home-search:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
	}

	.continue {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 36px;
		padding: 16px 20px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--editor-background);
		color: var(--color-text);
		transition: border-color 0.15s;
	}

	.continue:hover {
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
	}

	.continue-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.continue-label {
		font-size: 11.5px;
		letter-spacing: 0.06em;
		color: var(--color-primary);
	}

	.continue-title {
		font-size: 16px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.continue-meta {
		flex: none;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.continue-arrow {
		flex: none;
		color: var(--color-text-secondary);
		transition: transform 0.15s;
	}

	.continue:hover .continue-arrow {
		transform: translateX(2px);
		color: var(--color-primary);
	}

	.home-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 80px 0;
		color: var(--color-text-secondary);
		font-size: 14px;
	}

	.home-empty p {
		margin: 0;
	}

	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
		gap: 32px 28px;
	}

	.project-item {
		position: relative;
		min-width: 0;
		-webkit-touch-callout: none;
	}

	.project-link {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: var(--color-text);
	}

	/* 表紙: 縦書きの題字と、状態で色の変わる背(左端の帯) */
	.cover {
		--spine: color-mix(in srgb, var(--color-text) 22%, transparent);
		position: relative;
		display: flex;
		justify-content: center;
		aspect-ratio: 3 / 4;
		margin-bottom: 10px;
		padding: 18px 14px 14px 22px;
		border: 1px solid var(--color-border);
		border-radius: 4px 8px 8px 4px;
		background: var(--editor-background);
		overflow: hidden;
		transition:
			border-color 0.15s,
			transform 0.2s ease;
	}

	.cover::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 6px;
		background: var(--spine);
	}

	.cover[data-status='writing'] {
		--spine: var(--color-primary);
	}

	.cover[data-status='completed'] {
		--spine: var(--color-success);
	}

	.project-link:hover .cover {
		border-color: color-mix(in srgb, var(--color-text) 25%, var(--color-border));
		transform: translateY(-2px);
	}

	.cover-title {
		max-height: 100%;
		writing-mode: vertical-rl;
		font-family: 'Noto Serif JP', serif;
		font-size: 17px;
		font-weight: 600;
		line-height: 1.5;
		letter-spacing: 0.12em;
		overflow: hidden;
	}

	.cover-status {
		position: absolute;
		left: 18px;
		bottom: 12px;
		font-size: 10.5px;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	.project-title {
		font-size: 14.5px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-desc {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.project-meta {
		font-size: 11.5px;
		color: var(--color-text-secondary);
	}

	.project-more {
		position: absolute;
		top: 8px;
		right: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.project-more:hover {
		background: var(--hover);
		color: var(--color-text);
	}

	@media (hover: hover) {
		.project-more {
			opacity: 0;
			transition: opacity 0.12s;
		}

		.project-item:hover .project-more,
		.project-more:focus-visible {
			opacity: 1;
		}
	}

	@media (max-width: 768px) {
		.home-page {
			padding: 20px 16px 32px;
		}

		.home-head {
			flex-direction: column;
			align-items: stretch;
			gap: 14px;
			margin-bottom: 20px;
		}

		.home-search {
			flex: 1;
			width: auto;
			min-width: 0;
			font-size: 16px;
		}

		.continue {
			margin-bottom: 24px;
		}

		.continue-meta {
			display: none;
		}

		.project-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 24px 16px;
		}
	}
</style>
