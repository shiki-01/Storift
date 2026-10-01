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
	import DefoImg from '$lib/components/ui/DefoImg.svelte';
	import SyncStatus from '$lib/components/ui/SyncStatus.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import { formatRelativeTime } from '$lib/utils/dateUtils';
	import { createProjectContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import type { Project, ProjectCreateInput } from '$lib/types';
	import { exportProject } from '$lib/services/export.service';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirmDialog } from '$lib/stores/confirm.svelte';

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

			toast.success(`「${project.title}」を作成しました`);
			goto(`/project/${project.id}/editor`);
		} catch (error) {
			console.error('Failed to create project:', error);
			toast.error('プロジェクトの作成に失敗しました');
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
		draft: 'b:1|solid|theme-border fg:theme-text-secondary',
		writing: 'b:1|solid|theme-primary fg:theme-primary',
		completed: 'b:1|solid|theme-success fg:theme-success'
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

	// カード右上のメニューボタンから、右クリックと同じメニューを開く（タッチ端末向け）
	function handleProjectMenuButton(e: MouseEvent, project: Project) {
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		handleProjectContextMenu(
			new MouseEvent('contextmenu', { clientX: rect.left, clientY: rect.bottom }),
			project
		);
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
			toast.success('プロジェクト名を変更しました');
		} catch (error) {
			console.error('Failed to rename project:', error);
			toast.error('プロジェクト名の変更に失敗しました');
		}
	};

	// 削除処理
	async function handleDeleteProject(project: Project) {
		const confirmed = await confirmDialog({
			title: 'プロジェクトを削除',
			message: `プロジェクト「${project.title}」を削除しますか?\nこの操作は取り消せません。`,
			confirmText: '削除',
			danger: true
		});
		if (!confirmed) return;

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
			toast.success(`「${project.title}」を削除しました`);
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
			toast.success('エクスポートしました');
		} catch (error) {
			console.error('Failed to export project:', error);
			toast.error('エクスポートに失敗しました');
		}
	}
</script>

<svelte:head>
	<title>ホーム | Storift</title>
</svelte:head>

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
			<p class="fg:theme-text-secondary">読み込み中...</p>
		</div>
	{:else if projectsStore.filteredProjects.length === 0}
		<div class="text-align:center p:48">
			<p class="fg:theme-text-secondary font:18 mb:16">
				{projectsStore.searchQuery ? '作品が見つかりませんでした' : 'まだ作品がありません'}
			</p>
			{#if !projectsStore.searchQuery}
				<Button onclick={() => (isCreateModalOpen = true)}>最初の作品を作成</Button>
			{/if}
		</div>
	{:else}
		<div class="display:flex flex-wrap:wrap gap:24">
			{#each projectsStore.filteredProjects as project (project.id)}
				<div class="rel w:200px">
					<Card
						hoverable
						padding="none"
						onclick={() => goto(`/project/${project.id}/editor`)}
						oncontextmenu={(e) => handleProjectContextMenu(e, project)}
						class="w:200px h:fit p:0 flex flex:column gap:1rem bg:transparent b:none"
					>
						<DefoImg />
						<div
							class="w:200px grid grid-template-cols:140px|60px flex justify-content:space-between align-items:start"
						>
							<div class="w:140px overflow:hidden position:relative">
								<h3 class="font:20 font-weight:600 text-align:start white-space:nowrap">
									{project.title}
								</h3>
								<div
									class="position:absolute top:0 right:0 w:30px h:full"
									style="background: linear-gradient(to right, transparent, var(--color-background))"
								></div>
							</div>
							<span class="px:8 py:2 r:4 font:12 text-align:center {statusColors[project.status]}">
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
					<button
						type="button"
						aria-label="{project.title}のメニューを開く"
						aria-haspopup="menu"
						onclick={(e) => handleProjectMenuButton(e, project)}
						class="abs top:8 right:8 w:32 h:32 r:full b:2|solid|theme-text bg:theme-background fg:theme-text cursor:pointer flex align-items:center justify-content:center font:16 line-height:1"
					>
						⋯
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
				class="w:full p:12|16 b:1|solid|theme-border bg:theme-background fg:theme-text r:6 font:16 outline:none border-color:theme-primary:focus min-h:100 resize:vertical"
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
