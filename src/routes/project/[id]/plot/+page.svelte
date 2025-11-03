<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { plotsDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Plot } from '$lib/types';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { onMount } from 'svelte';

	let plots = $state<Plot[]>([]);
	let isLoading = $state(true);
	let viewMode = $state<'board' | 'timeline'>('board');
	let showCreateModal = $state(false);
	let showEditModal = $state(false);
	let editingPlot = $state<Plot | null>(null);

	// フォーム状態
	let formData = $state({
		title: '',
		type: 'scene' as Plot['type'],
		status: 'idea' as Plot['status'],
		content: '',
		color: '#3b82f6'
	});

	// ステータスグループ
	const statusGroups = {
		idea: { label: 'アイデア', color: 'bg:gray-100' },
		planned: { label: '計画中', color: 'bg:blue-100' },
		written: { label: '執筆済み', color: 'bg:green-100' },
		revised: { label: '推敲済み', color: 'bg:purple-100' }
	};

	const typeLabels = {
		scene: 'シーン',
		chapter: '章',
		arc: 'アーク'
	};

	onMount(async () => {
		await loadPlots();
	});

	async function loadPlots() {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			plots = await plotsDB.getByProjectId(currentProjectStore.project.id);
		} finally {
			isLoading = false;
		}
	}

	function openCreateModal() {
		formData = {
			title: '',
			type: 'scene',
			status: 'idea',
			content: '',
			color: '#3b82f6'
		};
		showCreateModal = true;
	}

	function openEditModal(plot: Plot) {
		editingPlot = plot;
		formData = {
			title: plot.title,
			type: plot.type,
			status: plot.status,
			content: plot.content,
			color: plot.color
		};
		showEditModal = true;
	}

	async function handleCreate() {
		if (!currentProjectStore.project || !formData.title.trim()) return;

		const plot = await plotsDB.create({
			projectId: currentProjectStore.project.id,
			title: formData.title,
			type: formData.type,
			status: formData.status
		});

		// 同期キューに追加
		await queueChange('plots', plot.id, 'create');

		await loadPlots();
		showCreateModal = false;
	}

	async function handleUpdate() {
		if (!editingPlot) return;

		await plotsDB.update(editingPlot.id, {
			title: formData.title,
			type: formData.type,
			status: formData.status,
			content: formData.content,
			color: formData.color
		});

		// 同期キューに追加
		await queueChange('plots', editingPlot.id, 'update');

		await loadPlots();
		showEditModal = false;
		editingPlot = null;
	}

	async function handleDelete(id: string) {
		if (!confirm('このプロットを削除しますか?')) return;
		await plotsDB.delete(id);
		// 同期キューに追加
		await queueChange('plots', id, 'delete');
		await loadPlots();
	}

	async function handleStatusChange(plot: Plot, newStatus: Plot['status']) {
		await plotsDB.update(plot.id, { status: newStatus });
		// 同期キューに追加
		await queueChange('plots', plot.id, 'update');
		await loadPlots();
	}

	function getPlotsByStatus(status: Plot['status']) {
		return plots.filter((p) => p.status === status);
	}
</script>

<div class="p:32 h:100vh overflow:auto">
	<!-- ヘッダー -->
	<div class="flex justify-content:space-between align-items:center mb:24">
		<div>
			<h1 class="font:32 font:bold mb:8">プロット管理</h1>
			<p class="fg:gray-600">作品の構成を計画・管理します</p>
		</div>
		<div class="flex gap:12">
			<div class="flex bg:gray-100 r:8 p:4">
				<button
					class="px:16 py:8 r:6 {viewMode === 'board' ? 'bg:white shadow:1' : ''}"
					onclick={() => (viewMode = 'board')}
				>
					ボード
				</button>
				<button
					class="px:16 py:8 r:6 {viewMode === 'timeline' ? 'bg:white shadow:1' : ''}"
					onclick={() => (viewMode = 'timeline')}
				>
					タイムライン
				</button>
			</div>
			<Button onclick={openCreateModal}>+ 新規プロット</Button>
		</div>
	</div>

	{#if isLoading}
		<div class="flex justify-content:center align-items:center h:400">
			<p class="fg:gray-600">読み込み中...</p>
		</div>
	{:else if viewMode === 'board'}
		<!-- Kanbanボードビュー -->
		<div class="grid cols:4 gap:16">
			{#each Object.entries(statusGroups) as [status, config]}
				<div class="flex flex:col gap:12">
					<div class="flex align-items:center justify-content:space-between">
						<h3 class="font:18 font:semibold">{config.label}</h3>
						<span class="px:8 py:4 r:full bg:gray-200 font:12">
							{getPlotsByStatus(status as Plot['status']).length}
						</span>
					</div>
					<div class="flex flex:col gap:8 min-h:400 p:12 bg:gray-50 r:8">
						{#each getPlotsByStatus(status as Plot['status']) as plot (plot.id)}
							<Card class="p:16 cursor:pointer hover:shadow:2 transition:all|200ms">
								<div class="flex justify-content:space-between align-items:start mb:8">
									<div class="flex align-items:center gap:8">
										<div
											class="w:12 h:12 r:full"
											style="background-color: {plot.color}"
										></div>
										<span class="px:8 py:4 r:6 bg:gray-100 font:12 fg:gray-700">
											{typeLabels[plot.type]}
										</span>
									</div>
								</div>
								<button
									class="font:16 font:semibold mb:8 cursor:pointer hover:fg:blue-600 bg:transparent b:none text-align:left w:full"
									onclick={() => openEditModal(plot)}
								>
									{plot.title}
								</button>
								{#if plot.content}
									<p class="fg:gray-600 font:14 mb:12 line-clamp:3">
										{plot.content}
									</p>
								{/if}
								<div class="flex gap:8">
									<button
										class="flex:1 px:12 py:6 bg:blue-50 fg:blue-600 r:6 font:14 hover:bg:blue-100"
										onclick={() => openEditModal(plot)}
									>
										編集
									</button>
									<button
										class="px:12 py:6 bg:red-50 fg:red-600 r:6 font:14 hover:bg:red-100"
										onclick={() => handleDelete(plot.id)}
									>
										削除
									</button>
								</div>
								{#if status !== 'revised'}
									<button
										class="w:full mt:8 px:12 py:6 bg:green-50 fg:green-600 r:6 font:14 hover:bg:green-100"
										onclick={() => {
											const statuses: Plot['status'][] = ['idea', 'planned', 'written', 'revised'];
											const currentIndex = statuses.indexOf(plot.status);
											if (currentIndex < statuses.length - 1) {
												handleStatusChange(plot, statuses[currentIndex + 1]);
											}
										}}
									>
										次へ →
									</button>
								{/if}
							</Card>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- タイムラインビュー -->
		<div class="flex flex:col gap:16">
			{#each plots as plot (plot.id)}
				<Card class="p:24">
					<div class="flex gap:16">
						<div
							class="w:4 bg:gray-200 r:2 flex-shrink:0"
							style="background-color: {plot.color}"
						></div>
						<div class="flex:1">
							<div class="flex justify-content:space-between align-items:start mb:12">
								<div>
									<div class="flex align-items:center gap:8 mb:8">
										<span class="px:12 py:6 r:6 bg:gray-100 font:14">
											{typeLabels[plot.type]}
										</span>
										<span
											class="px:12 py:6 r:6 font:14 {statusGroups[plot.status].color}"
										>
											{statusGroups[plot.status].label}
										</span>
									</div>
									<h3 class="font:20 font:semibold">{plot.title}</h3>
								</div>
								<div class="flex gap:8">
									<Button variant="secondary" onclick={() => openEditModal(plot)}>
										編集
									</Button>
									<Button variant="secondary" onclick={() => handleDelete(plot.id)}>
										削除
									</Button>
								</div>
							</div>
							{#if plot.content}
								<p class="fg:gray-700 font:16 white-space:pre-wrap">{plot.content}</p>
							{/if}
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{/if}

	{#if plots.length === 0 && !isLoading}
		<div class="flex flex:col align-items:center justify-content:center h:400 gap:16">
			<p class="fg:gray-500 font:18">プロットがまだありません</p>
			<Button onclick={openCreateModal}>最初のプロットを作成</Button>
		</div>
	{/if}
</div>

<!-- 新規作成モーダル -->
<Modal bind:isOpen={showCreateModal} title="新規プロット作成">
	{#snippet children()}
		<div class="flex flex:col gap:16">
			<Input label="タイトル" bind:value={formData.title} placeholder="プロット名を入力" />

			<div>
				<label for="type-select" class="block mb:8 font:14 font:semibold">種類</label>
				<select
					id="type-select"
					bind:value={formData.type}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
				>
					<option value="scene">シーン</option>
					<option value="chapter">章</option>
					<option value="arc">アーク</option>
				</select>
			</div>

			<div>
				<label for="status-select" class="block mb:8 font:14 font:semibold">ステータス</label>
				<select
					id="status-select"
					bind:value={formData.status}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
				>
					<option value="idea">アイデア</option>
					<option value="planned">計画中</option>
					<option value="written">執筆済み</option>
					<option value="revised">推敲済み</option>
				</select>
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
<Modal bind:isOpen={showEditModal} title="プロット編集">
	{#snippet children()}
		<div class="flex flex:col gap:16">
			<Input label="タイトル" bind:value={formData.title} placeholder="プロット名を入力" />

			<div>
				<label for="edit-type-select" class="block mb:8 font:14 font:semibold">種類</label>
				<select
					id="edit-type-select"
					bind:value={formData.type}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
				>
					<option value="scene">シーン</option>
					<option value="chapter">章</option>
					<option value="arc">アーク</option>
				</select>
			</div>

			<div>
				<label for="edit-status-select" class="block mb:8 font:14 font:semibold">ステータス</label>
				<select
					id="edit-status-select"
					bind:value={formData.status}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
				>
					<option value="idea">アイデア</option>
					<option value="planned">計画中</option>
					<option value="written">執筆済み</option>
					<option value="revised">推敲済み</option>
				</select>
			</div>

			<div>
				<label for="edit-content" class="block mb:8 font:14 font:semibold">内容</label>
				<textarea
					id="edit-content"
					bind:value={formData.content}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:200 resize:vertical font-family:inherit"
					placeholder="プロットの詳細を入力..."
				></textarea>
			</div>

			<div>
				<label for="edit-color" class="block mb:8 font:14 font:semibold">カラー</label>
				<input
					id="edit-color"
					type="color"
					bind:value={formData.color}
					class="w:full h:48 r:8 cursor:pointer"
				/>
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
