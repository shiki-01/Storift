<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { worldbuildingDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Worldbuilding } from '$lib/types';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { onMount } from 'svelte';

	let worldbuildings = $state<Worldbuilding[]>([]);
	let isLoading = $state(true);
	let showCreateModal = $state(false);
	let showEditModal = $state(false);
	let editingWorldbuilding = $state<Worldbuilding | null>(null);
	let activeCategory = $state<Worldbuilding['category'] | 'all'>('all');
	let searchQuery = $state('');

	// フォーム状態
	let formData = $state({
		title: '',
		category: 'term' as Worldbuilding['category'],
		content: '',
		tags: [] as string[],
		tagInput: ''
	});

	const categoryLabels = {
		term: '用語',
		timeline: '年表',
		location: '場所',
		other: 'その他'
	};

	const categoryColors = {
		term: 'bg:blue-100 fg:blue-700',
		timeline: 'bg:green-100 fg:green-700',
		location: 'bg:purple-100 fg:purple-700',
		other: 'bg:gray-100 fg:gray-700'
	};

	onMount(async () => {
		await loadWorldbuildings();
	});

	async function loadWorldbuildings() {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			worldbuildings = await worldbuildingDB.getByProjectId(currentProjectStore.project.id);
		} finally {
			isLoading = false;
		}
	}

	function openCreateModal() {
		formData = {
			title: '',
			category: 'term',
			content: '',
			tags: [],
			tagInput: ''
		};
		showCreateModal = true;
	}

	function openEditModal(worldbuilding: Worldbuilding) {
		editingWorldbuilding = worldbuilding;
		formData = {
			title: worldbuilding.title,
			category: worldbuilding.category,
			content: worldbuilding.content,
			tags: [...worldbuilding.tags],
			tagInput: ''
		};
		showEditModal = true;
	}

	async function handleCreate() {
		if (!currentProjectStore.project || !formData.title.trim()) return;

		const worldbuilding = await worldbuildingDB.create({
			projectId: currentProjectStore.project.id,
			title: formData.title,
			category: formData.category
		});

		// 追加情報を更新
		await worldbuildingDB.update(worldbuilding.id, {
			content: formData.content,
			tags: [...formData.tags] // プレーンな配列に変換
		});

		// 同期キューに追加
		await queueChange('worldbuilding', worldbuilding.id, 'create');

		await loadWorldbuildings();
		showCreateModal = false;
	}

	async function handleUpdate() {
		if (!editingWorldbuilding) return;

		await worldbuildingDB.update(editingWorldbuilding.id, {
			title: formData.title,
			category: formData.category,
			content: formData.content,
			tags: [...formData.tags] // プレーンな配列に変換
		});

		// 同期キューに追加
		await queueChange('worldbuilding', editingWorldbuilding.id, 'update');

		await loadWorldbuildings();
		showEditModal = false;
		editingWorldbuilding = null;
	}

	async function handleDelete(id: string) {
		if (!confirm('この設定資料を削除しますか?')) return;
		await worldbuildingDB.delete(id);
		// 同期キューに追加
		await queueChange('worldbuilding', id, 'delete');
		await loadWorldbuildings();
	}

	function handleAddTag() {
		if (formData.tagInput.trim() && !formData.tags.includes(formData.tagInput.trim())) {
			formData.tags = [...formData.tags, formData.tagInput.trim()];
			formData.tagInput = '';
		}
	}

	function handleRemoveTag(index: number) {
		formData.tags = formData.tags.filter((_, i) => i !== index);
	}

	function getCategoryCounts() {
		return {
			all: worldbuildings.length,
			term: worldbuildings.filter((w) => w.category === 'term').length,
			timeline: worldbuildings.filter((w) => w.category === 'timeline').length,
			location: worldbuildings.filter((w) => w.category === 'location').length,
			other: worldbuildings.filter((w) => w.category === 'other').length
		};
	}

	$effect(() => {
		// フィルター処理
		filteredWorldbuildings;
	});

	let filteredWorldbuildings = $derived(
		worldbuildings.filter((w) => {
			const matchCategory = activeCategory === 'all' || w.category === activeCategory;
			const matchSearch =
				!searchQuery ||
				w.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
				w.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
				w.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
			return matchCategory && matchSearch;
		})
	);

	let allTags = $derived(
		Array.from(new Set(worldbuildings.flatMap((w) => w.tags))).sort()
	);
</script>

<div class="p:32 h:100% overflow:auto">
	<!-- ヘッダー -->
	<div class="flex justify-content:space-between align-items:center mb:24">
		<div>
			<h1 class="font:32 font:bold mb:8">設定資料管理</h1>
			<p class="fg:gray-600">世界観や用語の設定資料を管理します</p>
		</div>
		<Button onclick={openCreateModal}>+ 新規資料</Button>
	</div>

	<!-- 検索・フィルター -->
	<div class="flex gap:16 mb:24">
		<div class="flex:1">
			<Input
				bind:value={searchQuery}
				placeholder="タイトル、内容、タグで検索..."
			/>
		</div>
		<div class="flex gap:8">
			{#each Object.entries({ all: 'すべて', ...categoryLabels }) as [key, label]}
				{@const counts = getCategoryCounts()}
				<button
					class="px:16 py:10 r:8 font:14 {activeCategory === key
						? 'bg:blue-500 fg:white'
						: 'bg:gray-100 fg:gray-700 hover:bg:gray-200'}"
					onclick={() => (activeCategory = key as typeof activeCategory)}
				>
					{label}
					<span class="ml:8 {activeCategory === key ? 'fg:blue-100' : 'fg:gray-500'}">
						{counts[key as keyof typeof counts]}
					</span>
				</button>
			{/each}
		</div>
	</div>

	{#if isLoading}
		<div class="flex justify-content:center align-items:center h:400">
			<p class="fg:gray-600">読み込み中...</p>
		</div>
	{:else}
		<!-- 資料一覧 -->
		<div class="grid cols:2 gap:16">
			{#each filteredWorldbuildings as worldbuilding (worldbuilding.id)}
				<Card>
					<div class="p:20">
						<div class="flex justify-content:space-between align-items:start mb:12">
							<div class="flex:1">
								<div class="flex align-items:center gap:8 mb:8">
									<span
										class="px:12 py:6 r:6 font:12 {categoryColors[worldbuilding.category]}"
									>
										{categoryLabels[worldbuilding.category]}
									</span>
								</div>
								<button
									class="font:18 font:semibold mb:8 cursor:pointer hover:fg:blue-600 bg:transparent b:none text-align:left w:full"
									onclick={() => openEditModal(worldbuilding)}
								>
									{worldbuilding.title}
								</button>
							</div>
						</div>

						{#if worldbuilding.content}
							<p class="fg:gray-600 font:14 mb:12 line-clamp:3 white-space:pre-wrap">
								{worldbuilding.content}
							</p>
						{/if}

						{#if worldbuilding.tags.length > 0}
							<div class="flex flex:wrap gap:4 mb:12">
								{#each worldbuilding.tags as tag}
									<span class="px:8 py:4 r:full bg:gray-100 fg:gray-700 font:12">
										#{tag}
									</span>
								{/each}
							</div>
						{/if}

						<div class="flex gap:8">
							<button
								class="flex:1 px:12 py:8 bg:blue-50 fg:blue-600 r:6 font:14 hover:bg:blue-100"
								onclick={() => openEditModal(worldbuilding)}
							>
								編集
							</button>
							<button
								class="px:12 py:8 bg:red-50 fg:red-600 r:6 font:14 hover:bg:red-100"
								onclick={() => handleDelete(worldbuilding.id)}
							>
								削除
							</button>
						</div>
					</div>
				</Card>
			{/each}
		</div>

		{#if filteredWorldbuildings.length === 0}
			<div class="flex flex:col align-items:center justify-content:center h:400 gap:16">
				<p class="fg:gray-500 font:18">
					{searchQuery || activeCategory !== 'all'
						? '該当する資料がありません'
						: '設定資料がまだありません'}
				</p>
				<Button onclick={openCreateModal}>最初の資料を作成</Button>
			</div>
		{/if}
	{/if}

	<!-- タグクラウド -->
	{#if allTags.length > 0}
		<div class="mt:24 p:20 bg:gray-50 r:8">
			<h3 class="font:16 font:semibold mb:12">タグ一覧</h3>
			<div class="flex flex:wrap gap:8">
				{#each allTags as tag}
					<button
						class="px:12 py:6 r:full bg:white fg:gray-700 font:12 hover:bg:blue-50 hover:fg:blue-600"
						onclick={() => (searchQuery = tag)}
					>
						#{tag}
						<span class="ml:4 fg:gray-400">
							{worldbuildings.filter((w) => w.tags.includes(tag)).length}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- 新規作成モーダル -->
<Modal bind:isOpen={showCreateModal} title="新規設定資料作成">
	{#snippet children()}
		<div class="flex flex:col gap:16">
			<Input
				label="タイトル *"
				bind:value={formData.title}
				placeholder="用語名や場所名など"
			/>

			<div>
				<label for="create-category" class="block mb:8 font:14 font:semibold">カテゴリ</label>
				<select
					id="create-category"
					bind:value={formData.category}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
				>
					{#each Object.entries(categoryLabels) as [value, label]}
						<option value={value}>{label}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="create-content" class="block mb:8 font:14 font:semibold">内容</label>
				<textarea
					id="create-content"
					bind:value={formData.content}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:200 resize:vertical font-family:inherit"
					placeholder="詳細な説明..."
				></textarea>
			</div>

			<div>
				<label for="create-tag-input" class="block mb:8 font:14 font:semibold">タグ</label>
				<div class="flex gap:8 mb:8">
					<input
						id="create-tag-input"
						type="text"
						bind:value={formData.tagInput}
						placeholder="タグを入力してEnter"
						class="flex:1 px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								handleAddTag();
							}
						}}
					/>
					<Button onclick={handleAddTag}>追加</Button>
				</div>
				{#if formData.tags.length > 0}
					<div class="flex flex:wrap gap:4">
						{#each formData.tags as tag, index}
							<span class="px:12 py:6 r:full bg:blue-100 fg:blue-700 font:12 flex align-items:center gap:4">
								#{tag}
								<button
									class="w:16 h:16 r:full hover:bg:blue-200 flex align-items:center justify-content:center b:none bg:transparent"
									onclick={() => handleRemoveTag(index)}
								>
									×
								</button>
							</span>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button variant="secondary" onclick={() => (showCreateModal = false)}>キャンセル</Button>
			<Button onclick={handleCreate} disabled={!formData.title.trim()}>作成</Button>
		</div>
	{/snippet}
</Modal>

<!-- 編集モーダル -->
<Modal bind:isOpen={showEditModal} title="設定資料編集">
	{#snippet children()}
		<div class="flex flex:col gap:16">
			<Input
				label="タイトル *"
				bind:value={formData.title}
				placeholder="用語名や場所名など"
			/>

			<div>
				<label for="edit-category" class="block mb:8 font:14 font:semibold">カテゴリ</label>
				<select
					id="edit-category"
					bind:value={formData.category}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
				>
					{#each Object.entries(categoryLabels) as [value, label]}
						<option value={value}>{label}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="edit-content" class="block mb:8 font:14 font:semibold">内容</label>
				<textarea
					id="edit-content"
					bind:value={formData.content}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:200 resize:vertical font-family:inherit"
					placeholder="詳細な説明..."
				></textarea>
			</div>

			<div>
				<label for="edit-tag-input" class="block mb:8 font:14 font:semibold">タグ</label>
				<div class="flex gap:8 mb:8">
					<input
						id="edit-tag-input"
						type="text"
						bind:value={formData.tagInput}
						placeholder="タグを入力してEnter"
						class="flex:1 px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								handleAddTag();
							}
						}}
					/>
					<Button onclick={handleAddTag}>追加</Button>
				</div>
				{#if formData.tags.length > 0}
					<div class="flex flex:wrap gap:4">
						{#each formData.tags as tag, index}
							<span class="px:12 py:6 r:full bg:blue-100 fg:blue-700 font:12 flex align-items:center gap:4">
								#{tag}
								<button
									class="w:16 h:16 r:full hover:bg:blue-200 flex align-items:center justify-content:center b:none bg:transparent"
									onclick={() => handleRemoveTag(index)}
								>
									×
								</button>
							</span>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button variant="secondary" onclick={() => (showEditModal = false)}>キャンセル</Button>
			<Button onclick={handleUpdate} disabled={!formData.title.trim()}>更新</Button>
		</div>
	{/snippet}
</Modal>

<style>
	.line-clamp\:3 {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
