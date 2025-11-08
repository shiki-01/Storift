<script lang="ts">
	import title from '$lib/assets/title.svg';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { projectsDB } from '$lib/db';
	import { projectsStore } from '$lib/stores/projects.svelte';
	import { queueChange } from '$lib/services/sync.service';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
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

	const statusColors = {
		draft: 'bg:gray-100 fg:white',
		writing: 'bg:blue-100 fg:blue-700',
		completed: 'bg:green-100 fg:green-700'
	};

	// コンテキストメニュー - プロジェクト
	function handleProjectContextMenu(e: MouseEvent, project: Project) {
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
			alert('プロジェクト名の変更に失敗しました');
		}
	};

	// 削除処理
	async function handleDeleteProject(project: Project) {
		if (!confirm(`プロジェクト「${project.title}」を削除しますか?\nこの操作は取り消せません。`))
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
			alert('プロジェクトの削除に失敗しました');
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

			alert('プロジェクトを複製しました');
		} catch (error) {
			console.error('Failed to duplicate project:', error);
			alert('プロジェクトの複製に失敗しました');
		}
	}

	// エクスポート処理
	async function handleExportProject(project: Project) {
		try {
			await exportProject(project.id, { format: 'txt' });
		} catch (error) {
			console.error('Failed to export project:', error);
			alert('エクスポートに失敗しました');
		}
	}
</script>

<div class="px:60px py:24px">
	<div class="mb:24">
		<Input
			value={projectsStore.searchQuery}
			placeholder="作品を検索..."
			oninput={handleSearchInput}
		/>
	</div>

	{#if projectsStore.isLoading}
		<div class="text-align:center p:48">
			<p class="fg:gray-600">読み込み中...</p>
		</div>
	{:else if projectsStore.filteredProjects.length === 0}
		<div class="text-align:center p:48">
			<p class="fg:gray-600 font:18 mb:16">
				{projectsStore.searchQuery ? '作品が見つかりませんでした' : 'まだ作品がありません'}
			</p>
			{#if !projectsStore.searchQuery}
				<Button onclick={() => (isCreateModalOpen = true)}>最初の作品を作成</Button>
			{/if}
		</div>
	{:else}
		<div class="display:flex flex-wrap:wrap gap:24">
			{#each projectsStore.filteredProjects as project (project.id)}
				<Card
					hoverable
					padding="none"
					onclick={() => goto(`/project/${project.id}/editor`)}
					oncontextmenu={(e) => handleProjectContextMenu(e, project)}
					class="w:200px h:fit p:0 flex flex:column gap:1rem"
				>
					<div class="w:200px h:284px flex bg:gray r:8px"></div>
					<div
						class="w:200px grid grid-template-cols:140px|60px flex justify-content:space-between align-items:start"
					>
						<div class="w:140px overflow:hidden position:relative">
							<h3 class="font:20 font-weight:600 text-align:start white-space:nowrap">
								{project.title}
							</h3>
							<div
								class="position:absolute top:0 right:0 w:30px h:full bg:linear-gradient(to|right,transparent,white)"
							></div>
						</div>
						<span class="py:6px r:4 font:12 {statusColors[project.status]}">
							{statusLabels[project.status]}
						</span>
					</div>
					{#if project.description}
						<p class="text-align:start font:14 line-clamp:2">
							{project.description}
						</p>
					{/if}
					<div class="text-align:start font:12">
						<p>作成: {formatRelativeTime(project.createdAt)}</p>
						<p>更新: {formatRelativeTime(project.updatedAt)}</p>
					</div>
				</Card>
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
				class="w:full p:12|16 border:1|solid|gray-300 r:6 font:16 outline:none border-color:blue-500:focus min-h:100 resize:vertical"
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
