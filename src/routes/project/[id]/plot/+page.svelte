<script lang="ts">
	import AiToggle from '$lib/components/desktop/AiToggle.svelte';
	import { toast, confirmDialog } from '$lib/stores/toast.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { plotsDB } from '$lib/db';
	import { queueChange, queueChanges } from '$lib/services/sync.service';
	import { filterReadOnlyMenu, isReadOnlyProject } from '$lib/utils/readOnly';
	import { sortByOrder } from '$lib/utils/ordering';
	import { ALL_PLOTS, applyPlotChanges, planPlotMove } from '$lib/utils/plotOrdering';
	import { formatDate } from '$lib/utils/dateUtils';
	import type { Plot } from '$lib/types';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import MasterDetail from '$lib/components/items/MasterDetail.svelte';
	import ItemDetail from '$lib/components/items/ItemDetail.svelte';
	import { page } from '$app/state';
	import { pageContext } from '$lib/stores/pageContext.svelte';
	import ItemSection from '$lib/components/items/ItemSection.svelte';
	import SortableList from '$lib/components/items/SortableList.svelte';
	import PlotCard from '$lib/components/plot/PlotCard.svelte';
	import { createPlotContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import { onMount, untrack } from 'svelte';
	import { dataChange } from '$lib/stores/dataChange.svelte';

	// 閲覧専用(閲覧権限、またはアクセス権の失効)。編集・追加・削除・並べ替えの入口を出さない。同期層にも安全網がある
	const readOnly = $derived(isReadOnlyProject(currentProjectStore.project?.id));

	const NEW = 'new';
	const STATUSES: Plot['status'][] = ['idea', 'planned', 'written', 'revised'];
	const STATUS_LABELS: Record<Plot['status'], string> = {
		idea: 'アイデア',
		planned: '計画中',
		written: '執筆済み',
		revised: '推敲済み'
	};
	const TYPE_LABELS: Record<Plot['type'], string> = {
		scene: 'シーン',
		chapter: '章',
		arc: 'アーク'
	};
	const statusOptions = STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));
	const typeOptions = (Object.keys(TYPE_LABELS) as Plot['type'][]).map((value) => ({
		value,
		label: TYPE_LABELS[value]
	}));
	const typeFilterOptions = [{ value: 'all', label: 'すべての種類' }, ...typeOptions];
	const statusFilterOptions = [{ value: 'all', label: 'すべての状態' }, ...statusOptions];
	const sortOptions = [
		{ value: 'manual', label: '手動順' },
		{ value: 'updated', label: '更新日が新しい順' }
	];

	type ViewMode = 'board' | 'timeline';
	const VIEW_KEY = 'storift:plot-view';

	let plots = $state<Plot[]>([]);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let viewMode = $state<ViewMode>('board');

	let query = $state('');
	let typeFilter = $state('all');
	let statusFilter = $state('all');
	let sortMode = $state('manual');
	/** スマホでは、種類・並びの選択を畳んでおく(縦の場所を本文に使う) */
	let filtersOpen = $state(false);

	let md = $state<MasterDetail>();
	let wide = $state(true);
	let selectedId = $state<string | null>(null);
	let editing = $state(false);
	let saving = $state(false);
	let wantEdit: string | null = null;

	let form = $state({
		title: '',
		type: 'scene' as Plot['type'],
		status: 'idea' as Plot['status'],
		content: '',
		color: '#33507a'
	});

	const creating = $derived(selectedId === NEW);
	const selectedPlot = $derived(plots.find((p) => p.id === selectedId));

	// 見出し(タイトルバー・スマホの上部バー)に選択中のプロット名を出す
	$effect(() => {
		pageContext.setDetail(
			page.url.pathname,
			creating ? '新規プロット' : (selectedPlot?.title ?? '')
		);
	});

	/** 絞り込み中は一覧の並びが全体の並びと一致しないので、並べ替えを止める */
	const filtering = $derived(
		query.trim() !== '' ||
			typeFilter !== 'all' ||
			(viewMode === 'timeline' && statusFilter !== 'all')
	);
	const canSort = $derived(!readOnly && sortMode === 'manual' && !filtering);

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = plots.filter(
			(p) =>
				(typeFilter === 'all' || p.type === typeFilter) &&
				(viewMode !== 'timeline' || statusFilter === 'all' || p.status === statusFilter) &&
				(!q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q))
		);
		return sortMode === 'updated' ? [...list].sort((a, b) => b.updatedAt - a.updatedAt) : list;
	});

	const columns = $derived(
		STATUSES.map((status) => ({ status, items: visible.filter((p) => p.status === status) }))
	);

	const dirty = $derived.by(() => {
		if (!editing) return false;
		if (creating) return form.title.trim() !== '' || form.content.trim() !== '';
		const p = selectedPlot;
		if (!p) return false;
		return (
			form.title !== p.title ||
			form.type !== p.type ||
			form.status !== p.status ||
			form.content !== p.content ||
			form.color !== p.color
		);
	});

	onMount(() => {
		try {
			const saved = localStorage.getItem(VIEW_KEY);
			if (saved === 'board' || saved === 'timeline') viewMode = saved;
		} catch {
			// ストレージが使えない環境
		}
		void loadPlots();
	});

	function setView(mode: ViewMode) {
		viewMode = mode;
		try {
			localStorage.setItem(VIEW_KEY, mode);
		} catch {
			// ストレージが使えない環境
		}
	}

	const refreshPlots = async () => {
		if (!currentProjectStore.project) return;
		plots = await plotsDB.getByProjectId(currentProjectStore.project.id);
	};

	// AI など画面の外で書き換わったら、読み直す(読み込み表示は出さない)
	let seenRevision = dataChange.revision('plots');
	$effect(() => {
		const revision = dataChange.revision('plots');
		if (revision === seenRevision) return;
		seenRevision = revision;
		untrack(() => void refreshPlots());
	});

	const loadPlots = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		loadError = null;
		try {
			plots = await plotsDB.getByProjectId(currentProjectStore.project.id);
		} catch (error) {
			console.error('Failed to load plots:', error);
			loadError = 'プロットを読み込めませんでした';
		} finally {
			isLoading = false;
		}
	};

	/* ---------- 選択と編集 ---------- */

	function resetForm(status: Plot['status'] = 'idea') {
		form = { title: '', type: 'scene', status, content: '', color: '#33507a' };
	}

	function loadForm(p: Plot) {
		form = { title: p.title, type: p.type, status: p.status, content: p.content, color: p.color };
	}

	// 選択が変わったら、閲覧ビューに戻す(新規は編集フォーム。「編集」から開いた場合はそのまま編集)
	$effect(() => {
		const id = selectedId;
		untrack(() => {
			if (id === NEW) {
				editing = true;
				return;
			}
			if (id !== null && id === wantEdit) {
				const p = plots.find((x) => x.id === id);
				if (p) {
					loadForm(p);
					editing = true;
					wantEdit = null;
					return;
				}
			}
			editing = false;
		});
	});

	const guard = {
		dirty: () => dirty,
		confirm: () =>
			confirmDialog({
				title: '未保存の変更',
				message: '保存していない変更があります。破棄して移動しますか?',
				confirmText: '破棄して移動',
				danger: true
			})
	};

	async function openPlot(id: string) {
		await md?.open(id);
	}

	async function startCreate(status: Plot['status'] = 'idea') {
		if (readOnly) return;
		if (creating) {
			form.status = status;
			return;
		}
		resetForm(status);
		await md?.open(NEW);
	}

	async function startEdit(p: Plot) {
		if (readOnly) {
			await openPlot(p.id);
			return;
		}
		if (selectedId === p.id) {
			loadForm(p);
			editing = true;
			return;
		}
		wantEdit = p.id;
		if (!(await md?.open(p.id))) wantEdit = null;
	}

	async function cancelEdit() {
		if (dirty && !(await guard.confirm())) return;
		if (creating) {
			await md?.close();
			return;
		}
		editing = false;
	}

	async function handleSave() {
		if (readOnly || saving) return;
		const project = currentProjectStore.project;
		if (!project || !form.title.trim()) return;
		saving = true;
		try {
			if (creating) {
				const plot = await plotsDB.create({
					projectId: project.id,
					title: form.title.trim(),
					type: form.type,
					status: form.status
				});
				await plotsDB.update(plot.id, { content: form.content, color: form.color });
				await queueChange('plots', plot.id, 'create');
				await refreshPlots();
				md?.replace(plot.id);
			} else if (selectedPlot) {
				const id = selectedPlot.id;
				await plotsDB.update(id, {
					title: form.title.trim(),
					type: form.type,
					content: form.content,
					color: form.color
				});
				// 状態が変わったら、移した先の列の末尾に置く(order と status を同じ更新で書く)
				if (form.status !== selectedPlot.status) {
					await plotsDB.moveTo(id, Number.MAX_SAFE_INTEGER, form.status);
				}
				await queueChange('plots', id, 'update');
				await refreshPlots();
				editing = false;
			}
		} catch (error) {
			console.error('Failed to save plot:', error);
			toast.error('プロットの保存に失敗しました');
		} finally {
			saving = false;
		}
	}

	async function handleDelete(p: Plot) {
		if (readOnly) return;
		if (!(await confirmDialog({ message: `「${p.title}」を削除しますか?`, danger: true }))) return;
		await plotsDB.delete(p.id);
		await queueChange('plots', p.id, 'delete');
		if (selectedId === p.id) {
			editing = false;
			md?.replace(null);
		}
		await refreshPlots();
	}

	async function handleDuplicate(p: Plot) {
		if (readOnly || !currentProjectStore.project) return;
		try {
			const copy = await plotsDB.create({
				projectId: currentProjectStore.project.id,
				title: `${p.title} (コピー)`,
				type: p.type,
				status: p.status
			});
			await plotsDB.update(copy.id, { content: p.content, color: p.color });
			await queueChange('plots', copy.id, 'create');
			// 元のプロットのすぐ後ろに置く
			const column = plots.filter((x) => x.status === p.status);
			const written = await plotsDB.moveTo(
				copy.id,
				column.findIndex((x) => x.id === p.id) + 1,
				p.status
			);
			if (written.length)
				await queueChanges(written.map((id) => ({ type: 'plots', id, action: 'update' })));
			await refreshPlots();
		} catch (error) {
			console.error('Failed to duplicate plot:', error);
			toast.error('プロットの複製に失敗しました');
		}
	}

	/* ---------- 並べ替え・状態の変更 ---------- */

	async function persistMoves(ids: string[]) {
		if (ids.length) await queueChanges(ids.map((id) => ({ type: 'plots', id, action: 'update' })));
	}

	/** 状態を変えたことを知らせ、すぐ元に戻せるようにする(確認ダイアログの代わり) */
	function announceStatus(before: Plot, status: Plot['status']) {
		toast.info(`「${before.title}」を「${STATUS_LABELS[status]}」に変更しました`, {
			action: {
				label: '元に戻す',
				onClick: () => void restorePlot(before)
			}
		});
	}

	async function restorePlot(before: Plot) {
		if (readOnly) return;
		try {
			await plotsDB.update(before.id, { status: before.status, order: before.order });
			await persistMoves([before.id]);
		} catch (error) {
			console.error('Failed to restore plot:', error);
			toast.error('元に戻せませんでした');
		} finally {
			await refreshPlots();
		}
	}

	/** ドラッグ・キーボード・移動ボタンでの並べ替え。listKey は移動先の列(ボード)。タイムラインでは空 */
	async function handleMove(id: string, toIndex: number, listKey: string) {
		if (!canSort) return;
		const before = plots.find((p) => p.id === id);
		if (!before) return;
		const group = viewMode === 'timeline' ? ALL_PLOTS : (listKey as Plot['status']);
		const changes = planPlotMove(plots, id, toIndex, group);
		if (changes.length === 0) return;
		const previous = plots;
		// 先に画面へ反映する(保存を待たずに、置いた場所に収まって見えるように)
		plots = sortByOrder(applyPlotChanges(plots, changes));
		try {
			await persistMoves(await plotsDB.moveTo(id, toIndex, group));
			const moved = changes.find((c) => c.id === id)?.changes.status;
			if (moved && moved !== before.status) announceStatus(before, moved);
		} catch (error) {
			console.error('Failed to move plot:', error);
			plots = previous;
			toast.error('並べ替えに失敗しました');
		} finally {
			await refreshPlots();
		}
	}

	/** 状態を選び直す(メニュー・詳細から)。移した先の列の末尾に置く */
	async function handleStatusChange(plot: Plot, status: Plot['status']) {
		if (readOnly || plot.status === status) return;
		const before = plots.find((p) => p.id === plot.id) ?? plot;
		const changes = planPlotMove(plots, plot.id, Number.MAX_SAFE_INTEGER, status);
		const previous = plots;
		plots = sortByOrder(applyPlotChanges(plots, changes));
		try {
			await persistMoves(await plotsDB.moveTo(plot.id, Number.MAX_SAFE_INTEGER, status));
			announceStatus(before, status);
		} catch (error) {
			console.error('Failed to update plot status:', error);
			plots = previous;
			toast.error('ステータスの更新に失敗しました');
		} finally {
			await refreshPlots();
		}
	}

	/* ---------- 右クリックメニュー ---------- */

	let contextMenu = $state<{ visible: boolean; x: number; y: number; items: ContextMenuItem[] }>({
		visible: false,
		x: 0,
		y: 0,
		items: []
	});

	function handlePlotContextMenu(e: MouseEvent, plot: Plot) {
		e.preventDefault();
		e.stopPropagation();
		const menuItems = createPlotContextMenu({
			onEdit: () => void startEdit(plot),
			onDuplicate: () => void handleDuplicate(plot),
			onDelete: () => void handleDelete(plot)
		});
		const items = readOnly ? filterReadOnlyMenu(menuItems) : menuItems;
		if (items.length === 0) return;
		contextMenu = { visible: true, x: e.clientX, y: e.clientY, items };
	}

	function clearFilters() {
		query = '';
		typeFilter = 'all';
		statusFilter = 'all';
	}
</script>

{#snippet card(
	p: Plot,
	variant: 'board' | 'timeline',
	ctx: import('$lib/components/items/SortableList.svelte').ItemContext,
	numberLabel?: number
)}
	<PlotCard
		plot={p}
		{variant}
		selected={selectedId === p.id}
		{readOnly}
		number={numberLabel}
		last={variant === 'timeline' && ctx.index === ctx.count - 1}
		handle={canSort && variant === 'board' ? ctx.handle : undefined}
		typeLabel={TYPE_LABELS[p.type]}
		statusLabel={STATUS_LABELS[p.status]}
		{statusOptions}
		sortable={canSort}
		canMoveUp={ctx.canMoveUp}
		canMoveDown={ctx.canMoveDown}
		onopen={() => void openPlot(p.id)}
		onstatus={(s) => void handleStatusChange(p, s)}
		onmoveup={ctx.moveUp}
		onmovedown={ctx.moveDown}
		onduplicate={() => void handleDuplicate(p)}
		ondelete={() => void handleDelete(p)}
		oncontextmenu={(e) => handlePlotContextMenu(e, p)}
	/>
{/snippet}

<div class="plot-page" class:detail-full={selectedId !== null && !wide}>
	<header class="page-head">
		<div class="heading">
			<h1>プロット</h1>
			{#if !isLoading && plots.length > 0}<span class="total">{plots.length} 件</span>{/if}
		</div>
		<div class="head-actions">
			<AiToggle />
			<div class="seg" role="group" aria-label="表示の切り替え" data-tour="plot-view-toggle">
				<button type="button" aria-pressed={viewMode === 'board'} onclick={() => setView('board')}>
					<Icon name="layout-columns" class="ico" />ボード
				</button>
				<button
					type="button"
					aria-pressed={viewMode === 'timeline'}
					onclick={() => setView('timeline')}
				>
					<Icon name="timeline-event" class="ico" />タイムライン
				</button>
			</div>
			<Button disabled={readOnly} onclick={() => void startCreate()} data-testid="plot-new">
				<Icon name="plus" class="ico" />新規プロット
			</Button>
		</div>
	</header>

	{#if plots.length > 0 || isLoading}
		<div class="toolbar">
			<input
				class="search"
				type="search"
				placeholder="タイトル・内容で検索"
				aria-label="プロットを検索"
				bind:value={query}
			/>
			<button
				type="button"
				class="filter-toggle"
				aria-expanded={filtersOpen}
				aria-controls="plot-filters"
				aria-label="絞り込みと並び順"
				class:active={filtersOpen || typeFilter !== 'all' || sortMode !== 'manual'}
				onclick={() => (filtersOpen = !filtersOpen)}
			>
				<Icon name="adjustments" class="ico" />
			</button>
			<div class="filters" id="plot-filters" class:open={filtersOpen}>
				<Select options={typeFilterOptions} bind:value={typeFilter} aria-label="種類で絞り込み" />
				{#if viewMode === 'timeline'}
					<Select
						options={statusFilterOptions}
						bind:value={statusFilter}
						aria-label="状態で絞り込み"
					/>
				{/if}
				<Select options={sortOptions} bind:value={sortMode} aria-label="並び順" />
			</div>
			{#if !readOnly && !canSort && plots.length > 1}
				<p class="hint" role="note">並べ替えは、絞り込みを外して「手動順」にすると使えます</p>
			{/if}
		</div>
	{/if}

	<div class="main">
		<MasterDetail
			bind:this={md}
			bind:selectedId
			bind:wide
			ready={!isLoading}
			exists={(id) => id === NEW || plots.some((p) => p.id === id)}
			listLayout="fill"
			wideMin={960}
			detailTitle={creating ? '新規プロット' : (selectedPlot?.title ?? 'プロット')}
			{guard}
		>
			{#snippet list()}
				{#if isLoading}
					<div class="board skeleton" aria-busy="true" aria-label="読み込み中">
						{#each STATUSES as s (s)}
							<div class="col">
								<div class="sk sk-head"></div>
								<div class="sk sk-card"></div>
								<div class="sk sk-card"></div>
							</div>
						{/each}
					</div>
				{:else if loadError}
					<div class="state" role="alert">
						<p>{loadError}</p>
						<Button variant="secondary" onclick={() => void loadPlots()}>再読み込み</Button>
					</div>
				{:else if plots.length === 0}
					<div class="state empty">
						<p class="state-title">プロットはまだありません</p>
						{#if readOnly}
							<p class="state-text">この作品のプロットは、閲覧のみできます。</p>
						{:else}
							<p class="state-text">
								章やシーンの流れ、思いついたアイデアをカードにして、「アイデア」から「推敲済み」まで状態ごとに整理できます。
							</p>
							<Button onclick={() => void startCreate()}>
								<Icon name="plus" class="ico" />最初のプロットを作成
							</Button>
						{/if}
					</div>
				{:else if visible.length === 0}
					<div class="state">
						<p class="state-title">条件に合うプロットがありません</p>
						<Button variant="secondary" onclick={clearFilters}>絞り込みを外す</Button>
					</div>
				{:else if viewMode === 'board'}
					<div class="board" data-testid="plot-board">
						{#each columns as col (col.status)}
							<section
								class="col"
								data-testid="plot-column"
								data-status={col.status}
								aria-label="{STATUS_LABELS[col.status]}の列"
							>
								<header class="col-head">
									<h2>{STATUS_LABELS[col.status]}</h2>
									<span class="count" aria-label="{col.items.length} 件">{col.items.length}</span>
									<span class="spacer"></span>
									{#if !readOnly}
										<button
											type="button"
											class="add"
											aria-label="{STATUS_LABELS[col.status]}にプロットを追加"
											onclick={() => void startCreate(col.status)}
										>
											<Icon name="plus" class="ico" />
										</button>
									{/if}
								</header>
								<div class="col-body scroll-stable">
									<SortableList
										items={col.items}
										disabled={!canSort}
										listKey={col.status}
										group="plot-board"
										label="{STATUS_LABELS[col.status]}のプロット"
										inlineHandle={false}
										class="col-list"
										onmove={handleMove}
									>
										{#snippet item(p, ctx)}
											{@render card(p, 'board', ctx)}
										{/snippet}
									</SortableList>
								</div>
							</section>
						{/each}
					</div>
				{:else}
					<div class="timeline scroll-stable" data-testid="plot-timeline">
						<div class="timeline-inner">
							<SortableList
								items={visible}
								disabled={!canSort}
								listKey=""
								label="プロットのタイムライン"
								onmove={handleMove}
							>
								{#snippet item(p, ctx)}
									{@render card(p, 'timeline', ctx, ctx.index + 1)}
								{/snippet}
							</SortableList>
						</div>
					</div>
				{/if}
			{/snippet}

			{#snippet detail()}
				{#if creating || selectedPlot}
					<ItemDetail
						heading={creating ? form.title : (selectedPlot?.title ?? '')}
						{editing}
						{creating}
						{readOnly}
						canSave={form.title.trim() !== ''}
						{saving}
						onedit={() => selectedPlot && void startEdit(selectedPlot)}
						onsave={() => void handleSave()}
						oncancel={() => void cancelEdit()}
						ondelete={selectedPlot ? () => void handleDelete(selectedPlot) : undefined}
					>
						{#snippet badges()}
							{#if selectedPlot}
								<span class="tag">{TYPE_LABELS[selectedPlot.type]}</span>
								{#if readOnly}
									<span class="tag status">{STATUS_LABELS[selectedPlot.status]}</span>
								{:else}
									<Select
										size="sm"
										options={statusOptions}
										value={selectedPlot.status}
										aria-label="状態を変更"
										onchange={(v) =>
											selectedPlot && void handleStatusChange(selectedPlot, v as Plot['status'])}
									/>
								{/if}
							{/if}
						{/snippet}
						{#snippet body()}
							{#if selectedPlot}
								<ItemSection
									title="内容"
									text={selectedPlot.content}
									emptyText="本文はまだありません。「編集」から書き始められます。"
								/>
							{/if}
						{/snippet}
						{#snippet footnote()}
							{#if selectedPlot}
								<span class="selectable">
									更新 {formatDate(selectedPlot.updatedAt)} ・ 作成 {formatDate(
										selectedPlot.createdAt
									)}
								</span>
							{/if}
						{/snippet}
						{#snippet fields()}
							<div class="field">
								<label for="plot-title">タイトル</label>
								<input
									id="plot-title"
									type="text"
									bind:value={form.title}
									placeholder="プロット名を入力"
									maxlength="200"
								/>
							</div>
							<div class="field-row">
								<div class="field">
									<label for="plot-type">種類</label>
									<Select id="plot-type" options={typeOptions} bind:value={form.type} />
								</div>
								<div class="field">
									<label for="plot-status">状態</label>
									<Select id="plot-status" options={statusOptions} bind:value={form.status} />
								</div>
							</div>
							<div class="field">
								<label for="plot-content">内容</label>
								<textarea
									id="plot-content"
									bind:value={form.content}
									rows="10"
									placeholder="プロットの詳細を入力"
								></textarea>
							</div>
							<div class="field">
								<label for="plot-color">カラー</label>
								<input id="plot-color" type="color" bind:value={form.color} class="color" />
							</div>
						{/snippet}
					</ItemDetail>
				{/if}
			{/snippet}
		</MasterDetail>
	</div>
</div>

<ContextMenu
	visible={contextMenu.visible}
	x={contextMenu.x}
	y={contextMenu.y}
	items={contextMenu.items}
	onClose={() => (contextMenu.visible = false)}
/>

<style>
	.plot-page {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		background: var(--color-background);
		color: var(--color-text);
	}

	.page-head {
		position: relative;
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 16px;
		padding: 20px 24px 12px;
	}

	.heading {
		display: flex;
		align-items: baseline;
		gap: 12px;
		min-width: 0;
	}

	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.total {
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.head-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.head-actions :global(.ico),
	.col-head :global(.ico),
	.seg :global(.ico),
	.state :global(.ico) {
		display: inline-flex;
		flex: none;
		width: 16px;
		height: 16px;
	}

	.head-actions :global(.ico svg),
	.col-head :global(.ico svg),
	.seg :global(.ico svg),
	.state :global(.ico svg) {
		width: 100%;
		height: 100%;
	}

	/* 表示の切り替え(ボード / タイムライン) */
	.seg {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
	}

	.seg button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 13px;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.seg button:hover {
		color: var(--color-text);
	}

	.seg button[aria-pressed='true'] {
		background: var(--color-background);
		color: var(--color-primary);
		box-shadow: 0 0 0 1px var(--color-border);
	}

	.toolbar {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 12px;
		padding: 0 24px 14px;
	}

	.search {
		flex: 0 1 18rem;
		min-width: 10rem;
		height: 36px;
		padding: 0 12px;
		font-size: 13.5px;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		min-width: 0;
	}

	.filters :global(.select) {
		width: auto;
		min-width: 9.5rem;
	}

	.filter-toggle {
		display: none;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.filter-toggle.active {
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
		background: var(--selected);
		color: var(--color-primary);
	}

	.filter-toggle :global(.ico) {
		display: inline-flex;
		width: 18px;
		height: 18px;
	}

	.filter-toggle :global(.ico svg) {
		width: 100%;
		height: 100%;
	}

	.hint {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* 狭いとき、詳細は全画面。上の見出しと検索は隠す */
	.plot-page.detail-full .page-head,
	.plot-page.detail-full .toolbar {
		display: none;
	}

	.plot-page.detail-full .main {
		border-top: 0;
	}

	.main {
		flex: 1;
		min-height: 0;
		border-top: 1px solid var(--color-border);
	}

	/* ボード: 状態ごとの列を横に並べる。列は十分な幅を保ち、はみ出す分は横にスクロールする */
	.board {
		display: flex;
		flex: 1;
		align-items: stretch;
		gap: 16px;
		min-height: 0;
		padding: 16px 24px 20px;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x proximity;
		scroll-padding-inline: 24px;
	}

	.col {
		display: flex;
		flex: 0 0 auto;
		flex-direction: column;
		box-sizing: border-box;
		width: clamp(280px, 22vw, 340px);
		min-width: 280px;
		max-width: 340px;
		min-height: 0;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-surface) 55%, var(--color-background));
		scroll-snap-align: start;
	}

	.col-head {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		padding: 10px 10px 6px 14px;
	}

	.col-head h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.count {
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		box-sizing: border-box;
		border-radius: 10px;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 12px;
		line-height: 20px;
		text-align: center;
	}

	.spacer {
		flex: 1;
	}

	.add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.add:hover {
		background: var(--hover);
		color: var(--color-primary);
	}

	.col-body {
		flex: 1;
		min-height: 0;
		padding: 4px 10px 12px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.col-body :global(.sortable) {
		min-height: 64px;
		--sortable-gap: 10px;
	}

	/* ドラッグ中は、横スクロールのスナップを止める(自動スクロールと喧嘩しないように) */
	:global(html.sortable-dragging) .board {
		scroll-snap-type: none;
	}

	/* タイムライン */
	.timeline {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.timeline-inner {
		max-width: 52rem;
		margin: 0 auto;
		padding: 20px 24px 40px;
	}

	.timeline-inner :global(.sortable) {
		--sortable-gap: 12px;
	}

	/* 空・エラー・絞り込み結果なし */
	.state {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 48px 24px;
		color: var(--color-text-secondary);
		text-align: center;
	}

	.state p {
		margin: 0;
	}

	.state-title {
		font-size: 17px;
		font-weight: 600;
		color: var(--color-text);
	}

	.state-text {
		max-width: 28rem;
		font-size: 14px;
		line-height: 1.8;
	}

	/* 読み込み中 */
	.skeleton {
		pointer-events: none;
	}

	.sk {
		border-radius: 10px;
		background: var(--color-surface);
		animation: pulse 1.4s ease-in-out infinite;
	}

	.sk-head {
		height: 20px;
		margin: 14px 14px 8px;
		width: 40%;
	}

	.sk-card {
		height: 96px;
		margin: 10px;
	}

	@keyframes pulse {
		50% {
			opacity: 0.5;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
		}
	}

	/* 詳細(閲覧のバッジ・編集フォーム) */
	.tag {
		display: inline-flex;
		align-items: center;
		height: 24px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 7px;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 12.5px;
	}

	.tag.status {
		border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
		color: var(--color-primary);
	}

	.field {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.field label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.field input[type='text'],
	.field textarea {
		width: 100%;
		box-sizing: border-box;
		font-size: 16px;
	}

	.field textarea {
		min-height: 14rem;
		line-height: 1.8;
		resize: vertical;
	}

	.field-row {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
	}

	.field-row .field {
		flex: 1 1 10rem;
	}

	.color {
		width: 4rem;
		height: 36px;
		padding: 2px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		cursor: pointer;
	}

	@media (max-width: 768px) {
		.page-head {
			padding: 12px 16px 8px;
		}

		/* 見出しは上のヘッダーに出ているので、ここでは読み上げ用だけにする */
		.heading {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}

		.head-actions {
			width: 100%;
		}

		.seg {
			flex: 1;
		}

		.seg button {
			flex: 1;
			justify-content: center;
			padding: 0 8px;
		}

		.toolbar {
			padding: 0 16px 10px;
		}

		.search {
			flex: 1 1 0;
			min-width: 0;
			height: 44px;
		}

		.filter-toggle {
			display: inline-flex;
		}

		.filters {
			display: none;
			flex: 1 1 100%;
		}

		.filters.open {
			display: flex;
		}

		.filters :global(.select) {
			min-width: 0;
		}

		.filters > :global(*) {
			flex: 1 1 8rem;
		}

		/* 1 列が画面幅の約 85%。次の列がのぞくので、横にスクロールできると分かる */
		.board {
			padding: 12px 16px 16px;
			scroll-snap-type: x mandatory;
			scroll-padding-inline: 16px;
		}

		.col {
			width: 85%;
			max-width: 340px;
		}

		.timeline-inner {
			padding: 14px 16px 32px;
		}
	}
</style>
