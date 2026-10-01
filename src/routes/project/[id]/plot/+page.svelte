<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { plotsDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Plot } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirmDialog } from '$lib/stores/confirm.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
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
	import { createPlotContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import { onMount } from 'svelte';

	type ViewMode = 'board' | 'timeline';
	type TypeFilter = Plot['type'] | 'all';

	let plots = $state<Plot[]>([]);
	let isLoading = $state(true);
	let viewMode = $state<ViewMode>('board');
	let searchQuery = $state('');
	let typeFilter = $state<TypeFilter>('all');

	// 作成・編集で共用するモーダル（editingPlot が null なら新規作成）
	let showFormModal = $state(false);
	let editingPlot = $state<Plot | null>(null);
	let isSaving = $state(false);

	let contextMenu = $state<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
	}>({ visible: false, x: 0, y: 0, items: [] });

	let formData = $state({
		title: '',
		type: 'scene' as Plot['type'],
		status: 'idea' as Plot['status'],
		content: '',
		color: '#3b82f6'
	});

	const statusOrder: Plot['status'][] = ['idea', 'planned', 'written', 'revised'];

	const statusGroups: Record<Plot['status'], { label: string }> = {
		idea: { label: 'アイデア' },
		planned: { label: '計画中' },
		written: { label: '執筆済み' },
		revised: { label: '推敲済み' }
	};

	const typeLabels: Record<Plot['type'], string> = {
		scene: 'シーン',
		chapter: '章',
		arc: 'アーク'
	};

	const viewOptions: { value: ViewMode; label: string }[] = [
		{ value: 'board', label: 'ボード' },
		{ value: 'timeline', label: 'タイムライン' }
	];

	let typeOptions = $derived([
		{ value: 'all' as TypeFilter, label: 'すべて', count: plots.length },
		...(Object.keys(typeLabels) as Plot['type'][]).map((t) => ({
			value: t as TypeFilter,
			label: typeLabels[t],
			count: plots.filter((p) => p.type === t).length
		}))
	]);

	let filteredPlots = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return plots.filter((p) => {
			const matchType = typeFilter === 'all' || p.type === typeFilter;
			const matchSearch =
				!q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q);
			return matchType && matchSearch;
		});
	});

	let isFiltering = $derived(searchQuery.trim() !== '' || typeFilter !== 'all');

	onMount(async () => {
		await loadPlots();
	});

	const loadPlots = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			plots = await plotsDB.getByProjectId(currentProjectStore.project.id);
		} catch (error) {
			console.error('Failed to load plots:', error);
			toast.error('プロットの読み込みに失敗しました');
		} finally {
			isLoading = false;
		}
	};

	function getPlotsByStatus(status: Plot['status']) {
		return filteredPlots.filter((p) => p.status === status);
	}

	const openCreateModal = () => {
		editingPlot = null;
		formData = { title: '', type: 'scene', status: 'idea', content: '', color: '#3b82f6' };
		showFormModal = true;
	};

	function openEditModal(plot: Plot) {
		editingPlot = plot;
		formData = {
			title: plot.title,
			type: plot.type,
			status: plot.status,
			content: plot.content,
			color: plot.color
		};
		showFormModal = true;
	}

	const handleSave = async () => {
		if (!currentProjectStore.project || !formData.title.trim() || isSaving) return;
		isSaving = true;
		const title = formData.title.trim();
		try {
			if (editingPlot) {
				await plotsDB.update(editingPlot.id, {
					title,
					type: formData.type,
					status: formData.status,
					content: formData.content,
					color: formData.color
				});
				await queueChange('plots', editingPlot.id, 'update');
				toast.success(`プロット「${title}」を更新しました`);
			} else {
				const plot = await plotsDB.create({
					projectId: currentProjectStore.project.id,
					title,
					type: formData.type,
					status: formData.status
				});
				await plotsDB.update(plot.id, { content: formData.content, color: formData.color });
				await queueChange('plots', plot.id, 'create');
				toast.success(`プロット「${title}」を作成しました`);
			}
			showFormModal = false;
			editingPlot = null;
			await loadPlots();
		} catch (error) {
			console.error('Failed to save plot:', error);
			toast.error(editingPlot ? 'プロットの更新に失敗しました' : 'プロットの作成に失敗しました');
		} finally {
			isSaving = false;
		}
	};

	function handleDelete(plot: Plot) {
		// 取り消し用に削除前のレコードを保持する
		const snapshot = $state.snapshot(plot) as Plot;
		return deleteWithUndo({
			targetLabel: `プロット「${snapshot.title}」`,
			remove: async () => {
				await plotsDB.delete(snapshot.id);
				await queueChange('plots', snapshot.id, 'delete');
				await loadPlots();
			},
			restore: async () => {
				await plotsDB.addFromRemote(snapshot);
				await queueChange('plots', snapshot.id, 'create');
				await loadPlots();
			}
		});
	}

	async function changeStatus(plot: Plot, newStatus: Plot['status'], silent = false) {
		const previousStatus = plot.status;
		try {
			await plotsDB.update(plot.id, { status: newStatus });
			await queueChange('plots', plot.id, 'update');
			await loadPlots();
			if (silent) return;
			toast.success(`「${plot.title}」を${statusGroups[newStatus].label}にしました`, {
				action: {
					label: '元に戻す',
					onclick: () => changeStatus(plot, previousStatus, true)
				}
			});
		} catch (error) {
			console.error('Failed to update plot status:', error);
			toast.error('ステータスの更新に失敗しました');
			await loadPlots();
		}
	}

	// 「次へ」: 誤操作でステータスが進まないよう確認する (C-12)
	async function advanceStatus(plot: Plot) {
		const next = statusOrder[statusOrder.indexOf(plot.status) + 1];
		if (!next) return;
		const ok = await confirmDialog({
			title: 'ステータスを進める',
			message: `「${plot.title}」を「${statusGroups[plot.status].label}」から「${statusGroups[next].label}」に進めますか?`,
			confirmText: '進める'
		});
		if (ok) await changeStatus(plot, next);
	}

	function handlePlotContextMenu(e: MouseEvent, plot: Plot) {
		e.preventDefault();
		e.stopPropagation();
		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items: createPlotContextMenu({
				onEdit: () => openEditModal(plot),
				onDuplicate: () => handleDuplicatePlot(plot),
				onDelete: () => handleDelete(plot)
			})
		};
	}

	async function handleDuplicatePlot(plot: Plot) {
		if (!currentProjectStore.project) return;
		try {
			const newPlot = await plotsDB.create({
				projectId: currentProjectStore.project.id,
				title: `${plot.title} (コピー)`,
				type: plot.type,
				status: plot.status
			});
			await plotsDB.update(newPlot.id, { content: plot.content, color: plot.color });
			await queueChange('plots', newPlot.id, 'create');
			await loadPlots();
			toast.success('プロットを複製しました');
		} catch (error) {
			console.error('Failed to duplicate plot:', error);
			toast.error('プロットの複製に失敗しました');
		}
	}
</script>

<svelte:head>
	<title>プロット | Storift</title>
</svelte:head>

<div class="flex flex-direction:column w:100% h:100% bg:theme-background fg:theme-text">
	<PageHeader title="プロット" description="作品の構成を計画・管理します">
		{#snippet actions()}
			<button
				type="button"
				class={buttonClass('primary')}
				onclick={openCreateModal}
				disabled={!currentProjectStore.project}
			>
				+ 新規プロット
			</button>
		{/snippet}
	</PageHeader>

	<main class="flex-grow:1 overflow-y:auto">
		<div class="max-w:1280 mx:auto w:100% px:24 py:24 flex flex-direction:column gap:24">
			<div class="flex flex-wrap:wrap align-items:center gap:12">
				<SearchBox
					bind:value={searchQuery}
					placeholder="タイトル・内容で検索..."
					ariaLabel="プロットを検索"
				/>
				<SegmentedControl
					options={typeOptions}
					bind:value={typeFilter}
					ariaLabel="種類で絞り込み"
				/>
				<SegmentedControl options={viewOptions} bind:value={viewMode} ariaLabel="表示切り替え" />
			</div>

			{#if isLoading}
				<div class="flex flex-direction:column gap:16" aria-busy="true">
					{#each [1, 2, 3] as n (n)}
						<div class="h:96 bg:theme-surface b:1|solid|theme-border r:8 animate:pulse"></div>
					{/each}
				</div>
			{:else if plots.length === 0}
				<EmptyState
					message="プロットがまだありません"
					actionLabel="最初のプロットを作成"
					onaction={openCreateModal}
				/>
			{:else if isFiltering && filteredPlots.length === 0}
				<EmptyState message="条件に一致するプロットがありません" />
			{:else if viewMode === 'board'}
				<div
					class="grid gap:16 grid-template-columns:repeat(1,minmax(0,1fr)) md:grid-template-columns:repeat(2,minmax(0,1fr)) xl:grid-template-columns:repeat(4,minmax(0,1fr))"
				>
					{#each statusOrder as status (status)}
						{@const items = getPlotsByStatus(status)}
						<section
							aria-label={statusGroups[status].label}
							class="flex flex-direction:column gap:12"
						>
							<div class="flex align-items:center justify-content:space-between">
								<h2 class="font:16 font-weight:600 m:0 fg:theme-text">
									{statusGroups[status].label}
								</h2>
								<span class={badgeClass}>{items.length}</span>
							</div>
							<div
								class="flex flex-direction:column gap:12 min-h:120 p:12 bg:theme-surface b:1|solid|theme-border r:8"
							>
								{#each items as plot (plot.id)}
									<Card
										padding="sm"
										class="flex flex-direction:column gap:12"
										oncontextmenu={(e) => handlePlotContextMenu(e, plot)}
									>
										<div class="flex align-items:center gap:8">
											<span
												class="w:12 h:12 r:full flex-shrink:0"
												style="background-color: {plot.color}"
												aria-hidden="true"
											></span>
											<span class={badgeClass}>{typeLabels[plot.type]}</span>
										</div>
										<button
											type="button"
											class="font:16 font-weight:600 text-align:left bg:transparent b:none p:0 cursor:pointer fg:theme-text fg:theme-primary:hover"
											onclick={() => openEditModal(plot)}
										>
											{plot.title}
										</button>
										{#if plot.content}
											<p
												class="font:14 fg:theme-text-secondary m:0"
												style="display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;"
											>
												{plot.content}
											</p>
										{/if}
										<div class="flex gap:8">
											<button
												type="button"
												class={buttonClass('secondary', 'flex:1')}
												onclick={() => openEditModal(plot)}
											>
												編集
											</button>
											<button
												type="button"
												class={buttonClass('danger')}
												aria-label={`プロット「${plot.title}」を削除`}
												onclick={() => handleDelete(plot)}
											>
												削除
											</button>
										</div>
										{#if status !== 'revised'}
											<button
												type="button"
												class={buttonClass('secondary', 'w:full')}
												aria-label={`「${plot.title}」を次のステータスへ進める`}
												onclick={() => advanceStatus(plot)}
											>
												次へ →
											</button>
										{/if}
									</Card>
								{:else}
									<p class="fg:theme-text-secondary text-align:center py:16 font:14 m:0">
										プロットがありません
									</p>
								{/each}
							</div>
						</section>
					{/each}
				</div>
			{:else}
				<div class="flex flex-direction:column gap:12">
					{#each filteredPlots as plot (plot.id)}
						<Card oncontextmenu={(e) => handlePlotContextMenu(e, plot)} class="flex gap:16">
							<div
								class="w:4 r:2 flex-shrink:0"
								style="background-color: {plot.color}"
								aria-hidden="true"
							></div>
							<div class="flex:1 flex flex-direction:column gap:12 min-w:0">
								<div
									class="flex flex-wrap:wrap justify-content:space-between align-items:start gap:12"
								>
									<div class="flex flex-direction:column gap:8">
										<div class="flex align-items:center gap:8">
											<span class={badgeClass}>{typeLabels[plot.type]}</span>
											<span class={badgeClass}>{statusGroups[plot.status].label}</span>
										</div>
										<h3 class="font:20 font-weight:600 fg:theme-text m:0">{plot.title}</h3>
									</div>
									<div class="flex gap:8">
										<button
											type="button"
											class={buttonClass('secondary')}
											onclick={() => openEditModal(plot)}
										>
											編集
										</button>
										<button
											type="button"
											class={buttonClass('danger')}
											aria-label={`プロット「${plot.title}」を削除`}
											onclick={() => handleDelete(plot)}
										>
											削除
										</button>
									</div>
								</div>
								{#if plot.content}
									<p class="fg:theme-text font:16 white-space:pre-wrap m:0">{plot.content}</p>
								{/if}
							</div>
						</Card>
					{/each}
				</div>
			{/if}
		</div>
	</main>
</div>

<Modal bind:isOpen={showFormModal} title={editingPlot ? 'プロット編集' : '新規プロット作成'}>
	<div class="flex flex-direction:column gap:16">
		<FormField label="タイトル" required>
			{#snippet children(id)}
				<input
					{id}
					type="text"
					bind:value={formData.title}
					placeholder="プロット名を入力"
					class={fieldClass}
				/>
			{/snippet}
		</FormField>

		<div class="grid grid-template-columns:repeat(2,minmax(0,1fr)) gap:16">
			<FormField label="種類">
				{#snippet children(id)}
					<select {id} bind:value={formData.type} class={fieldClass}>
						{#each Object.entries(typeLabels) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				{/snippet}
			</FormField>

			<FormField label="ステータス">
				{#snippet children(id)}
					<select {id} bind:value={formData.status} class={fieldClass}>
						{#each statusOrder as value (value)}
							<option {value}>{statusGroups[value].label}</option>
						{/each}
					</select>
				{/snippet}
			</FormField>
		</div>

		<FormField label="内容">
			{#snippet children(id)}
				<textarea
					{id}
					bind:value={formData.content}
					class="{textareaClass} min-h:160"
					placeholder="プロットの詳細を入力..."
				></textarea>
			{/snippet}
		</FormField>

		<FormField label="カラー">
			{#snippet children(id)}
				<input
					{id}
					type="color"
					bind:value={formData.color}
					class="w:full h:44 b:1|solid|theme-border bg:theme-background r:8 cursor:pointer"
				/>
			{/snippet}
		</FormField>
	</div>

	{#snippet footer()}
		<ModalActions
			submitLabel={editingPlot ? '更新' : '作成'}
			submitDisabled={!formData.title.trim() || isSaving}
			onsubmit={handleSave}
			oncancel={() => (showFormModal = false)}
		/>
	{/snippet}
</Modal>

<ContextMenu
	visible={contextMenu.visible}
	x={contextMenu.x}
	y={contextMenu.y}
	items={contextMenu.items}
	onClose={() => (contextMenu.visible = false)}
/>
