<script lang="ts">
	import AiToggle from '$lib/components/desktop/AiToggle.svelte';
	import { toast, confirmDialog } from '$lib/stores/toast.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { worldbuildingDB } from '$lib/db';
	import { queueChange, queueChanges } from '$lib/services/sync.service';
	import { isReadOnlyProject } from '$lib/utils/readOnly';
	import { sortByOrder } from '$lib/utils/ordering';
	import {
		WORLD_CATEGORIES,
		WORLD_META,
		applyWorldChanges,
		canReorderWorld,
		categoryCounts,
		firstLine,
		groupByCategory,
		planWorldMove,
		tagCounts,
		visibleWorld,
		type WorldCategory,
		type WorldFilter,
		type WorldSort
	} from '$lib/utils/worldList';
	import { formatDate } from '$lib/utils/dateUtils';
	import type { Worldbuilding } from '$lib/types';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import MasterDetail from '$lib/components/items/MasterDetail.svelte';
	import ItemDetail from '$lib/components/items/ItemDetail.svelte';
	import ItemSection from '$lib/components/items/ItemSection.svelte';
	import ItemRow, { type RowMenuItem } from '$lib/components/items/ItemRow.svelte';
	import ItemsPageHead from '$lib/components/items/ItemsPageHead.svelte';
	import ItemPlaceholder from '$lib/components/items/ItemPlaceholder.svelte';
	import IconBadge from '$lib/components/items/IconBadge.svelte';
	import SortableList, { type ItemContext } from '$lib/components/items/SortableList.svelte';
	import { onMount, untrack } from 'svelte';
	import { dataChange } from '$lib/stores/dataChange.svelte';

	// 閲覧専用(閲覧権限、またはアクセス権の失効)。編集・追加・削除・並べ替えの入口を出さない。同期層にも安全網がある
	const readOnly = $derived(isReadOnlyProject(currentProjectStore.project?.id));

	const NEW = 'new';

	const sortOptions = [
		{ value: 'manual', label: '手動順' },
		{ value: 'title', label: 'タイトル順' },
		{ value: 'updated', label: '更新日が新しい順' }
	];
	const categoryOptions = WORLD_CATEGORIES.map((value) => ({
		value,
		label: WORLD_META[value].label
	}));
	const chipDefs: { value: WorldFilter; label: string }[] = [
		{ value: 'all', label: 'すべて' },
		...WORLD_CATEGORIES.map((value) => ({ value, label: WORLD_META[value].label }))
	];

	interface FormState {
		title: string;
		category: WorldCategory;
		content: string;
		tags: string[];
		/** 追加前のタグの入力 */
		tagInput: string;
	}

	let items = $state<Worldbuilding[]>([]);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);

	let activeCategory = $state<WorldFilter>('all');
	let query = $state('');
	let tagFilter = $state('');
	let sortMode = $state('manual');

	let md = $state<MasterDetail>();
	let wide = $state(true);
	let selectedId = $state<string | null>(null);
	let editing = $state(false);
	let saving = $state(false);
	let wantEdit: string | null = null;

	function emptyForm(category: WorldCategory = 'term'): FormState {
		return { title: '', category, content: '', tags: [], tagInput: '' };
	}

	function formOf(w: Worldbuilding): FormState {
		return {
			title: w.title,
			category: w.category,
			content: w.content,
			tags: [...w.tags],
			tagInput: ''
		};
	}

	let form = $state<FormState>(emptyForm());
	/** 新規作成の既定の分類(分類を選んでいるときは、その分類) */
	let newCategory = $state<WorldCategory>('term');

	const creating = $derived(selectedId === NEW);
	const selectedItem = $derived(items.find((w) => w.id === selectedId));

	const tags = $derived(tagCounts(items));
	/** 消えたタグで絞り込んだままにしない */
	const activeTag = $derived(tags.some((t) => t.tag === tagFilter) ? tagFilter : '');
	const tagOptions = $derived([
		{ value: '', label: 'すべてのタグ' },
		...tags.map((t) => ({ value: t.tag, label: `#${t.tag} (${t.count})` }))
	]);
	const counts = $derived(categoryCounts(items, query, activeTag));

	const visible = $derived(
		visibleWorld(items, {
			query,
			category: activeCategory,
			tag: activeTag,
			sort: sortMode as WorldSort
		})
	);
	/** 「すべて」の手動順は、分類ごとの節に分けて並べる */
	const grouped = $derived(
		activeCategory === 'all' && sortMode === 'manual' ? groupByCategory(visible) : null
	);
	/** 絞り込み・並び替え中は、一覧の並びが分類の手動順と一致しないので、並べ替えを止める */
	const canSort = $derived(
		canReorderWorld({ readOnly, sort: sortMode as WorldSort, query, tag: activeTag })
	);
	const filtering = $derived(query.trim() !== '' || activeTag !== '' || activeCategory !== 'all');

	const dirty = $derived.by(() => {
		if (!editing) return false;
		const base = creating ? emptyForm(newCategory) : selectedItem ? formOf(selectedItem) : null;
		return base !== null && JSON.stringify(form) !== JSON.stringify(base);
	});
	onMount(() => {
		void load();
	});

	const refresh = async () => {
		if (!currentProjectStore.project) return;
		items = await worldbuildingDB.getByProjectId(currentProjectStore.project.id);
	};

	// AI など画面の外で書き換わったら、読み直す(読み込み表示は出さない)
	let seenRevision = dataChange.revision('worldbuilding');
	$effect(() => {
		const revision = dataChange.revision('worldbuilding');
		if (revision === seenRevision) return;
		seenRevision = revision;
		untrack(() => void refresh());
	});

	const load = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		loadError = null;
		try {
			items = await worldbuildingDB.getByProjectId(currentProjectStore.project.id);
		} catch (error) {
			console.error('Failed to load worldbuilding:', error);
			loadError = '設定資料を読み込めませんでした';
		} finally {
			isLoading = false;
		}
	};

	/* ---------- 選択と編集 ---------- */

	// 選択が変わったら、閲覧ビューに戻す(新規は編集フォーム。「編集」から開いた場合はそのまま編集)
	$effect(() => {
		const id = selectedId;
		untrack(() => {
			if (id === NEW) {
				editing = true;
				return;
			}
			if (id !== null && id === wantEdit) {
				const w = items.find((x) => x.id === id);
				if (w) {
					form = formOf(w);
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

	async function openItem(id: string) {
		await md?.open(id);
	}

	async function startCreate() {
		if (readOnly) return;
		if (creating) return;
		newCategory = activeCategory === 'all' ? 'term' : activeCategory;
		form = emptyForm(newCategory);
		await md?.open(NEW);
	}

	async function startEdit(w: Worldbuilding) {
		if (readOnly) {
			await openItem(w.id);
			return;
		}
		if (selectedId === w.id) {
			form = formOf(w);
			editing = true;
			return;
		}
		wantEdit = w.id;
		if (!(await md?.open(w.id))) wantEdit = null;
	}

	async function cancelEdit() {
		if (dirty && !(await guard.confirm())) return;
		if (creating) {
			await md?.close();
			return;
		}
		editing = false;
	}

	/* ---------- タグ ---------- */

	function addTag() {
		const t = form.tagInput.trim().replace(/^#/, '');
		if (t && !form.tags.includes(t)) form.tags = [...form.tags, t];
		form.tagInput = '';
	}

	function removeTag(tag: string) {
		form.tags = form.tags.filter((t) => t !== tag);
	}

	function onTagKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.isComposing) return;
		e.preventDefault();
		addTag();
	}

	/** 詳細のタグを押したら、そのタグで一覧を絞り込む(狭い画面では一覧へ戻る) */
	async function filterByTag(tag: string) {
		tagFilter = tag;
		if (!wide) await md?.close();
	}

	/* ---------- 保存・削除・複製 ---------- */

	async function handleSave() {
		if (readOnly || saving) return;
		const project = currentProjectStore.project;
		if (!project || !form.title.trim()) return;
		addTag(); // 入力したままのタグも保存する
		saving = true;
		try {
			const tagList = [...form.tags];
			if (creating) {
				const created = await worldbuildingDB.create({
					projectId: project.id,
					category: form.category,
					title: form.title.trim()
				});
				await worldbuildingDB.update(created.id, { content: form.content, tags: tagList });
				await queueChange('worldbuilding', created.id, 'create');
				await refresh();
				md?.replace(created.id);
			} else if (selectedItem) {
				const id = selectedItem.id;
				await worldbuildingDB.update(id, {
					title: form.title.trim(),
					content: form.content,
					tags: tagList
				});
				// 分類が変わったら、移した先の分類の末尾に置く(分類と order を同じ更新で書く)
				if (form.category !== selectedItem.category) {
					await worldbuildingDB.moveTo(id, Number.MAX_SAFE_INTEGER, form.category);
				}
				await queueChange('worldbuilding', id, 'update');
				await refresh();
				editing = false;
			}
		} catch (error) {
			console.error('Failed to save worldbuilding:', error);
			toast.error('設定資料の保存に失敗しました');
		} finally {
			saving = false;
		}
	}

	async function handleDelete(w: Worldbuilding) {
		if (readOnly) return;
		if (!(await confirmDialog({ message: `「${w.title}」を削除しますか?`, danger: true }))) return;
		await worldbuildingDB.delete(w.id);
		await queueChange('worldbuilding', w.id, 'delete');
		if (selectedId === w.id) {
			editing = false;
			md?.replace(null);
		}
		await refresh();
	}

	async function handleDuplicate(w: Worldbuilding) {
		if (readOnly || !currentProjectStore.project) return;
		try {
			const copy = await worldbuildingDB.create({
				projectId: currentProjectStore.project.id,
				category: w.category,
				title: `${w.title} (コピー)`
			});
			await worldbuildingDB.update(copy.id, { content: w.content, tags: [...w.tags] });
			await queueChange('worldbuilding', copy.id, 'create');
			// 元の資料のすぐ後ろに置く
			const siblings = items.filter((x) => x.category === w.category);
			const written = await worldbuildingDB.moveTo(
				copy.id,
				siblings.findIndex((x) => x.id === w.id) + 1
			);
			if (written.length)
				await queueChanges(written.map((id) => ({ type: 'worldbuilding', id, action: 'update' })));
			await refresh();
		} catch (error) {
			console.error('Failed to duplicate worldbuilding:', error);
			toast.error('設定資料の複製に失敗しました');
		}
	}

	/* ---------- 並べ替え ---------- */

	/** ドラッグ・キーボード・移動ボタンでの並べ替え。listKey は並べる分類 */
	async function handleMove(id: string, toIndex: number, listKey: string) {
		if (!canSort) return;
		const category = (listKey || items.find((w) => w.id === id)?.category) as WorldCategory;
		if (!WORLD_CATEGORIES.includes(category)) return;
		const changes = planWorldMove(items, id, toIndex, category);
		if (changes.length === 0) return;
		const previous = items;
		// 先に画面へ反映する(保存を待たずに、置いた場所に収まって見えるように)
		items = sortByOrder(applyWorldChanges(items, changes));
		try {
			const written = await worldbuildingDB.moveTo(id, toIndex, category);
			if (written.length)
				await queueChanges(
					written.map((w) => ({ type: 'worldbuilding', id: w, action: 'update' }))
				);
		} catch (error) {
			console.error('Failed to move worldbuilding:', error);
			items = previous;
			toast.error('並べ替えに失敗しました');
		} finally {
			await refresh();
		}
	}

	function rowMenu(w: Worldbuilding, ctx: ItemContext): RowMenuItem[] {
		if (readOnly) return [];
		const menu: RowMenuItem[] = [
			{ label: '編集', icon: 'pencil', onselect: () => void startEdit(w) }
		];
		if (canSort) {
			menu.push(
				{ label: '上へ', icon: 'arrow-up', disabled: !ctx.canMoveUp, onselect: ctx.moveUp },
				{ label: '下へ', icon: 'arrow-down', disabled: !ctx.canMoveDown, onselect: ctx.moveDown }
			);
		}
		menu.push(
			{ label: '複製', icon: 'files', onselect: () => void handleDuplicate(w) },
			{ label: '削除', icon: 'trash', danger: true, onselect: () => void handleDelete(w) }
		);
		return menu;
	}

	function subtitleOf(w: Worldbuilding): string {
		return firstLine(w.content) || w.tags.map((t) => `#${t}`).join(' ');
	}

	function clearFilters() {
		query = '';
		tagFilter = '';
		activeCategory = 'all';
	}
</script>

{#snippet emptyState()}
	<ItemPlaceholder
		icon="book-2"
		shape="square"
		title="設定資料はまだありません"
		text={readOnly
			? 'この作品の設定資料は、閲覧のみできます。'
			: '用語・場所・年表など、物語の世界観の設定をまとめておけます。タグを付けて探すこともできます。'}
	>
		{#if !readOnly}
			<Button onclick={() => void startCreate()}>
				<Icon name="plus" class="ico" />最初の資料を作成
			</Button>
		{/if}
	</ItemPlaceholder>
{/snippet}

{#snippet rows(list: Worldbuilding[], listKey: string, label: string)}
	<SortableList
		items={list}
		disabled={!canSort}
		{listKey}
		{label}
		titleOf={(w) => w.title}
		inlineHandle={false}
		onmove={handleMove}
	>
		{#snippet item(w, ctx)}
			<ItemRow
				id={w.id}
				title={w.title}
				subtitle={subtitleOf(w)}
				selected={selectedId === w.id}
				testid="world-row"
				handle={canSort ? ctx.handle : undefined}
				menuItems={rowMenu(w, ctx)}
				onopen={() => void openItem(w.id)}
			>
				{#snippet lead()}
					<IconBadge
						size={44}
						shape="square"
						tone={WORLD_META[w.category].tone}
						icon={WORLD_META[w.category].icon}
					/>
				{/snippet}
			</ItemRow>
		{/snippet}
	</SortableList>
{/snippet}

<div class="world-page" class:detail-full={selectedId !== null && !wide}>
	<ItemsPageHead
		title="設定資料"
		total={!isLoading && items.length > 0 ? `${items.length} 件` : undefined}
	>
		<AiToggle />
		{#if !readOnly}
			<Button
				class="new"
				onclick={() => void startCreate()}
				disabled={!currentProjectStore.project}
				data-testid="world-new"
			>
				<Icon name="plus" class="ico" />新規資料
			</Button>
		{/if}
	</ItemsPageHead>

	<div class="main">
		<MasterDetail
			bind:this={md}
			bind:selectedId
			bind:wide
			ready={!isLoading}
			exists={(id) => id === NEW || items.some((w) => w.id === id)}
			listLayout="sidebar"
			storageKey={currentProjectStore.project
				? `worldbuilding:${currentProjectStore.project.id}`
				: undefined}
			detailTitle={creating ? '新規資料' : (selectedItem?.title ?? '設定資料')}
			{guard}
		>
			{#snippet listHeader()}
				<div class="chips" data-tour="worldbuilding-categories" role="group" aria-label="分類">
					{#each chipDefs as chip (chip.value)}
						<button
							type="button"
							class="chip"
							aria-pressed={activeCategory === chip.value}
							data-category={chip.value}
							onclick={() => (activeCategory = chip.value)}
						>
							{chip.label}<span class="count" aria-label="{counts[chip.value]} 件"
								>{counts[chip.value]}</span
							>
						</button>
					{/each}
				</div>
				{#if items.length > 0}
					<div class="list-tools">
						<input
							class="search"
							type="search"
							placeholder="タイトル・タグ・内容で検索"
							aria-label="設定資料を検索"
							bind:value={query}
						/>
						{#if tags.length > 0}
							<Select
								class="tool-select"
								options={tagOptions}
								bind:value={tagFilter}
								aria-label="タグで絞り込み"
							/>
						{/if}
						<Select
							class="tool-select"
							options={sortOptions}
							bind:value={sortMode}
							aria-label="並び順"
						/>
					</div>
					{#if !readOnly && !canSort && items.length > 1}
						<p class="hint" role="note">
							並べ替えは、検索とタグの絞り込みを外して「手動順」にすると使えます
						</p>
					{/if}
				{/if}
			{/snippet}

			{#snippet list()}
				{#if isLoading}
					<div class="sk-list" aria-busy="true" aria-label="読み込み中">
						{#each [0, 1, 2, 3] as n (n)}
							<div class="sk-row">
								<span class="sk sk-icon"></span><span class="sk sk-text"></span>
							</div>
						{/each}
					</div>
				{:else if loadError}
					<ItemPlaceholder title={loadError} role="alert">
						<Button variant="secondary" onclick={() => void load()}>再読み込み</Button>
					</ItemPlaceholder>
				{:else if items.length === 0}
					{#if wide}
						<p class="side-note">まだ設定資料がありません</p>
					{:else}
						{@render emptyState()}
					{/if}
				{:else if visible.length === 0}
					<ItemPlaceholder title="条件に合う設定資料がありません">
						{#if filtering}
							<Button variant="secondary" onclick={clearFilters}>絞り込みを外す</Button>
						{/if}
					</ItemPlaceholder>
				{:else}
					<div class="list-scroll scroll-stable" data-testid="world-list">
						{#if grouped}
							{#each grouped as group (group.category)}
								<section
									class="group"
									data-testid="world-group"
									data-category={group.category}
									aria-label="{WORLD_META[group.category].label}の資料"
								>
									<h2 class="group-head">
										{WORLD_META[group.category].label}
										<span class="group-count">{group.items.length}</span>
									</h2>
									{@render rows(
										group.items,
										group.category,
										`${WORLD_META[group.category].label}の資料`
									)}
								</section>
							{/each}
						{:else}
							{@render rows(
								visible,
								activeCategory === 'all' ? '' : activeCategory,
								activeCategory === 'all'
									? '設定資料の一覧'
									: `${WORLD_META[activeCategory].label}の資料`
							)}
						{/if}
					</div>
				{/if}
			{/snippet}

			{#snippet placeholder()}
				{#if !isLoading && items.length === 0 && !loadError}
					{@render emptyState()}
				{:else}
					<ItemPlaceholder
						icon="book-2"
						shape="square"
						title="資料を選んでください"
						text="左の一覧から選ぶと、内容の全文がここに表示されます。"
					/>
				{/if}
			{/snippet}

			{#snippet detail()}
				{#if creating || selectedItem}
					<ItemDetail
						heading={creating ? form.title : (selectedItem?.title ?? '')}
						{editing}
						{creating}
						{readOnly}
						canSave={form.title.trim() !== ''}
						{saving}
						onedit={() => selectedItem && void startEdit(selectedItem)}
						onsave={() => void handleSave()}
						oncancel={() => void cancelEdit()}
						ondelete={selectedItem ? () => void handleDelete(selectedItem) : undefined}
					>
						{#snippet lead()}
							{@const category = editing
								? form.category
								: (selectedItem?.category ?? form.category)}
							<IconBadge
								size={52}
								shape="square"
								tone={WORLD_META[category].tone}
								icon={WORLD_META[category].icon}
							/>
						{/snippet}
						{#snippet badges()}
							{#if selectedItem}
								<span class="tag category" data-testid="world-category-badge">
									{WORLD_META[selectedItem.category].label}
								</span>
								{#each selectedItem.tags as tag (tag)}
									<button
										type="button"
										class="tag tag-btn"
										data-testid="world-tag"
										aria-label="タグ {tag} で絞り込む"
										onclick={() => void filterByTag(tag)}
									>
										#{tag}
									</button>
								{/each}
							{/if}
						{/snippet}
						{#snippet body()}
							{#if selectedItem}
								<ItemSection
									title="内容"
									text={selectedItem.content}
									emptyText="内容はまだありません。{readOnly
										? ''
										: '「編集」から書き始められます。'}"
								/>
							{/if}
						{/snippet}
						{#snippet footnote()}
							{#if selectedItem}
								<span class="selectable">
									更新 {formatDate(selectedItem.updatedAt)} ・ 作成 {formatDate(
										selectedItem.createdAt
									)}
								</span>
							{/if}
						{/snippet}
						{#snippet fields()}
							<div class="field">
								<label for="world-title">タイトル</label>
								<input
									id="world-title"
									type="text"
									bind:value={form.title}
									placeholder="用語名や場所名など"
									maxlength="200"
								/>
							</div>
							<div class="field">
								<label for="world-category">分類</label>
								<Select id="world-category" options={categoryOptions} bind:value={form.category} />
								{#if !creating && selectedItem && form.category !== selectedItem.category}
									<span class="note">保存すると、移動先の分類の末尾に入ります</span>
								{/if}
							</div>
							<div class="field">
								<label for="world-content">内容</label>
								<textarea
									id="world-content"
									bind:value={form.content}
									rows="10"
									placeholder="詳細な説明"
								></textarea>
							</div>
							<div class="field">
								<label for="world-tag-input">タグ</label>
								<div class="tag-add">
									<input
										id="world-tag-input"
										type="text"
										bind:value={form.tagInput}
										placeholder="タグを入力して Enter"
										onkeydown={onTagKeydown}
									/>
									<Button variant="secondary" onclick={addTag} disabled={!form.tagInput.trim()}>
										追加
									</Button>
								</div>
								{#if form.tags.length > 0}
									<ul class="tag-list">
										{#each form.tags as tag (tag)}
											<li class="tag tag-edit">
												#{tag}
												<button
													type="button"
													class="tag-remove"
													aria-label="タグ {tag} を削除"
													onclick={() => removeTag(tag)}
												>
													<Icon name="x" class="ico" />
												</button>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/snippet}
					</ItemDetail>
				{/if}
			{/snippet}
		</MasterDetail>
	</div>
</div>

<style>
	.world-page {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		background: var(--color-background);
		color: var(--color-text);
	}

	/* 狭いとき、詳細は全画面。上の見出しは隠す */
	.world-page.detail-full :global(.page-head) {
		display: none;
	}

	.main {
		flex: 1;
		min-height: 0;
		border-top: 1px solid var(--color-border);
	}

	.world-page.detail-full .main {
		border-top: 0;
	}

	/* 分類のチップ */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 12px 12px 4px;
	}

	.chip {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 4px;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 16px;
		background: var(--color-background);
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 13px;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.chip:hover {
		background: var(--hover);
		color: var(--color-text);
	}

	.chip:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.chip[aria-pressed='true'] {
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
		background: var(--selected);
		color: var(--color-primary);
		font-weight: 600;
	}

	.count {
		font-size: 12px;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		opacity: 0.85;
	}

	/* 検索・タグ・並び */
	.list-tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
	}

	.search {
		flex: 1 1 100%;
		min-width: 0;
		height: 36px;
		padding: 0 12px;
		font-size: 13.5px;
	}

	.list-tools :global(.tool-select) {
		flex: 1 1 7rem;
		width: auto;
		min-width: 0;
	}

	.hint {
		margin: 0;
		padding: 0 16px 8px;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.list-scroll {
		flex: 1;
		min-height: 0;
		padding: 4px 8px 16px;
		overflow-y: auto;
		overscroll-behavior: contain;
		--sortable-gap: 2px;
		--row-pad-x: 12px;
	}

	.group + .group {
		margin-top: 12px;
	}

	.group-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 8px 12px 4px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	.group-count {
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.side-note {
		margin: 0;
		padding: 24px 16px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	/* 読み込み中 */
	.sk-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 8px;
		pointer-events: none;
	}

	.sk-row {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 60px;
		padding: 0 12px;
	}

	.sk {
		background: var(--color-surface);
		animation: pulse 1.4s ease-in-out infinite;
	}

	.sk-icon {
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 11px;
	}

	.sk-text {
		flex: 1;
		height: 14px;
		max-width: 60%;
		border-radius: 7px;
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

	/* 詳細のバッジ・タグ */
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

	.tag.category {
		border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
		color: var(--color-primary);
	}

	.tag-btn {
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.tag-btn:hover {
		background: var(--hover);
		color: var(--color-primary);
	}

	.tag-btn:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	/* 編集フォーム */
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

	.note {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.tag-add {
		display: flex;
		gap: 8px;
	}

	.tag-add input {
		flex: 1;
		min-width: 0;
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
	}

	.tag-edit {
		gap: 4px;
		height: 28px;
		padding-right: 4px;
	}

	.tag-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.tag-remove:hover {
		background: var(--hover);
		color: var(--color-error);
	}

	.world-page :global(.ico) {
		display: inline-flex;
		flex: none;
		width: 16px;
		height: 16px;
	}

	.world-page :global(.ico svg) {
		width: 100%;
		height: 100%;
	}

	.tag-remove :global(.ico) {
		width: 12px;
		height: 12px;
	}

	@media (max-width: 768px) {
		/* 見出しの行は新規作成のボタンだけなので、幅いっぱいに出す */
		.world-page :global(.new) {
			flex: 1;
		}

		/* 分類のチップは横に並べ、はみ出した分は横スクロールにする */
		.chips {
			flex-wrap: nowrap;
			gap: 6px;
			padding: 12px 16px 4px;
			overflow-x: auto;
			scrollbar-width: none;
		}

		.chips::-webkit-scrollbar {
			display: none;
		}

		.chip {
			height: 40px;
			padding: 0 14px;
		}

		.list-tools {
			padding: 8px 16px;
		}

		.search {
			height: 44px;
		}

		.hint {
			padding: 0 16px 8px;
		}

		/* 狭い画面では、行を画面の端まで広げ、中身の左右に 16px の余白を取る */
		.list-scroll {
			padding: 0 0 16px;
			--row-pad-x: 16px;
			--row-radius: 0;
			--sortable-gap: 0;
		}

		.list-scroll :global(.item-row) {
			border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
		}

		.group-head {
			padding: 12px 16px 6px;
		}

		.group + .group {
			margin-top: 0;
		}

		.tag-remove {
			width: 28px;
			height: 28px;
		}
	}

	@media (pointer: coarse) {
		.list-scroll {
			--sortable-handle-size: 44px;
		}
	}
</style>
