<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { plotsDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Plot } from '$lib/types';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import { createPlotContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import { onMount } from 'svelte';

	let plots = $state<Plot[]>([]);
	let isLoading = $state(true);
	type ViewMode = 'board' | 'timeline';
	let viewMode = $state<ViewMode>('board');
	let showCreateModal = $state(false);
	let showEditModal = $state(false);
	let editingPlot = $state<Plot | null>(null);

	// コンテキストメニュー
	let contextMenu = $state<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
		targetPlot?: Plot;
	}>({ visible: false, x: 0, y: 0, items: [] });

	// フォーム状態
	let formData = $state({
		title: '',
		type: 'scene' as Plot['type'],
		status: 'idea' as Plot['status'],
		content: '',
		color: '#3b82f6'
	});

function viewToggleClass(mode: ViewMode): string {
	return [
		'px:16 py:8 r:8 font:13 transition:all|.2s|ease b:2px|solid|theme-border',
		viewMode === mode
			? 'bg:$(theme.primary)/.15 fg:$(theme.primary)'
			: 'bg:theme-background fg:theme-text-secondary hover:bg:theme-surface'
	].join(' ');
}

function actionButtonClass(
	variant: 'default' | 'secondary' | 'success' | 'danger' = 'default'
): string {
	const base = 'px:12 py:8 r:6 b:2px|solid|theme-border bg:theme-background transition:all|.2s|ease';
	const variants = {
		default: 'fg:theme-text hover:bg:$(theme.primary)/.12 hover:fg:$(theme.primary)',
		secondary: 'fg:theme-text-secondary hover:bg:theme-surface',
		success: 'fg:theme-success hover:bg:$(theme.success)/.12',
		danger: 'fg:theme-error hover:bg:theme-error hover:fg:theme-background'
	} as const;
	return `${base} ${variants[variant]}`;
}

const textareaBaseClass =
	'w:full px:12 py:10 b:1|solid|theme-border bg:theme-background r:8 outline:none focus:b:$(theme.primary) transition:all|.2s font-family:inherit fg:theme-text';

const fieldBaseClass =
	'px:12 py:10 b:1|solid|theme-border bg:theme-background fg:theme-text r:8 outline:none focus:b:$(theme.primary) transition:all|.2s';

// ステータスグループ
const statusGroups: Record<Plot['status'], { label: string; badgeClass: string }> = {
	idea: { label: 'アイデア', badgeClass: 'bg:$(theme.info)/.15 fg:$(theme.info)' },
	planned: { label: '計画中', badgeClass: 'bg:$(theme.secondary)/.15 fg:$(theme.secondary)' },
	written: { label: '執筆済み', badgeClass: 'bg:$(theme.success)/.15 fg:$(theme.success)' },
	revised: { label: '推敲済み', badgeClass: 'bg:$(theme.primary)/.18 fg:$(theme.primary)' }
};

	const typeLabels = {
		scene: 'シーン',
		chapter: '章',
		arc: 'アーク'
	};

	onMount(async () => {
		await loadPlots();
	});

	const loadPlots = async() => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			plots = await plotsDB.getByProjectId(currentProjectStore.project.id);
		} finally {
			isLoading = false;
		}
	}

	const openCreateModal = () => {
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

	const handleCreate = async() => {
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

	const handleUpdate = async() => {
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
		const previousStatus = plot.status;
		plots = plots.map((p) => (p.id === plot.id ? { ...p, status: newStatus } : p));

		try {
			await plotsDB.update(plot.id, { status: newStatus });
			await queueChange('plots', plot.id, 'update');
		} catch (error) {
			console.error('Failed to update plot status:', error);
			plots = plots.map((p) => (p.id === plot.id ? { ...p, status: previousStatus } : p));
			alert('ステータスの更新に失敗しました');
		} finally {
			await loadPlots();
		}
	}

	function getPlotsByStatus(status: Plot['status']) {
		return plots.filter((p) => p.status === status);
	}

	// コンテキストメニュー - プロット
	function handlePlotContextMenu(e: MouseEvent, plot: Plot) {
		e.preventDefault();
		e.stopPropagation();

		const items = createPlotContextMenu({
			onEdit: () => openEditModal(plot),
			onDuplicate: () => handleDuplicatePlot(plot),
			onDelete: () => handleDelete(plot.id)
		});

		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items,
			targetPlot: plot
		};
	}

	// 複製処理
	async function handleDuplicatePlot(plot: Plot) {
		if (!currentProjectStore.project) return;

		try {
			const newPlot = await plotsDB.create({
				projectId: currentProjectStore.project.id,
				title: `${plot.title} (コピー)`,
				type: plot.type,
				status: plot.status
			});

			await plotsDB.update(newPlot.id, {
				content: plot.content,
				color: plot.color
			});

			await queueChange('plots', newPlot.id, 'create');
			await loadPlots();
		} catch (error) {
			console.error('Failed to duplicate plot:', error);
			alert('プロットの複製に失敗しました');
		}
	}
</script>

<div class="flex w:100% h:100% bg:theme-background fg:theme-text">
	<div class="flex-grow:1 flex flex-direction:column">
		<header class="bg:theme-background border-bottom:2|solid|theme-text">
			<div class="max-w:1280 mx:auto w:100% px:24 py:20 flex justify-content:space-between align-items:center">
				<div>
					<h1 class="font:26 font-weight:600 m:0 fg:theme-text">プロット管理</h1>
					<p class="font:14 fg:theme-text-secondary mt:8">作品の構成を計画・管理します</p>
				</div>
				<div class="flex align-items:center gap:12">
					<div class="flex bg:theme-surface b:2px|solid|theme-border r:10 p:6 gap:8">
						<button class={viewToggleClass('board')} onclick={() => (viewMode = 'board')}>
							ボード
						</button>
						<button class={viewToggleClass('timeline')} onclick={() => (viewMode = 'timeline')}>
							タイムライン
						</button>
					</div>
					<Button class="px:16 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8 font:14" onclick={openCreateModal}>
						+ 新規プロット
					</Button>
				</div>
			</div>
		</header>

		<main class="flex-grow:1 overflow-y:auto">
			<div class="max-w:1280 mx:auto w:100% px:24 py:24 flex flex-direction:column gap:24">
				{#if isLoading}
					<div class="flex flex-direction:column gap:16">
						<div class="h:140 bg:theme-surface b:1px|solid|theme-border r:12 animate:pulse"></div>
						<div class="h:140 bg:theme-surface b:1px|solid|theme-border r:12 animate:pulse"></div>
						<div class="h:140 bg:theme-surface b:1px|solid|theme-border r:12 animate:pulse"></div>
					</div>
				{:else if viewMode === 'board'}
					<div class="grid gap:16 md:grid-template-columns:repeat(2,minmax(0,1fr)) xl:grid-template-columns:repeat(4,minmax(0,1fr))">
						{#each Object.entries(statusGroups) as [status, config]}
							<div class="flex flex-direction:column gap:12">
								<div class="flex align-items:center justify-content:space-between">
									<h3 class="font:18 font-weight:600 fg:theme-text">{config.label}</h3>
									<span class="px:10 py:4 r:999 b:1px|solid|theme-border bg:theme-background font:12 fg:theme-text-secondary">
										{getPlotsByStatus(status as Plot['status']).length}
									</span>
								</div>
								<div class="flex flex-direction:column gap:12 min-h:420 p:12 bg:theme-surface b:1px|solid|theme-border r:12">
									{#each getPlotsByStatus(status as Plot['status']) as plot (plot.id)}
										<Card
											padding="sm"
											hoverable={true}
											class="flex flex-direction:column gap:12"
											oncontextmenu={(e) => handlePlotContextMenu(e, plot)}
										>
											<div class="flex justify-content:space-between align-items:start">
												<div class="flex align-items:center gap:8">
													<div class="w:12 h:12 r:full" style="background-color: {plot.color}"></div>
													<span class="px:8 py:4 r:6 bg:theme-background b:1px|solid|theme-border font:12 fg:theme-text-secondary">
														{typeLabels[plot.type]}
													</span>
												</div>
											</div>
											<button
												class="font:16 font-weight:600 text-align:left bg:transparent b:none fg:theme-text hover:fg:$(theme.primary)"
												onclick={() => openEditModal(plot)}
											>
												{plot.title}
											</button>
											{#if plot.content}
												<p class="font:14 fg:theme-text-secondary line-clamp:3">
													{plot.content}
												</p>
											{/if}
											<div class="flex gap:8">
												<button class={`flex:1 ${actionButtonClass()}`} onclick={() => openEditModal(plot)}>
													編集
												</button>
												<button class={actionButtonClass('danger')} onclick={() => handleDelete(plot.id)}>
													削除
												</button>
											</div>
											{#if status !== 'revised'}
												<button
													class={`w:full ${actionButtonClass('success')}`}
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
									{:else}
										<p class="fg:theme-text-secondary text-align:center py:24 font:14">
											まだプロットがありません
										</p>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="flex flex-direction:column gap:16">
						{#each plots as plot (plot.id)}
							<Card
								oncontextmenu={(e) => handlePlotContextMenu(e, plot)}
								class="flex flex-direction:column gap:16"
							>
								<div class="flex gap:16">
									<div
										class="w:4 r:2 flex-shrink:0 bg:theme-border"
										style="background-color: {plot.color}"
									></div>
									<div class="flex:1">
										<div class="flex justify-content:space-between align-items:start mb:12">
											<div>
												<div class="flex align-items:center gap:8 mb:8">
													<span class="px:12 py:6 r:6 bg:theme-background b:1px|solid|theme-border font:14 fg:theme-text-secondary">
														{typeLabels[plot.type]}
													</span>
													<span class={`px:12 py:6 r:6 font:14 ${statusGroups[plot.status].badgeClass}`}>
														{statusGroups[plot.status].label}
													</span>
												</div>
												<h3 class="font:20 font-weight:600 fg:theme-text">{plot.title}</h3>
											</div>
											<div class="flex gap:8">
												<button class={actionButtonClass()} onclick={() => openEditModal(plot)}>編集</button>
												<button class={actionButtonClass('danger')} onclick={() => handleDelete(plot.id)}>削除</button>
											</div>
										</div>
										{#if plot.content}
											<p class="fg:theme-text font:16 white-space:pre-wrap">{plot.content}</p>
										{/if}
									</div>
								</div>
								</Card>
							{/each}
					</div>
				{/if}

				{#if plots.length === 0 && !isLoading}
					<div class="flex flex-direction:column align-items:center justify-content:center h:400 gap:16">
						<p class="fg:theme-text-secondary font:18">プロットがまだありません</p>
						<Button class="px:20 py:12 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:10 font:14" onclick={openCreateModal}>
							最初のプロットを作成
						</Button>
					</div>
				{/if}
			</div>
		</main>
	</div>
</div>

<!-- 新規作成モーダル -->
<Modal bind:isOpen={showCreateModal} title="新規プロット作成">
	{#snippet children()}
		<div class="flex flex-direction:column gap:16">
			<Input label="タイトル" bind:value={formData.title} placeholder="プロット名を入力" />

			<div>
				<label for="type-select" class="block mb:8 font:14 font:semibold">種類</label>
				<select
					id="type-select"
					bind:value={formData.type}
					class={`w:full ${fieldBaseClass}`}
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
					class={`w:full ${fieldBaseClass}`}
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
			<Button variant="ghost" class={actionButtonClass('secondary')} onclick={() => (showCreateModal = false)}>キャンセル</Button>
			<Button class="px:20 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8 font:14" onclick={handleCreate} disabled={!formData.title.trim()}>
				作成
			</Button>
		</div>
	{/snippet}
</Modal>

<!-- 編集モーダル -->
<Modal bind:isOpen={showEditModal} title="プロット編集">
	{#snippet children()}
		<div class="flex flex-direction:column gap:16">
			<Input label="タイトル" bind:value={formData.title} placeholder="プロット名を入力" />

			<div>
				<label for="edit-type-select" class="block mb:8 font:14 font:semibold">種類</label>
				<select
					id="edit-type-select"
					bind:value={formData.type}
					class={`w:full ${fieldBaseClass}`}
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
					class={`w:full ${fieldBaseClass}`}
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
					class={`${textareaBaseClass} min-h:200 resize:vertical`}
					placeholder="プロットの詳細を入力..."
				></textarea>
			</div>

			<div>
				<label for="edit-color" class="block mb:8 font:14 font:semibold">カラー</label>
				<input
					id="edit-color"
					type="color"
					bind:value={formData.color}
					class="w:full h:48 b:1|solid|theme-border bg:theme-background r:8 cursor:pointer"
				/>
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button variant="ghost" class={actionButtonClass('secondary')} onclick={() => (showEditModal = false)}>キャンセル</Button>
			<Button class="px:20 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8 font:14" onclick={handleUpdate} disabled={!formData.title.trim()}>
				更新
			</Button>
		</div>
	{/snippet}
</Modal>

<!-- コンテキストメニュー -->
<ContextMenu
	visible={contextMenu.visible}
	x={contextMenu.x}
	y={contextMenu.y}
	items={contextMenu.items}
	onClose={() => contextMenu.visible = false}
/>

<style>
	.line-clamp\:3 {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
