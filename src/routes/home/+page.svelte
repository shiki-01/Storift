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
	import { formatRelativeTime } from '$lib/utils/dateUtils';
	import type { ProjectCreateInput } from '$lib/types';

	let isCreateModalOpen = $state(false);
	let newProjectTitle = $state('');
	let newProjectDescription = $state('');
	let isCreating = $state(false);

	onMount(async () => {
		await loadProjects();

		// Firebaseが初期化済みで、同期状態がofflineの場合、オンラインに戻す
		const { isFirebaseInitialized } = await import('$lib/firebase');
		const { syncStore } = await import('$lib/stores/sync.svelte');
		if (isFirebaseInitialized() && navigator.onLine && syncStore.status === 'offline') {
			syncStore.status = 'synced';
		}
	});

	async function loadProjects() {
		projectsStore.isLoading = true;
		try {
			const projects = await projectsDB.getAll();
			projectsStore.projects = projects;
		} finally {
			projectsStore.isLoading = false;
		}
	}

	async function handleCreateProject() {
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
	}

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
