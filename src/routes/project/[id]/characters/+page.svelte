<script lang="ts">
	import AiToggle from '$lib/components/desktop/AiToggle.svelte';
	import { toast, confirmDialog } from '$lib/stores/toast.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { charactersDB } from '$lib/db';
	import { queueChange, queueChanges } from '$lib/services/sync.service';
	import { filterReadOnlyMenu, isReadOnlyProject } from '$lib/utils/readOnly';
	import { sortByOrder } from '$lib/utils/ordering';
	import {
		applyOrderUpdates,
		avatarTone,
		canReorderCharacters,
		characterSummary,
		initialOf,
		planCharacterMove,
		visibleCharacters,
		type CharacterSort
	} from '$lib/utils/characterList';
	import { formatDate } from '$lib/utils/dateUtils';
	import type { Character } from '$lib/types';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import RelationCanvas from '$lib/components/relation/RelationCanvas.svelte';
	import MasterDetail from '$lib/components/items/MasterDetail.svelte';
	import ItemDetail from '$lib/components/items/ItemDetail.svelte';
	import ItemSection from '$lib/components/items/ItemSection.svelte';
	import ItemRow, { type RowMenuItem } from '$lib/components/items/ItemRow.svelte';
	import ItemsPageHead from '$lib/components/items/ItemsPageHead.svelte';
	import ItemPlaceholder from '$lib/components/items/ItemPlaceholder.svelte';
	import IconBadge from '$lib/components/items/IconBadge.svelte';
	import SortableList, { type ItemContext } from '$lib/components/items/SortableList.svelte';
	import { createCharacterContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import { onMount, tick, untrack } from 'svelte';
	import { dataChange } from '$lib/stores/dataChange.svelte';

	// 閲覧専用(閲覧権限、またはアクセス権の失効)。編集・追加・削除・並べ替えの入口を出さない。同期層にも安全網がある
	const readOnly = $derived(isReadOnlyProject(currentProjectStore.project?.id));

	const NEW = 'new';
	type ViewMode = 'list' | 'graph';

	const sortOptions = [
		{ value: 'manual', label: '手動順' },
		{ value: 'name', label: '名前順' },
		{ value: 'updated', label: '更新日が新しい順' }
	];

	interface RelationRow {
		/** 入力欄の識別用(並びが変わっても入力中の欄を保つ) */
		key: number;
		characterId: string;
		relation: string;
	}

	interface FormState {
		name: string;
		role: string;
		/** 入力欄の文字列(空なら年齢なし) */
		age: string;
		gender: string;
		appearance: string;
		personality: string;
		background: string;
		relationships: RelationRow[];
	}

	let characters = $state<Character[]>([]);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let viewMode = $state<ViewMode>('list');

	let query = $state('');
	let sortMode = $state('manual');

	let md = $state<MasterDetail>();
	let wide = $state(true);
	let selectedId = $state<string | null>(null);
	let editing = $state(false);
	let saving = $state(false);
	let wantEdit: string | null = null;
	let relationKey = 0;

	function emptyForm(): FormState {
		return {
			name: '',
			role: '',
			age: '',
			gender: '',
			appearance: '',
			personality: '',
			background: '',
			relationships: []
		};
	}

	function formOf(c: Character): FormState {
		return {
			name: c.name,
			role: c.role,
			age: c.age === undefined || c.age === null ? '' : String(c.age),
			gender: c.gender ?? '',
			appearance: c.appearance,
			personality: c.personality,
			background: c.background,
			relationships: c.relationships.map((r) => ({
				key: relationKey++,
				characterId: r.characterId,
				relation: r.relation
			}))
		};
	}

	/** 未保存の判定用。入力欄の識別子(key)は含めない */
	function snapshot(f: FormState): string {
		return JSON.stringify([
			f.name,
			f.role,
			f.age,
			f.gender,
			f.appearance,
			f.personality,
			f.background,
			f.relationships.map((r) => [r.characterId, r.relation])
		]);
	}

	let form = $state<FormState>(emptyForm());

	const creating = $derived(selectedId === NEW);
	const selectedCharacter = $derived(characters.find((c) => c.id === selectedId));

	const visible = $derived(
		visibleCharacters(characters, { query, sort: sortMode as CharacterSort })
	);
	/** 絞り込み・並び替え中は、一覧の並びが全体の手動順と一致しないので、並べ替えを止める */
	const canSort = $derived(
		canReorderCharacters({ readOnly, sort: sortMode as CharacterSort, query })
	);

	const dirty = $derived.by(() => {
		if (!editing) return false;
		const base = creating ? emptyForm() : selectedCharacter ? formOf(selectedCharacter) : null;
		return base !== null && snapshot(form) !== snapshot(base);
	});

	/** 関係の相手に選べる人物(自分以外) */
	const relationTargets = $derived(
		characters
			.filter((c) => c.id !== selectedId)
			.map((c) => ({ value: c.id, label: c.name || '無題' }))
	);

	onMount(() => {
		void loadCharacters();
	});

	const refreshCharacters = async () => {
		if (!currentProjectStore.project) return;
		characters = await charactersDB.getByProjectId(currentProjectStore.project.id);
	};

	// AI など画面の外で書き換わったら、読み直す(読み込み表示は出さない)
	let seenRevision = dataChange.revision('characters');
	$effect(() => {
		const revision = dataChange.revision('characters');
		if (revision === seenRevision) return;
		seenRevision = revision;
		untrack(() => void refreshCharacters());
	});

	const loadCharacters = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		loadError = null;
		try {
			characters = await charactersDB.getByProjectId(currentProjectStore.project.id);
		} catch (error) {
			console.error('Failed to load characters:', error);
			loadError = '人物を読み込めませんでした';
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
				const c = characters.find((x) => x.id === id);
				if (c) {
					form = formOf(c);
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

	async function openCharacter(id: string) {
		await md?.open(id);
	}

	async function startCreate() {
		if (readOnly) return;
		if (viewMode !== 'list') viewMode = 'list';
		await tick();
		if (creating) return;
		form = emptyForm();
		await md?.open(NEW);
	}

	async function startEdit(c: Character) {
		if (readOnly) {
			await openCharacter(c.id);
			return;
		}
		if (selectedId === c.id) {
			form = formOf(c);
			editing = true;
			return;
		}
		wantEdit = c.id;
		if (!(await md?.open(c.id))) wantEdit = null;
	}

	async function cancelEdit() {
		if (dirty && !(await guard.confirm())) return;
		if (creating) {
			await md?.close();
			return;
		}
		editing = false;
	}

	/** 一覧 ⇄ 相関図。編集中の未保存の変更があれば、切り替える前に確認する */
	async function setView(mode: ViewMode) {
		if (mode === viewMode) return;
		if (mode === 'graph') {
			if (dirty && !(await guard.confirm())) return;
			editing = false;
		}
		viewMode = mode;
	}

	/** 相関図の人物を押したら、一覧に戻ってその人物の詳細を開く */
	async function showFromGraph(c: Character) {
		viewMode = 'list';
		await tick();
		await md?.open(c.id);
	}

	function parseAge(text: string): number | undefined {
		const t = text.trim();
		if (!t) return undefined;
		const n = Number(t);
		return Number.isFinite(n) ? n : undefined;
	}

	/** 相手と関係名の両方がある行だけを保存する */
	function completeRelations() {
		return form.relationships
			.filter((r) => r.characterId && r.relation.trim())
			.map((r) => ({ characterId: r.characterId, relation: r.relation.trim() }));
	}

	const incompleteRelations = $derived(
		form.relationships.some((r) => !r.characterId || !r.relation.trim())
	);

	async function handleSave() {
		if (readOnly || saving) return;
		const project = currentProjectStore.project;
		if (!project || !form.name.trim()) return;
		saving = true;
		try {
			const detail = {
				age: parseAge(form.age),
				gender: form.gender.trim(),
				appearance: form.appearance,
				personality: form.personality,
				background: form.background,
				relationships: completeRelations()
			};
			if (creating) {
				const character = await charactersDB.create({
					projectId: project.id,
					name: form.name.trim(),
					role: form.role.trim()
				});
				await charactersDB.update(character.id, detail);
				await queueChange('characters', character.id, 'create');
				await refreshCharacters();
				md?.replace(character.id);
			} else if (selectedCharacter) {
				const id = selectedCharacter.id;
				await charactersDB.update(id, {
					name: form.name.trim(),
					role: form.role.trim(),
					...detail
				});
				await queueChange('characters', id, 'update');
				await refreshCharacters();
				editing = false;
			}
		} catch (error) {
			console.error('Failed to save character:', error);
			toast.error('人物の保存に失敗しました');
		} finally {
			saving = false;
		}
	}

	async function handleDelete(c: Character) {
		if (readOnly) return;
		if (!(await confirmDialog({ message: `「${c.name}」を削除しますか?`, danger: true }))) return;
		await charactersDB.delete(c.id);
		await queueChange('characters', c.id, 'delete');
		if (selectedId === c.id) {
			editing = false;
			md?.replace(null);
		}
		await refreshCharacters();
	}

	async function handleDuplicate(c: Character) {
		if (readOnly || !currentProjectStore.project) return;
		try {
			const copy = await charactersDB.create({
				projectId: currentProjectStore.project.id,
				name: `${c.name} (コピー)`,
				role: c.role
			});
			await charactersDB.update(copy.id, {
				age: c.age,
				gender: c.gender,
				appearance: c.appearance,
				personality: c.personality,
				background: c.background
			});
			await queueChange('characters', copy.id, 'create');
			// 元の人物のすぐ後ろに置く
			const written = await charactersDB.moveTo(
				copy.id,
				characters.findIndex((x) => x.id === c.id) + 1
			);
			if (written.length)
				await queueChanges(written.map((id) => ({ type: 'characters', id, action: 'update' })));
			await refreshCharacters();
		} catch (error) {
			console.error('Failed to duplicate character:', error);
			toast.error('人物の複製に失敗しました');
		}
	}

	/* ---------- 関係の編集 ---------- */

	function addRelation() {
		form.relationships.push({ key: relationKey++, characterId: '', relation: '' });
	}

	function removeRelation(key: number) {
		form.relationships = form.relationships.filter((r) => r.key !== key);
	}

	/** 詳細の「関係」節に出す行(相手が削除済みなら id だけ残る) */
	function relationsOf(c: Character) {
		return c.relationships.map((r) => {
			const target = characters.find((x) => x.id === r.characterId);
			return { relation: r.relation, target };
		});
	}

	/* ---------- 並べ替え ---------- */

	async function handleMove(id: string, toIndex: number) {
		if (!canSort) return;
		const updates = planCharacterMove(characters, id, toIndex);
		if (updates.length === 0) return;
		const previous = characters;
		// 先に画面へ反映する(保存を待たずに、置いた場所に収まって見えるように)
		characters = sortByOrder(applyOrderUpdates(characters, updates));
		try {
			const written = await charactersDB.moveTo(id, toIndex);
			if (written.length)
				await queueChanges(written.map((w) => ({ type: 'characters', id: w, action: 'update' })));
		} catch (error) {
			console.error('Failed to move character:', error);
			characters = previous;
			toast.error('並べ替えに失敗しました');
		} finally {
			await refreshCharacters();
		}
	}

	/* ---------- 右クリックメニュー・行のメニュー ---------- */

	let contextMenu = $state<{ visible: boolean; x: number; y: number; items: ContextMenuItem[] }>({
		visible: false,
		x: 0,
		y: 0,
		items: []
	});

	function handleCharacterContextMenu(e: MouseEvent, character: Character) {
		e.preventDefault();
		e.stopPropagation();
		const menuItems = createCharacterContextMenu({
			onEdit: () => void startEdit(character),
			onDuplicate: () => void handleDuplicate(character),
			onDelete: () => void handleDelete(character)
		});
		const items = readOnly ? filterReadOnlyMenu(menuItems) : menuItems;
		if (items.length === 0) return;
		contextMenu = { visible: true, x: e.clientX, y: e.clientY, items };
	}

	function rowMenu(c: Character, ctx: ItemContext): RowMenuItem[] {
		if (readOnly) return [];
		const items: RowMenuItem[] = [
			{ label: '編集', icon: 'pencil', onselect: () => void startEdit(c) }
		];
		if (canSort) {
			items.push(
				{ label: '上へ', icon: 'arrow-up', disabled: !ctx.canMoveUp, onselect: ctx.moveUp },
				{ label: '下へ', icon: 'arrow-down', disabled: !ctx.canMoveDown, onselect: ctx.moveDown }
			);
		}
		items.push(
			{ label: '複製', icon: 'files', onselect: () => void handleDuplicate(c) },
			{ label: '削除', icon: 'trash', danger: true, onselect: () => void handleDelete(c) }
		);
		return items;
	}

	function clearSearch() {
		query = '';
	}
</script>

{#snippet emptyState()}
	<ItemPlaceholder
		icon="users"
		title="人物はまだいません"
		text={readOnly
			? 'この作品の人物は、閲覧のみできます。'
			: '登場人物の名前や役割、外見・性格・背景、人物どうしの関係をまとめておけます。'}
	>
		{#if !readOnly}
			<Button onclick={() => void startCreate()}>
				<Icon name="plus" class="ico" />最初の人物を作成
			</Button>
		{/if}
	</ItemPlaceholder>
{/snippet}

<div class="chars-page" class:detail-full={viewMode === 'list' && selectedId !== null && !wide}>
	<ItemsPageHead
		title="人物"
		total={!isLoading && characters.length > 0 ? `${characters.length} 人` : undefined}
	>
		<AiToggle />
		<div class="seg" role="group" aria-label="表示の切り替え">
			<button type="button" aria-pressed={viewMode === 'list'} onclick={() => void setView('list')}>
				<Icon name="list" class="ico" />一覧
			</button>
			<button
				type="button"
				aria-pressed={viewMode === 'graph'}
				data-tour="characters-graph-button"
				onclick={() => void setView('graph')}
			>
				<Icon name="users" class="ico" />相関図
			</button>
		</div>
		{#if !readOnly}
			<Button onclick={() => void startCreate()} data-testid="character-new">
				<Icon name="plus" class="ico" />新規人物
			</Button>
		{/if}
	</ItemsPageHead>

	{#if viewMode === 'list'}
		<div class="main">
			<MasterDetail
				bind:this={md}
				bind:selectedId
				bind:wide
				ready={!isLoading}
				exists={(id) => id === NEW || characters.some((c) => c.id === id)}
				listLayout="sidebar"
				storageKey={currentProjectStore.project
					? `characters:${currentProjectStore.project.id}`
					: undefined}
				detailTitle={creating ? '新規人物' : (selectedCharacter?.name ?? '人物')}
				{guard}
			>
				{#snippet listHeader()}
					{#if characters.length > 0}
						<div class="list-tools">
							<input
								class="search"
								type="search"
								placeholder="名前・役割・本文で検索"
								aria-label="人物を検索"
								bind:value={query}
							/>
							<Select
								class="sort"
								options={sortOptions}
								bind:value={sortMode}
								aria-label="並び順"
							/>
						</div>
						{#if !readOnly && !canSort && characters.length > 1}
							<p class="hint" role="note">並べ替えは、検索を外して「手動順」にすると使えます</p>
						{/if}
					{/if}
				{/snippet}

				{#snippet list()}
					{#if isLoading}
						<div class="sk-list" aria-busy="true" aria-label="読み込み中">
							{#each [0, 1, 2, 3] as n (n)}
								<div class="sk-row">
									<span class="sk sk-avatar"></span><span class="sk sk-text"></span>
								</div>
							{/each}
						</div>
					{:else if loadError}
						<ItemPlaceholder title={loadError} role="alert">
							<Button variant="secondary" onclick={() => void loadCharacters()}>再読み込み</Button>
						</ItemPlaceholder>
					{:else if characters.length === 0}
						{#if wide}
							<p class="side-note">まだ人物がいません</p>
						{:else}
							{@render emptyState()}
						{/if}
					{:else if visible.length === 0}
						<ItemPlaceholder title="条件に合う人物がいません">
							<Button variant="secondary" onclick={clearSearch}>検索を外す</Button>
						</ItemPlaceholder>
					{:else}
						<div class="list-scroll scroll-stable" data-testid="character-list">
							<SortableList
								items={visible}
								disabled={!canSort}
								label="人物の一覧"
								titleOf={(c) => c.name}
								inlineHandle={false}
								onmove={handleMove}
							>
								{#snippet item(c, ctx)}
									<ItemRow
										id={c.id}
										title={c.name}
										subtitle={characterSummary(c)}
										selected={selectedId === c.id}
										testid="character-row"
										handle={canSort ? ctx.handle : undefined}
										menuItems={rowMenu(c, ctx)}
										onopen={() => void openCharacter(c.id)}
										oncontextmenu={(e) => handleCharacterContextMenu(e, c)}
									>
										{#snippet lead()}
											<IconBadge
												size={44}
												shape="circle"
												tone={avatarTone(c.id)}
												text={initialOf(c.name)}
											/>
										{/snippet}
									</ItemRow>
								{/snippet}
							</SortableList>
						</div>
					{/if}
				{/snippet}

				{#snippet placeholder()}
					{#if !isLoading && characters.length === 0 && !loadError}
						{@render emptyState()}
					{:else}
						<ItemPlaceholder
							icon="user"
							title="人物を選んでください"
							text="左の一覧から選ぶと、外見・性格・背景・関係の全文がここに表示されます。"
						/>
					{/if}
				{/snippet}

				{#snippet detail()}
					{#if creating || selectedCharacter}
						<ItemDetail
							heading={creating ? form.name : (selectedCharacter?.name ?? '')}
							{editing}
							{creating}
							{readOnly}
							canSave={form.name.trim() !== ''}
							{saving}
							onedit={() => selectedCharacter && void startEdit(selectedCharacter)}
							onsave={() => void handleSave()}
							oncancel={() => void cancelEdit()}
							ondelete={selectedCharacter ? () => void handleDelete(selectedCharacter) : undefined}
						>
							{#snippet lead()}
								{#if selectedCharacter}
									<IconBadge
										size={56}
										shape="circle"
										tone={avatarTone(selectedCharacter.id)}
										text={initialOf(editing ? form.name : selectedCharacter.name)}
									/>
								{:else}
									<IconBadge size={56} shape="circle" icon="user" tone="neutral" />
								{/if}
							{/snippet}
							{#snippet badges()}
								{#if selectedCharacter}
									{@const summary = characterSummary(selectedCharacter)}
									{#if summary}<span class="summary selectable">{summary}</span>{/if}
								{/if}
							{/snippet}
							{#snippet body()}
								{#if selectedCharacter}
									{@const c = selectedCharacter}
									{@const rels = relationsOf(c)}
									{#if !c.appearance.trim() && !c.personality.trim() && !c.background.trim() && rels.length === 0}
										<p class="none">
											外見・性格・背景・関係はまだ入力されていません。{#if !readOnly}「編集」から書き始められます。{/if}
										</p>
									{/if}
									{#if c.appearance.trim()}<ItemSection title="外見" text={c.appearance} />{/if}
									{#if c.personality.trim()}<ItemSection title="性格" text={c.personality} />{/if}
									{#if c.background.trim()}<ItemSection title="背景" text={c.background} />{/if}
									{#if rels.length > 0}
										<ItemSection title="関係">
											<ul class="relations" data-testid="relations">
												{#each rels as rel, i (i)}
													<li class="relation">
														<span class="chip">{rel.relation}</span>
														<Icon name="chevron-right" class="rel-arrow" />
														{#if rel.target}
															{@const target = rel.target}
															<button
																type="button"
																class="rel-link"
																data-testid="relation-link"
																onclick={() => void openCharacter(target.id)}
															>
																<IconBadge
																	size={28}
																	shape="circle"
																	tone={avatarTone(target.id)}
																	text={initialOf(target.name)}
																/>
																<span class="rel-name">{target.name}</span>
															</button>
														{:else}
															<span class="rel-missing">削除された人物</span>
														{/if}
													</li>
												{/each}
											</ul>
										</ItemSection>
									{/if}
								{/if}
							{/snippet}
							{#snippet footnote()}
								{#if selectedCharacter}
									<span class="selectable">
										更新 {formatDate(selectedCharacter.updatedAt)} ・ 作成 {formatDate(
											selectedCharacter.createdAt
										)}
									</span>
								{/if}
							{/snippet}
							{#snippet fields()}
								<div class="field">
									<label for="char-name">名前</label>
									<input
										id="char-name"
										type="text"
										bind:value={form.name}
										placeholder="人物の名前"
										maxlength="100"
									/>
								</div>
								<div class="field-row">
									<div class="field">
										<label for="char-role">役割</label>
										<input
											id="char-role"
											type="text"
											bind:value={form.role}
											placeholder="主人公、ヒロイン、悪役など"
										/>
									</div>
									<div class="field narrow">
										<label for="char-age">年齢</label>
										<input
											id="char-age"
											type="text"
											inputmode="numeric"
											autocomplete="off"
											bind:value={form.age}
											placeholder="年齢"
										/>
									</div>
									<div class="field narrow">
										<label for="char-gender">性別</label>
										<input
											id="char-gender"
											type="text"
											bind:value={form.gender}
											placeholder="性別"
										/>
									</div>
								</div>
								<div class="field">
									<label for="char-appearance">外見</label>
									<textarea
										id="char-appearance"
										bind:value={form.appearance}
										rows="4"
										placeholder="髪型、体格、服装など"
									></textarea>
								</div>
								<div class="field">
									<label for="char-personality">性格</label>
									<textarea
										id="char-personality"
										bind:value={form.personality}
										rows="4"
										placeholder="性格の特徴"
									></textarea>
								</div>
								<div class="field">
									<label for="char-background">背景</label>
									<textarea
										id="char-background"
										bind:value={form.background}
										rows="5"
										placeholder="生い立ち、経歴など"
									></textarea>
								</div>
								<div class="field" role="group" aria-labelledby="char-relations-label">
									<span class="label" id="char-relations-label">関係</span>
									{#if form.relationships.length > 0}
										<ul class="rel-edit">
											{#each form.relationships as row (row.key)}
												<li class="rel-row" data-testid="relation-row">
													<Select
														class="rel-target"
														options={relationTargets}
														bind:value={row.characterId}
														placeholder="相手を選択"
														aria-label="関係の相手"
													/>
													<input
														class="rel-name-input"
														type="text"
														bind:value={row.relation}
														placeholder="関係(例: 親友、ライバル)"
														aria-label="関係の名前"
													/>
													<button
														type="button"
														class="rel-remove"
														aria-label="この関係を削除"
														onclick={() => removeRelation(row.key)}
													>
														<Icon name="trash" class="ico" />
													</button>
												</li>
											{/each}
										</ul>
									{/if}
									<div class="rel-actions">
										<Button
											variant="secondary"
											size="sm"
											disabled={relationTargets.length === 0}
											onclick={addRelation}
										>
											<Icon name="plus" class="ico" />関係を追加
										</Button>
										{#if relationTargets.length === 0}
											<span class="note">関係を結ぶには、ほかの人物が必要です</span>
										{:else if incompleteRelations}
											<span class="note">相手と関係の名前の両方がある行だけが保存されます</span>
										{/if}
									</div>
								</div>
							{/snippet}
						</ItemDetail>
					{/if}
				{/snippet}
			</MasterDetail>
		</div>
	{:else}
		<div class="graph scroll-stable">
			{#if isLoading}
				<p class="graph-note">読み込み中...</p>
			{:else if currentProjectStore.project}
				<RelationCanvas
					{characters}
					projectId={currentProjectStore.project.id}
					onChanged={refreshCharacters}
					onOpenCharacter={(c) => void showFromGraph(c)}
				/>
			{/if}
		</div>
	{/if}
</div>

<ContextMenu
	visible={contextMenu.visible}
	x={contextMenu.x}
	y={contextMenu.y}
	items={contextMenu.items}
	onClose={() => (contextMenu.visible = false)}
/>

<style>
	.chars-page {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		background: var(--color-background);
		color: var(--color-text);
	}

	/* 表示の切り替え(一覧 / 相関図) */
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

	.seg :global(.ico),
	.rel-actions :global(.ico),
	.rel-remove :global(.ico) {
		display: inline-flex;
		flex: none;
		width: 16px;
		height: 16px;
	}

	.seg :global(.ico svg),
	.rel-actions :global(.ico svg),
	.rel-remove :global(.ico svg) {
		width: 100%;
		height: 100%;
	}

	/* 狭いとき、詳細は全画面。上の見出しは隠す */
	.chars-page.detail-full :global(.page-head) {
		display: none;
	}

	.main {
		flex: 1;
		min-height: 0;
		border-top: 1px solid var(--color-border);
	}

	.chars-page.detail-full .main {
		border-top: 0;
	}

	/* 一覧の上の検索と並び */
	.list-tools {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 12px 8px;
	}

	.search {
		flex: 1 1 0;
		min-width: 0;
		height: 36px;
		padding: 0 12px;
		font-size: 13.5px;
	}

	.list-tools :global(.sort) {
		flex: 0 0 auto;
		width: auto;
		min-width: 8.5rem;
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

	.sk-avatar {
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 50%;
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

	/* 詳細(閲覧) */
	.summary {
		font-size: 14px;
		color: var(--color-text-secondary);
	}

	.none {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.8;
		color: var(--color-text-secondary);
	}

	.relations {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.relation {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 4px;
		min-height: 40px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		height: 26px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 13px;
		overflow-wrap: anywhere;
	}

	.relation :global(.rel-arrow) {
		display: inline-flex;
		flex: none;
		width: 16px;
		height: 16px;
		color: var(--color-text-secondary);
	}

	.relation :global(.rel-arrow svg) {
		width: 100%;
		height: 100%;
	}

	.rel-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 10px 0 6px;
		border: 0;
		border-radius: 20px;
		background: transparent;
		color: var(--color-primary);
		font: inherit;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
	}

	.rel-link:hover {
		background: var(--hover);
	}

	.rel-link:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.rel-name {
		overflow-wrap: anywhere;
		text-align: left;
	}

	.rel-missing {
		font-size: 13.5px;
		color: var(--color-text-secondary);
		opacity: 0.8;
	}

	/* 編集フォーム */
	.field {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.field label,
	.field .label {
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
		min-height: 6rem;
		line-height: 1.8;
		resize: vertical;
	}

	.field-row {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
	}

	.field-row .field {
		flex: 2 1 12rem;
	}

	.field-row .field.narrow {
		flex: 1 1 7rem;
	}

	.rel-edit {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rel-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.rel-row :global(.rel-target) {
		flex: 1 1 11rem;
		min-width: 0;
	}

	.rel-name-input {
		flex: 1 1 11rem;
		min-width: 0;
		box-sizing: border-box;
		font-size: 16px;
	}

	.rel-remove {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.rel-remove:hover {
		background: var(--hover);
		color: var(--color-error);
	}

	.rel-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}

	.note {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* 相関図 */
	.graph {
		flex: 1;
		min-height: 0;
		padding: 0 24px 24px;
		overflow-y: auto;
	}

	.graph-note {
		margin: 0;
		padding: 48px 0;
		text-align: center;
		color: var(--color-text-secondary);
	}

	@media (max-width: 768px) {
		.seg {
			flex: 1;
		}

		.seg button {
			flex: 1;
			justify-content: center;
			padding: 0 8px;
		}

		.list-tools {
			padding: 12px 16px 8px;
		}

		.search {
			height: 44px;
		}

		.list-tools :global(.sort) {
			min-width: 7.5rem;
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

		.graph {
			padding: 0 16px 16px;
		}

		.rel-remove {
			width: 44px;
			height: 44px;
		}
	}

	@media (pointer: coarse) {
		.list-scroll {
			--sortable-handle-size: 44px;
		}
	}
</style>
