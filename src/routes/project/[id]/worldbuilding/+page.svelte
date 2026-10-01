<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { worldbuildingDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Worldbuilding } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import SearchBox from '$lib/components/ui/SearchBox.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ModalActions from '$lib/components/ui/ModalActions.svelte';
	import {
		buttonClass,
		badgeClass,
		fieldClass,
		textareaClass
	} from '$lib/components/ui/formStyles';
	import { deleteWithUndo } from '$lib/utils/undoDelete';
	import { onMount } from 'svelte';

	type CategoryFilter = Worldbuilding['category'] | 'all';

	let worldbuildings = $state<Worldbuilding[]>([]);
	let isLoading = $state(true);
	let activeCategory = $state<CategoryFilter>('all');
	let searchQuery = $state('');

	// 作成・編集で共用するモーダル（editingWorldbuilding が null なら新規作成）
	let showFormModal = $state(false);
	let editingWorldbuilding = $state<Worldbuilding | null>(null);
	let isSaving = $state(false);

	let formData = $state({
		title: '',
		category: 'term' as Worldbuilding['category'],
		content: '',
		tags: [] as string[],
		tagInput: ''
	});

	const categoryLabels: Record<Worldbuilding['category'], string> = {
		term: '用語',
		timeline: '年表',
		location: '場所',
		other: 'その他'
	};

	let categoryOptions = $derived([
		{ value: 'all' as CategoryFilter, label: 'すべて', count: worldbuildings.length },
		...(Object.keys(categoryLabels) as Worldbuilding['category'][]).map((c) => ({
			value: c as CategoryFilter,
			label: categoryLabels[c],
			count: worldbuildings.filter((w) => w.category === c).length
		}))
	]);

	let filteredWorldbuildings = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return worldbuildings.filter((w) => {
			const matchCategory = activeCategory === 'all' || w.category === activeCategory;
			const matchSearch =
				!q ||
				w.title.toLowerCase().includes(q) ||
				w.content.toLowerCase().includes(q) ||
				w.tags.some((tag) => tag.toLowerCase().includes(q));
			return matchCategory && matchSearch;
		});
	});

	let isFiltering = $derived(searchQuery.trim() !== '' || activeCategory !== 'all');

	let allTags = $derived(Array.from(new Set(worldbuildings.flatMap((w) => w.tags))).sort());

	onMount(async () => {
		await loadWorldbuildings();
	});

	const loadWorldbuildings = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			worldbuildings = await worldbuildingDB.getByProjectId(currentProjectStore.project.id);
		} catch (error) {
			console.error('Failed to load worldbuilding:', error);
			toast.error('設定資料の読み込みに失敗しました');
		} finally {
			isLoading = false;
		}
	};

	const openCreateModal = () => {
		editingWorldbuilding = null;
		formData = { title: '', category: 'term', content: '', tags: [], tagInput: '' };
		showFormModal = true;
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
		showFormModal = true;
	}

	const handleSave = async () => {
		if (!currentProjectStore.project || !formData.title.trim() || isSaving) return;
		isSaving = true;
		const title = formData.title.trim();
		try {
			if (editingWorldbuilding) {
				await worldbuildingDB.update(editingWorldbuilding.id, {
					title,
					category: formData.category,
					content: formData.content,
					tags: [...formData.tags]
				});
				await queueChange('worldbuilding', editingWorldbuilding.id, 'update');
				toast.success(`設定資料「${title}」を更新しました`);
			} else {
				const worldbuilding = await worldbuildingDB.create({
					projectId: currentProjectStore.project.id,
					title,
					category: formData.category
				});
				await worldbuildingDB.update(worldbuilding.id, {
					content: formData.content,
					tags: [...formData.tags]
				});
				await queueChange('worldbuilding', worldbuilding.id, 'create');
				toast.success(`設定資料「${title}」を作成しました`);
			}
			showFormModal = false;
			editingWorldbuilding = null;
			await loadWorldbuildings();
		} catch (error) {
			console.error('Failed to save worldbuilding:', error);
			toast.error(
				editingWorldbuilding ? '設定資料の更新に失敗しました' : '設定資料の作成に失敗しました'
			);
		} finally {
			isSaving = false;
		}
	};

	function handleDelete(worldbuilding: Worldbuilding) {
		// 取り消し用に削除前のレコードを保持する
		const snapshot = $state.snapshot(worldbuilding) as Worldbuilding;
		return deleteWithUndo({
			targetLabel: `設定資料「${snapshot.title}」`,
			remove: async () => {
				await worldbuildingDB.delete(snapshot.id);
				await queueChange('worldbuilding', snapshot.id, 'delete');
				await loadWorldbuildings();
			},
			restore: async () => {
				await worldbuildingDB.addFromRemote(snapshot);
				await queueChange('worldbuilding', snapshot.id, 'create');
				await loadWorldbuildings();
			}
		});
	}

	const handleAddTag = () => {
		const tag = formData.tagInput.trim();
		if (tag && !formData.tags.includes(tag)) {
			formData.tags = [...formData.tags, tag];
		}
		formData.tagInput = '';
	};

	function handleRemoveTag(index: number) {
		formData.tags = formData.tags.filter((_, i) => i !== index);
	}
</script>

<svelte:head>
	<title>設定資料 | Storift</title>
</svelte:head>

<div class="flex flex-direction:column w:100% h:100% bg:theme-background fg:theme-text">
	<PageHeader title="設定資料" description="世界観や用語の設定資料を管理します">
		{#snippet actions()}
			<button
				type="button"
				class={buttonClass('primary')}
				onclick={openCreateModal}
				disabled={!currentProjectStore.project}
			>
				+ 新規資料
			</button>
		{/snippet}
	</PageHeader>

	<main class="flex-grow:1 overflow-y:auto">
		<div class="max-w:1280 mx:auto w:100% px:24 py:24 flex flex-direction:column gap:24">
			<div class="flex flex-wrap:wrap align-items:center gap:12">
				<SearchBox
					bind:value={searchQuery}
					placeholder="タイトル、内容、タグで検索..."
					ariaLabel="設定資料を検索"
				/>
				<SegmentedControl
					options={categoryOptions}
					bind:value={activeCategory}
					ariaLabel="カテゴリで絞り込み"
				/>
			</div>

			{#if isLoading}
				<div class="flex justify-content:center align-items:center h:320">
					<p class="fg:theme-text-secondary font:14">読み込み中...</p>
				</div>
			{:else if worldbuildings.length === 0}
				<EmptyState
					message="設定資料がまだありません"
					actionLabel="最初の資料を作成"
					onaction={openCreateModal}
				/>
			{:else if isFiltering && filteredWorldbuildings.length === 0}
				<EmptyState message="条件に一致する資料がありません" />
			{:else}
				<div
					class="grid gap:16 grid-template-columns:repeat(1,minmax(0,1fr)) md:grid-template-columns:repeat(2,minmax(0,1fr)) xl:grid-template-columns:repeat(3,minmax(0,1fr))"
				>
					{#each filteredWorldbuildings as worldbuilding (worldbuilding.id)}
						<Card class="flex flex-direction:column gap:12" padding="sm">
							<div class="flex flex-direction:column align-items:start gap:8">
								<span class={badgeClass}>{categoryLabels[worldbuilding.category]}</span>
								<button
									type="button"
									class="font:18 font-weight:600 text-align:left bg:transparent b:none p:0 cursor:pointer fg:theme-text fg:theme-primary:hover"
									onclick={() => openEditModal(worldbuilding)}
								>
									{worldbuilding.title}
								</button>
							</div>

							{#if worldbuilding.content}
								<p
									class="fg:theme-text-secondary font:14 m:0 white-space:pre-wrap"
									style="display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;"
								>
									{worldbuilding.content}
								</p>
							{/if}

							{#if worldbuilding.tags.length > 0}
								<div class="flex flex-wrap:wrap gap:6">
									{#each worldbuilding.tags as tag (tag)}
										<span class={badgeClass}>#{tag}</span>
									{/each}
								</div>
							{/if}

							<div class="flex gap:8 mt:auto">
								<button
									type="button"
									class={buttonClass('secondary', 'flex:1')}
									onclick={() => openEditModal(worldbuilding)}
								>
									編集
								</button>
								<button
									type="button"
									class={buttonClass('danger')}
									aria-label={`設定資料「${worldbuilding.title}」を削除`}
									onclick={() => handleDelete(worldbuilding)}
								>
									削除
								</button>
							</div>
						</Card>
					{/each}
				</div>
			{/if}

			{#if allTags.length > 0}
				<section
					aria-label="タグ一覧"
					class="p:16 bg:theme-surface b:1|solid|theme-border r:8 flex flex-direction:column gap:12"
				>
					<h2 class="font:16 font-weight:600 fg:theme-text m:0">タグ一覧</h2>
					<div class="flex flex-wrap:wrap gap:8">
						{#each allTags as tag (tag)}
							<button
								type="button"
								aria-pressed={searchQuery === tag}
								class="px:12 py:4 r:full b:1|solid|theme-border font:12 cursor:pointer transition:all|.2s {searchQuery ===
								tag
									? 'bg:theme-text fg:theme-background'
									: 'bg:theme-background fg:theme-text bg:theme-surface:hover'}"
								onclick={() => (searchQuery = searchQuery === tag ? '' : tag)}
							>
								#{tag}
								<span class="ml:4 opacity:.7">
									{worldbuildings.filter((w) => w.tags.includes(tag)).length}
								</span>
							</button>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	</main>
</div>

<Modal
	bind:isOpen={showFormModal}
	title={editingWorldbuilding ? '設定資料編集' : '新規設定資料作成'}
>
	<div class="flex flex-direction:column gap:16">
		<FormField label="タイトル" required>
			{#snippet children(id)}
				<input
					{id}
					type="text"
					bind:value={formData.title}
					placeholder="用語名や場所名など"
					class={fieldClass}
				/>
			{/snippet}
		</FormField>

		<FormField label="カテゴリ">
			{#snippet children(id)}
				<select {id} bind:value={formData.category} class={fieldClass}>
					{#each Object.entries(categoryLabels) as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			{/snippet}
		</FormField>

		<FormField label="内容">
			{#snippet children(id)}
				<textarea
					{id}
					bind:value={formData.content}
					class="{textareaClass} min-h:160"
					placeholder="詳細な説明..."
				></textarea>
			{/snippet}
		</FormField>

		<FormField label="タグ">
			{#snippet children(id)}
				<div class="flex gap:8">
					<input
						{id}
						type="text"
						bind:value={formData.tagInput}
						placeholder="タグを入力してEnter"
						class="{fieldClass} flex:1"
						onkeydown={(e) => {
							// 日本語入力の変換確定 Enter では追加しない
							if (e.key === 'Enter' && !e.isComposing) {
								e.preventDefault();
								handleAddTag();
							}
						}}
					/>
					<button
						type="button"
						class={buttonClass('secondary')}
						disabled={!formData.tagInput.trim()}
						onclick={handleAddTag}
					>
						追加
					</button>
				</div>
				{#if formData.tags.length > 0}
					<div class="flex flex-wrap:wrap gap:6">
						{#each formData.tags as tag, index (tag)}
							<span class="{badgeClass} flex align-items:center gap:6">
								#{tag}
								<button
									type="button"
									aria-label={`タグ「${tag}」を削除`}
									class="w:18 h:18 r:full flex align-items:center justify-content:center b:none bg:transparent fg:theme-text-secondary cursor:pointer bg:theme-surface:hover"
									onclick={() => handleRemoveTag(index)}
								>
									×
								</button>
							</span>
						{/each}
					</div>
				{/if}
			{/snippet}
		</FormField>
	</div>

	{#snippet footer()}
		<ModalActions
			submitLabel={editingWorldbuilding ? '更新' : '作成'}
			submitDisabled={!formData.title.trim() || isSaving}
			onsubmit={handleSave}
			oncancel={() => (showFormModal = false)}
		/>
	{/snippet}
</Modal>
