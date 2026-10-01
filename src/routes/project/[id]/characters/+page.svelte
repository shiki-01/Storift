<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { charactersDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Character } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
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
	import { createCharacterContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import { onMount } from 'svelte';

	type ViewMode = 'grid' | 'list' | 'graph';

	let characters = $state<Character[]>([]);
	let isLoading = $state(true);
	let viewMode = $state<ViewMode>('grid');
	let searchQuery = $state('');
	let roleFilter = $state('');

	// 作成・編集で共用するモーダル（editingCharacter が null なら新規作成）
	let showFormModal = $state(false);
	let editingCharacter = $state<Character | null>(null);
	let isSaving = $state(false);

	let showRelationModal = $state(false);
	let selectedCharacterId = $state<string | null>(null);
	let relationText = $state('');
	let relationTargetId = $state('');

	let contextMenu = $state<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
	}>({ visible: false, x: 0, y: 0, items: [] });

	let formData = $state({
		name: '',
		role: '',
		age: null as number | null,
		gender: '',
		appearance: '',
		personality: '',
		background: ''
	});

	const viewOptions: { value: ViewMode; label: string }[] = [
		{ value: 'grid', label: 'グリッド' },
		{ value: 'list', label: 'リスト' },
		{ value: 'graph', label: '相関図' }
	];

	let selectedCharacter = $derived(characters.find((c) => c.id === selectedCharacterId) ?? null);

	let roles = $derived(Array.from(new Set(characters.map((c) => c.role).filter(Boolean))).sort());

	let filteredCharacters = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return characters.filter((c) => {
			const matchRole = !roleFilter || c.role === roleFilter;
			const matchSearch =
				!q ||
				[c.name, c.role, c.appearance, c.personality, c.background].some((v) =>
					v.toLowerCase().includes(q)
				);
			return matchRole && matchSearch;
		});
	});

	let isFiltering = $derived(searchQuery.trim() !== '' || roleFilter !== '');

	onMount(async () => {
		await loadCharacters();
	});

	const loadCharacters = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			characters = await charactersDB.getByProjectId(currentProjectStore.project.id);
		} catch (error) {
			console.error('Failed to load characters:', error);
			toast.error('キャラクターの読み込みに失敗しました');
		} finally {
			isLoading = false;
		}
	};

	const openCreateModal = () => {
		editingCharacter = null;
		formData = {
			name: '',
			role: '',
			age: null,
			gender: '',
			appearance: '',
			personality: '',
			background: ''
		};
		showFormModal = true;
	};

	function openEditModal(character: Character) {
		editingCharacter = character;
		formData = {
			name: character.name,
			role: character.role,
			age: character.age ?? null,
			gender: character.gender || '',
			appearance: character.appearance,
			personality: character.personality,
			background: character.background
		};
		showFormModal = true;
	}

	function openRelationModal(character: Character) {
		selectedCharacterId = character.id;
		relationText = '';
		relationTargetId = '';
		showRelationModal = true;
	}

	const handleSave = async () => {
		if (!currentProjectStore.project || !formData.name.trim() || isSaving) return;
		isSaving = true;
		const name = formData.name.trim();
		const details = {
			role: formData.role,
			age: formData.age ?? undefined,
			gender: formData.gender,
			appearance: formData.appearance,
			personality: formData.personality,
			background: formData.background
		};
		try {
			if (editingCharacter) {
				await charactersDB.update(editingCharacter.id, { name, ...details });
				await queueChange('characters', editingCharacter.id, 'update');
				toast.success(`キャラクター「${name}」を更新しました`);
			} else {
				const character = await charactersDB.create({
					projectId: currentProjectStore.project.id,
					name,
					role: formData.role
				});
				await charactersDB.update(character.id, details);
				await queueChange('characters', character.id, 'create');
				toast.success(`キャラクター「${name}」を作成しました`);
			}
			showFormModal = false;
			editingCharacter = null;
			await loadCharacters();
		} catch (error) {
			console.error('Failed to save character:', error);
			toast.error(
				editingCharacter ? 'キャラクターの更新に失敗しました' : 'キャラクターの作成に失敗しました'
			);
		} finally {
			isSaving = false;
		}
	};

	function handleDelete(character: Character) {
		// 取り消し用に削除前のレコードを保持する
		const snapshot = $state.snapshot(character) as Character;
		return deleteWithUndo({
			targetLabel: `キャラクター「${snapshot.name}」`,
			remove: async () => {
				await charactersDB.delete(snapshot.id);
				await queueChange('characters', snapshot.id, 'delete');
				await loadCharacters();
			},
			restore: async () => {
				await charactersDB.addFromRemote(snapshot);
				await queueChange('characters', snapshot.id, 'create');
				await loadCharacters();
			}
		});
	}

	async function saveRelationships(
		characterId: string,
		relationships: Character['relationships'],
		successMessage: string
	) {
		try {
			// プレーンなオブジェクトに変換して保存
			await charactersDB.update(characterId, {
				relationships: relationships.map((r) => ({
					characterId: r.characterId,
					relation: r.relation
				}))
			});
			await queueChange('characters', characterId, 'update');
			await loadCharacters();
			toast.success(successMessage);
		} catch (error) {
			console.error('Failed to update relationships:', error);
			toast.error('関係の更新に失敗しました');
		}
	}

	async function handleAddRelation() {
		const character = selectedCharacter;
		const relation = relationText.trim();
		if (!character || !relation || !relationTargetId) return;
		await saveRelationships(
			character.id,
			[...character.relationships, { characterId: relationTargetId, relation }],
			'関係を追加しました'
		);
		relationText = '';
		relationTargetId = '';
	}

	async function handleRemoveRelation(character: Character, index: number) {
		await saveRelationships(
			character.id,
			character.relationships.filter((_, i) => i !== index),
			'関係を削除しました'
		);
	}

	function getCharacterName(characterId: string): string {
		return characters.find((c) => c.id === characterId)?.name || '不明';
	}

	function getRelationships(character: Character) {
		return character.relationships.map((rel) => ({
			...rel,
			name: getCharacterName(rel.characterId)
		}));
	}

	function describeProfile(character: Character): string {
		const parts = [];
		if (character.age) parts.push(`${character.age}歳`);
		if (character.gender) parts.push(character.gender);
		return parts.join(' / ');
	}

	function handleCharacterContextMenu(e: MouseEvent, character: Character) {
		e.preventDefault();
		e.stopPropagation();
		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items: createCharacterContextMenu({
				onEdit: () => openEditModal(character),
				onDuplicate: () => handleDuplicateCharacter(character),
				onDelete: () => handleDelete(character),
				onViewRelations: () => openRelationModal(character)
			})
		};
	}

	async function handleDuplicateCharacter(character: Character) {
		if (!currentProjectStore.project) return;
		try {
			const newCharacter = await charactersDB.create({
				projectId: currentProjectStore.project.id,
				name: `${character.name} (コピー)`,
				role: character.role
			});
			await charactersDB.update(newCharacter.id, {
				age: character.age,
				gender: character.gender,
				appearance: character.appearance,
				personality: character.personality,
				background: character.background
			});
			await queueChange('characters', newCharacter.id, 'create');
			await loadCharacters();
			toast.success('キャラクターを複製しました');
		} catch (error) {
			console.error('Failed to duplicate character:', error);
			toast.error('キャラクターの複製に失敗しました');
		}
	}

	// ---- 相関図 (B-7) ----
	const GRAPH_W = 760;
	const GRAPH_H = 520;
	const NODE_R = 32;

	/** 表示中のキャラクターを楕円上に配置する */
	let graphNodes = $derived.by(() => {
		const list = filteredCharacters;
		const n = list.length;
		const cx = GRAPH_W / 2;
		const cy = GRAPH_H / 2;
		const rx = GRAPH_W / 2 - NODE_R - 60;
		const ry = GRAPH_H / 2 - NODE_R - 40;
		return list.map((character, i) => {
			const angle = (2 * Math.PI * i) / n - Math.PI / 2;
			return {
				character,
				x: n === 1 ? cx : cx + rx * Math.cos(angle),
				y: n === 1 ? cy : cy + ry * Math.sin(angle)
			};
		});
	});

	/** 関係ごとの曲線（A→B と B→A が重ならないよう、進行方向に対して同じ側へ膨らませる） */
	let graphEdges = $derived.by(() => {
		const pos = new Map(graphNodes.map((n) => [n.character.id, n]));
		const edges: { key: string; path: string; label: string; lx: number; ly: number }[] = [];
		for (const from of graphNodes) {
			from.character.relationships.forEach((rel, index) => {
				const to = pos.get(rel.characterId);
				if (!to || to === from) return;
				const dx = to.x - from.x;
				const dy = to.y - from.y;
				const len = Math.hypot(dx, dy) || 1;
				const bow = 28;
				const cx = (from.x + to.x) / 2 + (-dy / len) * bow;
				const cy = (from.y + to.y) / 2 + (dx / len) * bow;
				const trim = (px: number, py: number, ox: number, oy: number) => {
					const d = Math.hypot(px - ox, py - oy) || 1;
					return [ox + ((px - ox) / d) * (NODE_R + 4), oy + ((py - oy) / d) * (NODE_R + 4)];
				};
				const [sx, sy] = trim(cx, cy, from.x, from.y);
				const [ex, ey] = trim(cx, cy, to.x, to.y);
				edges.push({
					key: `${from.character.id}-${index}`,
					path: `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`,
					label: rel.relation,
					// 二次ベジェの t=0.5 の点
					lx: 0.25 * sx + 0.5 * cx + 0.25 * ex,
					ly: 0.25 * sy + 0.5 * cy + 0.25 * ey
				});
			});
		}
		return edges;
	});
</script>

<svelte:head>
	<title>キャラクター | Storift</title>
</svelte:head>

<div class="flex flex-direction:column w:100% h:100% bg:theme-background fg:theme-text">
	<PageHeader title="キャラクター" description="登場人物の情報と相関図を管理します">
		{#snippet actions()}
			<button
				type="button"
				class={buttonClass('primary')}
				onclick={openCreateModal}
				disabled={!currentProjectStore.project}
			>
				+ 新規キャラクター
			</button>
		{/snippet}
	</PageHeader>

	<main class="flex-grow:1 overflow-y:auto">
		<div class="max-w:1280 mx:auto w:100% px:24 py:24 flex flex-direction:column gap:24">
			<div class="flex flex-wrap:wrap align-items:center gap:12">
				<SearchBox
					bind:value={searchQuery}
					placeholder="名前・役割・性格などで検索..."
					ariaLabel="キャラクターを検索"
				/>
				{#if roles.length > 0}
					<select bind:value={roleFilter} aria-label="役割で絞り込み" class="{fieldClass} w:auto">
						<option value="">すべての役割</option>
						{#each roles as role (role)}
							<option value={role}>{role}</option>
						{/each}
					</select>
				{/if}
				<SegmentedControl options={viewOptions} bind:value={viewMode} ariaLabel="表示切り替え" />
			</div>

			{#if isLoading}
				<div class="flex justify-content:center align-items:center h:320">
					<p class="fg:theme-text-secondary font:14">読み込み中...</p>
				</div>
			{:else if characters.length === 0}
				<EmptyState
					message="キャラクターがまだありません"
					actionLabel="最初のキャラクターを作成"
					onaction={openCreateModal}
				/>
			{:else if isFiltering && filteredCharacters.length === 0}
				<EmptyState message="条件に一致するキャラクターがいません" />
			{:else if viewMode === 'grid'}
				<div
					class="grid gap:16 grid-template-columns:repeat(1,minmax(0,1fr)) md:grid-template-columns:repeat(2,minmax(0,1fr)) xl:grid-template-columns:repeat(3,minmax(0,1fr))"
				>
					{#each filteredCharacters as character (character.id)}
						<Card
							class="flex flex-direction:column gap:16"
							oncontextmenu={(e) => handleCharacterContextMenu(e, character)}
						>
							<div class="flex flex-direction:column align-items:center text-align:center gap:8">
								<div
									class="w:64 h:64 r:full bg:theme-background b:2|solid|theme-border flex align-items:center justify-content:center font:24 fg:theme-text"
									aria-hidden="true"
								>
									{character.name.charAt(0)}
								</div>
								<h3 class="font:18 font-weight:600 fg:theme-text m:0">{character.name}</h3>
								{#if character.role}
									<p class="font:14 fg:theme-text-secondary m:0">{character.role}</p>
								{/if}
								{#if describeProfile(character)}
									<p class="font:12 fg:theme-text-secondary m:0">{describeProfile(character)}</p>
								{/if}
							</div>

							{#if character.personality}
								<div class="flex flex-direction:column gap:4">
									<p class="font:12 font-weight:600 fg:theme-text-secondary m:0">性格</p>
									<p
										class="font:14 fg:theme-text-secondary m:0"
										style="display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;"
									>
										{character.personality}
									</p>
								</div>
							{/if}

							{#if character.relationships.length > 0}
								<div class="flex flex-direction:column gap:4">
									<p class="font:12 font-weight:600 fg:theme-text-secondary m:0">関係</p>
									<div class="flex flex-wrap:wrap gap:6">
										{#each character.relationships.slice(0, 3) as rel, i (i)}
											<span class={badgeClass}>
												{rel.relation}: {getCharacterName(rel.characterId)}
											</span>
										{/each}
										{#if character.relationships.length > 3}
											<span class={badgeClass}>+{character.relationships.length - 3}</span>
										{/if}
									</div>
								</div>
							{/if}

							<div class="flex gap:8 mt:auto">
								<button
									type="button"
									class={buttonClass('secondary', 'flex:1')}
									onclick={() => openEditModal(character)}
								>
									編集
								</button>
								<button
									type="button"
									class={buttonClass('secondary', 'flex:1')}
									onclick={() => openRelationModal(character)}
								>
									関係
								</button>
								<button
									type="button"
									class={buttonClass('danger')}
									aria-label={`キャラクター「${character.name}」を削除`}
									onclick={() => handleDelete(character)}
								>
									削除
								</button>
							</div>
						</Card>
					{/each}
				</div>
			{:else if viewMode === 'list'}
				<div class="flex flex-direction:column gap:12">
					{#each filteredCharacters as character (character.id)}
						<Card oncontextmenu={(e) => handleCharacterContextMenu(e, character)}>
							<div class="flex gap:16 align-items:start">
								<div
									class="w:56 h:56 r:full bg:theme-background b:2|solid|theme-border flex align-items:center justify-content:center font:20 fg:theme-text flex-shrink:0"
									aria-hidden="true"
								>
									{character.name.charAt(0)}
								</div>
								<div class="flex:1 flex flex-direction:column gap:16 min-w:0">
									<div
										class="flex flex-wrap:wrap justify-content:space-between align-items:start gap:12"
									>
										<div>
											<h3 class="font:18 font-weight:600 fg:theme-text m:0">{character.name}</h3>
											<p class="font:14 fg:theme-text-secondary mt:4 mb:0">
												{[character.role, describeProfile(character)].filter(Boolean).join(' ・ ')}
											</p>
										</div>
										<div class="flex gap:8">
											<button
												type="button"
												class={buttonClass('secondary')}
												onclick={() => openEditModal(character)}
											>
												編集
											</button>
											<button
												type="button"
												class={buttonClass('secondary')}
												onclick={() => openRelationModal(character)}
											>
												関係
											</button>
											<button
												type="button"
												class={buttonClass('danger')}
												aria-label={`キャラクター「${character.name}」を削除`}
												onclick={() => handleDelete(character)}
											>
												削除
											</button>
										</div>
									</div>

									<div
										class="grid gap:16 grid-template-columns:repeat(1,minmax(0,1fr)) md:grid-template-columns:repeat(3,minmax(0,1fr))"
									>
										{#each [{ label: '外見', value: character.appearance }, { label: '性格', value: character.personality }, { label: '背景', value: character.background }] as field (field.label)}
											{#if field.value}
												<div class="flex flex-direction:column gap:4">
													<p class="font:12 font-weight:600 fg:theme-text-secondary m:0">
														{field.label}
													</p>
													<p class="font:14 fg:theme-text-secondary m:0 white-space:pre-wrap">
														{field.value}
													</p>
												</div>
											{/if}
										{/each}
									</div>
								</div>
							</div>
						</Card>
					{/each}
				</div>
			{:else}
				<!-- 相関図ビュー -->
				<Card class="flex flex-direction:column gap:16">
					<div class="overflow-x:auto">
						<svg
							viewBox="0 0 {GRAPH_W} {GRAPH_H}"
							class="w:full h:auto min-w:560"
							role="group"
							aria-label="キャラクター相関図"
						>
							<defs>
								<marker
									id="relation-arrow"
									viewBox="0 0 10 10"
									refX="9"
									refY="5"
									markerWidth="7"
									markerHeight="7"
									orient="auto-start-reverse"
								>
									<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-secondary)" />
								</marker>
							</defs>

							{#each graphEdges as edge (edge.key)}
								<path
									d={edge.path}
									fill="none"
									stroke="var(--color-text-secondary)"
									stroke-width="1.5"
									marker-end="url(#relation-arrow)"
								/>
								<text
									x={edge.lx}
									y={edge.ly}
									text-anchor="middle"
									dominant-baseline="central"
									font-size="12"
									fill="var(--color-text)"
									stroke="var(--color-surface)"
									stroke-width="4"
									paint-order="stroke"
								>
									{edge.label}
								</text>
							{/each}

							{#each graphNodes as node (node.character.id)}
								<g
									role="button"
									tabindex="0"
									aria-label={`${node.character.name}の関係を編集`}
									style="cursor:pointer;outline:none"
									onclick={() => openRelationModal(node.character)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											openRelationModal(node.character);
										}
									}}
								>
									<circle
										cx={node.x}
										cy={node.y}
										r={NODE_R}
										fill="var(--color-background)"
										stroke="var(--color-text)"
										stroke-width="2"
									/>
									<text
										x={node.x}
										y={node.y}
										text-anchor="middle"
										dominant-baseline="central"
										font-size="22"
										fill="var(--color-text)"
									>
										{node.character.name.charAt(0)}
									</text>
									<text
										x={node.x}
										y={node.y + NODE_R + 16}
										text-anchor="middle"
										font-size="14"
										font-weight="600"
										fill="var(--color-text)"
									>
										{node.character.name}
									</text>
									{#if node.character.role}
										<text
											x={node.x}
											y={node.y + NODE_R + 32}
											text-anchor="middle"
											font-size="12"
											fill="var(--color-text-secondary)"
										>
											{node.character.role}
										</text>
									{/if}
								</g>
							{/each}
						</svg>
					</div>

					{#if graphEdges.length === 0}
						<p class="font:14 fg:theme-text-secondary text-align:center m:0">
							関係が登録されていません。人物をクリックすると関係を追加できます。
						</p>
					{/if}
				</Card>
			{/if}
		</div>
	</main>
</div>

<Modal
	bind:isOpen={showFormModal}
	title={editingCharacter ? 'キャラクター編集' : '新規キャラクター作成'}
>
	{#snippet children()}
		<div class="flex flex-direction:column gap:16">
			<FormField label="名前" required>
				{#snippet children(id)}
					<input
						{id}
						type="text"
						bind:value={formData.name}
						placeholder="キャラクター名"
						class={fieldClass}
					/>
				{/snippet}
			</FormField>

			<FormField label="役割">
				{#snippet children(id)}
					<input
						{id}
						type="text"
						bind:value={formData.role}
						placeholder="主人公、ヒロイン、悪役など"
						class={fieldClass}
					/>
				{/snippet}
			</FormField>

			<div class="grid grid-template-columns:repeat(2,minmax(0,1fr)) gap:16">
				<FormField label="年齢">
					{#snippet children(id)}
						<input
							{id}
							type="number"
							min="0"
							bind:value={formData.age}
							placeholder="年齢"
							class={fieldClass}
						/>
					{/snippet}
				</FormField>
				<FormField label="性別">
					{#snippet children(id)}
						<input
							{id}
							type="text"
							bind:value={formData.gender}
							placeholder="性別"
							class={fieldClass}
						/>
					{/snippet}
				</FormField>
			</div>

			<FormField label="外見">
				{#snippet children(id)}
					<textarea
						{id}
						bind:value={formData.appearance}
						class="{textareaClass} min-h:80"
						placeholder="髪型、体格、服装など..."
					></textarea>
				{/snippet}
			</FormField>

			<FormField label="性格">
				{#snippet children(id)}
					<textarea
						{id}
						bind:value={formData.personality}
						class="{textareaClass} min-h:80"
						placeholder="性格の特徴..."
					></textarea>
				{/snippet}
			</FormField>

			<FormField label="背景">
				{#snippet children(id)}
					<textarea
						{id}
						bind:value={formData.background}
						class="{textareaClass} min-h:80"
						placeholder="生い立ち、経歴など..."
					></textarea>
				{/snippet}
			</FormField>
		</div>
	{/snippet}

	{#snippet footer()}
		<ModalActions
			submitLabel={editingCharacter ? '更新' : '作成'}
			submitDisabled={!formData.name.trim() || isSaving}
			onsubmit={handleSave}
			oncancel={() => (showFormModal = false)}
		/>
	{/snippet}
</Modal>

<Modal bind:isOpen={showRelationModal} title="キャラクター関係編集">
	{#snippet children()}
		{#if selectedCharacter}
			<div class="flex flex-direction:column gap:16">
				<div class="p:16 bg:theme-surface b:1|solid|theme-border r:8">
					<p class="font:14 fg:theme-text-secondary m:0 mb:4">対象キャラクター</p>
					<p class="font:18 font-weight:600 fg:theme-text m:0">{selectedCharacter.name}</p>
				</div>

				<section aria-label="現在の関係">
					<h3 class="font:14 font-weight:600 m:0 mb:12">現在の関係</h3>
					{#if selectedCharacter.relationships.length === 0}
						<p class="fg:theme-text-secondary font:14 m:0">関係が登録されていません</p>
					{:else}
						<ul class="flex flex-direction:column gap:8 list-style:none p:0 m:0">
							{#each getRelationships(selectedCharacter) as rel, index (index)}
								<li
									class="flex align-items:center justify-content:space-between gap:12 p:12 bg:theme-background b:1|solid|theme-border r:8"
								>
									<span class="font:14 fg:theme-text">
										{rel.relation}
										<span class="fg:theme-text-secondary">→</span>
										<span class="font-weight:600">{rel.name}</span>
									</span>
									<button
										type="button"
										class={buttonClass('danger')}
										aria-label={`「${rel.relation} → ${rel.name}」の関係を削除`}
										onclick={() => handleRemoveRelation(selectedCharacter!, index)}
									>
										削除
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section aria-label="新しい関係を追加" class="flex flex-direction:column gap:12">
					<h3 class="font:14 font-weight:600 m:0">新しい関係を追加</h3>
					<div class="flex flex-wrap:wrap gap:8 align-items:center">
						<FormField label="関係性">
							{#snippet children(id)}
								<input
									{id}
									type="text"
									bind:value={relationText}
									placeholder="例: 親友、ライバル"
									class={fieldClass}
								/>
							{/snippet}
						</FormField>
						<FormField label="相手">
							{#snippet children(id)}
								<select {id} bind:value={relationTargetId} class={fieldClass}>
									<option value="">キャラクターを選択</option>
									{#each characters.filter((c) => c.id !== selectedCharacter?.id) as char (char.id)}
										<option value={char.id}>{char.name}</option>
									{/each}
								</select>
							{/snippet}
						</FormField>
					</div>
					<div>
						<button
							type="button"
							class={buttonClass('primary')}
							disabled={!relationText.trim() || !relationTargetId}
							onclick={handleAddRelation}
						>
							追加
						</button>
					</div>
				</section>
			</div>
		{/if}
	{/snippet}

	{#snippet footer()}
		<div class="flex justify-content:flex-end">
			<button
				type="button"
				class={buttonClass('secondary')}
				onclick={() => (showRelationModal = false)}
			>
				閉じる
			</button>
		</div>
	{/snippet}
</Modal>

<ContextMenu
	visible={contextMenu.visible}
	x={contextMenu.x}
	y={contextMenu.y}
	items={contextMenu.items}
	onClose={() => (contextMenu.visible = false)}
/>
