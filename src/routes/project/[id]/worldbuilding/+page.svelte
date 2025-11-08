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
		term: 'bg:$(theme.info)/.15 fg:$(theme.info)',
		timeline: 'bg:$(theme.success)/.15 fg:$(theme.success)',
		location: 'bg:$(theme.secondary)/.15 fg:$(theme.secondary)',
		other: 'bg:theme-surface fg:theme-text-secondary'
	};

	function actionButtonClass(variant: 'default' | 'secondary' | 'danger' = 'default'): string {
		const base = 'px:12 py:8 r:6 b:1px|solid|theme-border bg:theme-background transition:all|.2s';
		const variants = {
			default: 'fg:theme-text hover:bg:$(theme.primary)/.12 hover:fg:$(theme.primary)',
			secondary: 'fg:theme-text-secondary hover:bg:theme-surface',
			danger: 'fg:theme-error hover:bg:$(theme.error)/.15'
		} as const;
		return `${base} ${variants[variant]}`;
	}

	const textareaBaseClass =
		'w:full px:12 py:10 b:1|solid|theme-border bg:theme-background r:8 outline:none focus:b:$(theme.primary) transition:all|.2s font-family:inherit fg:theme-text';

	const fieldBaseClass =
		'w:full px:12 py:10 b:1|solid|theme-border bg:theme-background fg:theme-text r:8 outline:none focus:b:$(theme.primary) transition:all|.2s';

	function filterButtonClass(category: Worldbuilding['category'] | 'all'): string {
		const isActive = activeCategory === category;
		return [
			'px:16 py:10 r:8 font:14 transition:all|.2s b:1px|solid|theme-border',
			isActive
				? 'bg:$(theme.primary)/.15 fg:$(theme.primary)'
				: 'bg:theme-background fg:theme-text-secondary hover:bg:theme-surface'
		].join(' ');
	}

	onMount(async () => {
		await loadWorldbuildings();
	});

	const loadWorldbuildings = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			worldbuildings = await worldbuildingDB.getByProjectId(currentProjectStore.project.id);
		} finally {
			isLoading = false;
		}
	};

	const openCreateModal = () => {
		formData = {
			title: '',
			category: 'term',
			content: '',
			tags: [],
			tagInput: ''
		};
		showCreateModal = true;
	};

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

	const handleCreate = async () => {
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
	};

	const handleUpdate = async () => {
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
	};

	async function handleDelete(id: string) {
		if (!confirm('この設定資料を削除しますか?')) return;
		await worldbuildingDB.delete(id);
		// 同期キューに追加
		await queueChange('worldbuilding', id, 'delete');
		await loadWorldbuildings();
	}

	const handleAddTag = () => {
		if (formData.tagInput.trim() && !formData.tags.includes(formData.tagInput.trim())) {
			formData.tags = [...formData.tags, formData.tagInput.trim()];
			formData.tagInput = '';
		}
	};

	function handleRemoveTag(index: number) {
		formData.tags = formData.tags.filter((_, i) => i !== index);
	}

	const getCategoryCounts = () => {
		return {
			all: worldbuildings.length,
			term: worldbuildings.filter((w) => w.category === 'term').length,
			timeline: worldbuildings.filter((w) => w.category === 'timeline').length,
			location: worldbuildings.filter((w) => w.category === 'location').length,
			other: worldbuildings.filter((w) => w.category === 'other').length
		};
	};

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

	let allTags = $derived(Array.from(new Set(worldbuildings.flatMap((w) => w.tags))).sort());
</script>

<div class="flex w:100% h:100% bg:theme-background fg:theme-text">
	<div class="flex-grow:1 flex flex-direction:column">
		<header class="bg:theme-background border-bottom:2|solid|theme-text">
			<div
				class="max-w:1280 mx:auto w:100% px:24 py:20 flex justify-content:space-between align-items:center"
			>
				<div>
					<h1 class="font:26 font-weight:600 m:0 fg:theme-text">設定資料管理</h1>
					<p class="font:14 fg:theme-text-secondary mt:8">世界観や用語の設定資料を管理します</p>
				</div>
				<Button
					class="px:18 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8 font:14"
					onclick={openCreateModal}
					disabled={!currentProjectStore.project}
				>
					+ 新規資料
				</Button>
			</div>
		</header>

		<main class="flex-grow:1 overflow-y:auto">
			<div class="max-w:1280 mx:auto w:100% px:24 py:24 flex flex-direction:column gap:24">
				<div class="flex flex-wrap gap:16 justify-content:space-between align-items:center">
					<div class="flex:1 min-w:240">
						<Input bind:value={searchQuery} placeholder="タイトル、内容、タグで検索..." />
					</div>
					<div class="flex gap:8 flex-wrap">
						{#if getCategoryCounts()}
							{@const counts = getCategoryCounts()}
							{#each Object.entries({ all: 'すべて', ...categoryLabels }) as [key, label]}
								<button
									class={filterButtonClass(key as typeof activeCategory)}
									onclick={() => (activeCategory = key as typeof activeCategory)}
								>
									{label}
									<span class="ml:8 font:12 fg:theme-text-secondary">
										{counts[key as keyof typeof counts]}
									</span>
								</button>
							{/each}
						{/if}
					</div>
				</div>

				{#if isLoading}
					<div class="flex justify-content:center align-items:center h:320">
						<p class="fg:theme-text-secondary font:14">読み込み中...</p>
					</div>
				{:else}
					<div
						class="grid gap:16 md:grid-template-columns:repeat(2,minmax(0,1fr)) xl:grid-template-columns:repeat(3,minmax(0,1fr))"
					>
						{#each filteredWorldbuildings as worldbuilding (worldbuilding.id)}
							<Card class="flex flex-direction:column gap:16" padding="sm">
								<div class="flex justify-content:space-between align-items:start">
									<div class="flex flex-direction:column gap:8 flex:1">
										<span
											class={`px:12 py:6 r:6 font:12 ${categoryColors[worldbuilding.category]}`}
										>
											{categoryLabels[worldbuilding.category]}
										</span>
										<button
											class="font:18 font-weight:600 text-align:left bg:transparent b:none fg:theme-text hover:fg:$(theme.primary)"
											onclick={() => openEditModal(worldbuilding)}
										>
											{worldbuilding.title}
										</button>
									</div>
								</div>

								{#if worldbuilding.content}
									<p class="fg:theme-text-secondary font:14 line-clamp:3 white-space:pre-wrap">
										{worldbuilding.content}
									</p>
								{/if}

								{#if worldbuilding.tags.length > 0}
									<div class="flex flex-wrap gap:6">
										{#each worldbuilding.tags as tag}
											<span
												class="px:10 py:4 r:full bg:$(theme.primary)/.12 fg:$(theme.primary) font:12"
											>
												#{tag}
											</span>
										{/each}
									</div>
								{/if}

								<div class="flex gap:8">
									<button
										class={`flex:1 ${actionButtonClass()}`}
										onclick={() => openEditModal(worldbuilding)}
									>
										編集
									</button>
									<button
										class={actionButtonClass('danger')}
										onclick={() => handleDelete(worldbuilding.id)}
									>
										削除
									</button>
								</div>
							</Card>
						{/each}
					</div>

					{#if filteredWorldbuildings.length === 0}
						<div
							class="flex flex-direction:column align-items:center justify-content:center h:320 gap:16 bg:theme-surface r:12 b:1px|solid|theme-border"
						>
							<p class="fg:theme-text-secondary font:16">
								{searchQuery || activeCategory !== 'all'
									? '該当する資料がありません'
									: '設定資料がまだありません'}
							</p>
							<Button
								class="px:18 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8"
								onclick={openCreateModal}
							>
								最初の資料を作成
							</Button>
						</div>
					{/if}
				{/if}

				{#if allTags.length > 0}
					<div
						class="p:20 bg:theme-surface b:1px|solid|theme-border r:12 flex flex-direction:column gap:12"
					>
						<h3 class="font:16 font-weight:600 fg:theme-text">タグ一覧</h3>
						<div class="flex flex-wrap gap:8">
							{#each allTags as tag}
								<button
									class="px:12 py:6 r:full bg:theme-background b:1px|solid|theme-border fg:theme-text font:12 transition:all|.2s hover:bg:$(theme.primary)/.12 hover:fg:$(theme.primary)"
									onclick={() => (searchQuery = tag)}
								>
									#{tag}
									<span class="ml:4 fg:theme-text-secondary">
										{worldbuildings.filter((w) => w.tags.includes(tag)).length}
									</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</main>
	</div>
</div>

<!-- 新規作成モーダル -->
<Modal bind:isOpen={showCreateModal} title="新規設定資料作成">
	{#snippet children()}
		<div class="flex flex-direction:column gap:16">
			<Input label="タイトル *" bind:value={formData.title} placeholder="用語名や場所名など" />

			<div>
				<label for="create-category" class="block mb:8 font:14 font-weight:600 fg:theme-text"
					>カテゴリ</label
				>
				<select id="create-category" bind:value={formData.category} class={fieldBaseClass}>
					{#each Object.entries(categoryLabels) as [value, label]}
						<option {value}>{label}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="create-content" class="block mb:8 font:14 font-weight:600 fg:theme-text"
					>内容</label
				>
				<textarea
					id="create-content"
					bind:value={formData.content}
					class={`${textareaBaseClass} min-h:200 resize:vertical`}
					placeholder="詳細な説明..."
				></textarea>
			</div>

			<div>
				<label for="create-tag-input" class="block mb:8 font:14 font-weight:600 fg:theme-text"
					>タグ</label
				>
				<div class="flex gap:8 mb:8">
					<input
						id="create-tag-input"
						type="text"
						bind:value={formData.tagInput}
						placeholder="タグを入力してEnter"
						class={`flex:1 ${fieldBaseClass}`}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								handleAddTag();
							}
						}}
					/>
					<Button
						class="px:16 py:8 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:6"
						onclick={handleAddTag}
					>
						追加
					</Button>
				</div>
				{#if formData.tags.length > 0}
					<div class="flex flex-wrap gap:6">
						{#each formData.tags as tag, index}
							<span
								class="px:12 py:6 r:full bg:$(theme.primary)/.12 fg:$(theme.primary) font:12 flex align-items:center gap:6"
							>
								#{tag}
								<button
									class="w:18 h:18 r:full hover:bg:$(theme.primary)/.2 flex align-items:center justify-content:center b:none bg:transparent fg:$(theme.primary)"
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
			<Button
				variant="secondary"
				class={actionButtonClass('secondary')}
				onclick={() => (showCreateModal = false)}>キャンセル</Button
			>
			<Button
				class="px:18 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8"
				onclick={handleCreate}
				disabled={!formData.title.trim()}
			>
				作成
			</Button>
		</div>
	{/snippet}
</Modal>

<!-- 編集モーダル -->
<Modal bind:isOpen={showEditModal} title="設定資料編集">
	{#snippet children()}
		<div class="flex flex-direction:column gap:16">
			<Input label="タイトル *" bind:value={formData.title} placeholder="用語名や場所名など" />

			<div>
				<label for="edit-category" class="block mb:8 font:14 font-weight:600 fg:theme-text"
					>カテゴリ</label
				>
				<select id="edit-category" bind:value={formData.category} class={fieldBaseClass}>
					{#each Object.entries(categoryLabels) as [value, label]}
						<option {value}>{label}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="edit-content" class="block mb:8 font:14 font-weight:600 fg:theme-text"
					>内容</label
				>
				<textarea
					id="edit-content"
					bind:value={formData.content}
					class={`${textareaBaseClass} min-h:200 resize:vertical`}
					placeholder="詳細な説明..."
				></textarea>
			</div>

			<div>
				<label for="edit-tag-input" class="block mb:8 font:14 font-weight:600 fg:theme-text"
					>タグ</label
				>
				<div class="flex gap:8 mb:8">
					<input
						id="edit-tag-input"
						type="text"
						bind:value={formData.tagInput}
						placeholder="タグを入力してEnter"
						class={`flex:1 ${fieldBaseClass}`}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								handleAddTag();
							}
						}}
					/>
					<Button
						class="px:16 py:8 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:6"
						onclick={handleAddTag}
					>
						追加
					</Button>
				</div>
				{#if formData.tags.length > 0}
					<div class="flex flex-wrap gap:6">
						{#each formData.tags as tag, index}
							<span
								class="px:12 py:6 r:full bg:$(theme.primary)/.12 fg:$(theme.primary) font:12 flex align-items:center gap:6"
							>
								#{tag}
								<button
									class="w:18 h:18 r:full hover:bg:$(theme.primary)/.2 flex align-items:center justify-content:center b:none bg:transparent fg:$(theme.primary)"
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
			<Button
				variant="secondary"
				class={actionButtonClass('secondary')}
				onclick={() => (showEditModal = false)}>キャンセル</Button
			>
			<Button
				class="px:18 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8"
				onclick={handleUpdate}
				disabled={!formData.title.trim()}
			>
				更新
			</Button>
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
