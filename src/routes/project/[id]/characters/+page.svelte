<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { charactersDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Character } from '$lib/types';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import { createCharacterContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import { onMount } from 'svelte';

	let characters = $state<Character[]>([]);
	let isLoading = $state(true);
	let showCreateModal = $state(false);
	let showEditModal = $state(false);
	let showRelationModal = $state(false);
	let editingCharacter = $state<Character | null>(null);
	let selectedCharacter = $state<Character | null>(null);
	type ViewMode = 'grid' | 'list' | 'graph';
	let viewMode = $state<ViewMode>('grid');

	function viewToggleClass(mode: ViewMode): string {
		return [
			'px:16 py:8 r:8 font:13 transition:all|.2s|ease b:2px|solid|theme-border',
			viewMode === mode
				? 'bg:$(theme.primary) fg:$(theme.primary)'
				: 'bg:theme-background fg:theme-text-secondary hover:bg:theme-surface'
		].join(' ');
	}

	function actionButtonClass(variant: 'default' | 'secondary' | 'danger' = 'default'): string {
		const base =
			'px:12 py:8 r:6 b:2px|solid|theme-border bg:theme-background transition:all|.2s|ease';
		const variants = {
			default: 'fg:theme-text',
			secondary: 'fg:theme.secondary',
			danger: 'fg:theme-error hover:bg:theme-error hover:fg:theme-background'
		} as const;
		return `${base} ${variants[variant]}`;
	}

	const textareaBaseClass =
		'w:full px:12 py:10 b:1|solid|theme-border bg:theme-background r:8 outline:none focus:b:$(theme.primary) transition:all|.2s font-family:inherit fg:theme-text';

	const fieldBaseClass =
		'px:12 py:10 b:1|solid|theme-border bg:theme-background fg:theme-text r:8 outline:none focus:b:$(theme.primary) transition:all|.2s';

	// コンテキストメニュー
	let contextMenu = $state<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
		targetCharacter?: Character;
	}>({ visible: false, x: 0, y: 0, items: [] });

	// フォーム状態
	let formData = $state({
		name: '',
		role: '',
		age: undefined as number | undefined,
		gender: '',
		appearance: '',
		personality: '',
		background: ''
	});

	onMount(async () => {
		await loadCharacters();
	});

	const loadCharacters = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			characters = await charactersDB.getByProjectId(currentProjectStore.project.id);
		} finally {
			isLoading = false;
		}
	};

	const openCreateModal = () => {
		formData = {
			name: '',
			role: '',
			age: undefined,
			gender: '',
			appearance: '',
			personality: '',
			background: ''
		};
		showCreateModal = true;
	};

	function openEditModal(character: Character) {
		editingCharacter = character;
		formData = {
			name: character.name,
			role: character.role,
			age: character.age,
			gender: character.gender || '',
			appearance: character.appearance,
			personality: character.personality,
			background: character.background
		};
		showEditModal = true;
	}

	function openRelationModal(character: Character) {
		selectedCharacter = character;
		showRelationModal = true;
	}

	const handleCreate = async () => {
		if (!currentProjectStore.project || !formData.name.trim()) return;

		const character = await charactersDB.create({
			projectId: currentProjectStore.project.id,
			name: formData.name,
			role: formData.role
		});

		// 追加情報を更新
		await charactersDB.update(character.id, {
			age: formData.age,
			gender: formData.gender,
			appearance: formData.appearance,
			personality: formData.personality,
			background: formData.background
		});

		// 同期キューに追加
		await queueChange('characters', character.id, 'create');

		await loadCharacters();
		showCreateModal = false;
	};

	const handleUpdate = async () => {
		if (!editingCharacter) return;

		await charactersDB.update(editingCharacter.id, {
			name: formData.name,
			role: formData.role,
			age: formData.age,
			gender: formData.gender,
			appearance: formData.appearance,
			personality: formData.personality,
			background: formData.background
		});

		// 同期キューに追加
		await queueChange('characters', editingCharacter.id, 'update');

		await loadCharacters();
		showEditModal = false;
		editingCharacter = null;
	};

	async function handleDelete(id: string) {
		if (!confirm('このキャラクターを削除しますか?')) return;
		await charactersDB.delete(id);
		// 同期キューに追加
		await queueChange('characters', id, 'delete');
		await loadCharacters();
	}

	async function handleAddRelation(
		fromCharacterId: string,
		toCharacterId: string,
		relation: string
	) {
		const character = characters.find((c) => c.id === fromCharacterId);
		if (!character) return;

		// プレーンなオブジェクトと配列に変換
		const newRelationships = [
			...character.relationships.map((r) => ({ characterId: r.characterId, relation: r.relation })),
			{ characterId: toCharacterId, relation }
		];

		await charactersDB.update(fromCharacterId, {
			relationships: newRelationships
		});

		// 同期キューに追加
		await queueChange('characters', fromCharacterId, 'update');

		await loadCharacters();
	}

	async function handleRemoveRelation(characterId: string, relationshipIndex: number) {
		const character = characters.find((c) => c.id === characterId);
		if (!character) return;

		// プレーンなオブジェクトと配列に変換
		const newRelationships = character.relationships
			.filter((_, i) => i !== relationshipIndex)
			.map((r) => ({ characterId: r.characterId, relation: r.relation }));

		await charactersDB.update(characterId, {
			relationships: newRelationships
		});

		// 同期キューに追加
		await queueChange('characters', characterId, 'update');

		await loadCharacters();
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

	// コンテキストメニュー - キャラクター
	function handleCharacterContextMenu(e: MouseEvent, character: Character) {
		e.preventDefault();
		e.stopPropagation();

		const items = createCharacterContextMenu({
			onEdit: () => openEditModal(character),
			onDuplicate: () => handleDuplicateCharacter(character),
			onDelete: () => handleDelete(character.id),
			onViewRelations: () => openRelationModal(character)
		});

		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items,
			targetCharacter: character
		};
	}

	// 複製処理
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
		} catch (error) {
			console.error('Failed to duplicate character:', error);
			alert('キャラクターの複製に失敗しました');
		}
	}
</script>

<div class="flex w:100% h:100% bg:theme-background fg:theme-text">
	<div class="flex-grow:1 flex flex-direction:column">
		<header class="bg:theme-background border-bottom:2|solid|theme-text">
			<div
				class="max-w:1280 mx:auto w:100% px:24 py:20 flex justify-content:space-between align-items:center"
			>
				<div>
					<h1 class="font:26 font-weight:600 m:0 fg:theme-text">キャラクター管理</h1>
					<p class="font:14 fg:theme-text-secondary mt:8">登場人物の情報と相関図を管理します</p>
				</div>
				<div class="flex align-items:center gap:12">
					<div class="flex bg:theme-surface b:2px|solid|theme-border r:10 p:6 gap:8">
						<button class={viewToggleClass('grid')} onclick={() => (viewMode = 'grid')}>
							グリッド
						</button>
						<button class={viewToggleClass('list')} onclick={() => (viewMode = 'list')}>
							リスト
						</button>
						<button class={viewToggleClass('graph')} onclick={() => (viewMode = 'graph')}>
							相関図
						</button>
					</div>
					<Button
						class="px:16 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8 font:14"
						onclick={openCreateModal}
					>
						+ 新規キャラクター
					</Button>
				</div>
			</div>
		</header>

		<main class="flex-grow:1 overflow-y:auto">
			<div class="max-w:1280 mx:auto px:24 py:24 flex flex-direction:column gap:24">
				{#if isLoading}
					<div class="flex justify-content:center align-items:center h:400">
						<p class="fg:theme-text-secondary">読み込み中...</p>
					</div>
				{:else if viewMode === 'grid'}
					<!-- グリッドビュー -->
					<div class="grid cols:3 gap:20">
						{#each characters as character (character.id)}
							<Card
								class="bg:theme-surface b:2px|solid|theme-border shadow:sm p:24 flex flex-direction:column gap:16"
								oncontextmenu={(e) => handleCharacterContextMenu(e, character)}
							>
								<div class="flex flex-direction:column align-items:center text-align:center gap:8">
									<div
										class="w:72 h:72 r:full bg:theme-border flex align-items:center justify-content:center font:24 fg:theme-text"
									>
										{character.name.charAt(0)}
									</div>
									<h3 class="font:18 font-weight:600 fg:theme-text m:0">{character.name}</h3>
									<p class="font:14 fg:theme-text-secondary m:0">{character.role}</p>
									{#if character.age || character.gender}
										<p class="font:12 fg:theme-text-secondary">
											{character.age ? `${character.age}歳` : ''}{character.age && character.gender
												? ' / '
												: ''}{character.gender || ''}
										</p>
									{/if}
								</div>

								{#if character.personality}
									<div class="flex flex-direction:column gap:4">
										<p class="font:12 font-weight:600 fg:theme-text-secondary m:0">性格</p>
										<p class="font:14 fg:theme-text-secondary line-clamp:2">
											{character.personality}
										</p>
									</div>
								{/if}

								{#if character.relationships.length > 0}
									<div class="flex flex-direction:column gap:4">
										<p class="font:12 font-weight:600 fg:theme-text-secondary m:0">関係</p>
										<div class="flex flex-wrap gap:6">
											{#each character.relationships.slice(0, 3) as rel}
												<span
													class="px:10 py:4 r:full bg:$(theme.primary)/.12 fg:$(theme.primary) font:12"
												>
													{getCharacterName(rel.characterId)}
												</span>
											{/each}
											{#if character.relationships.length > 3}
												<span
													class="px:10 py:4 r:full bg:theme-background b:1px|solid|theme-border fg:theme-text-secondary font:12"
												>
													+{character.relationships.length - 3}
												</span>
											{/if}
										</div>
									</div>
								{/if}

								<div class="flex gap:8">
									<button
										class={`flex:1 ${actionButtonClass()}`}
										onclick={() => openEditModal(character)}
									>
										編集
									</button>
									<button
										class={`flex:1 ${actionButtonClass('secondary')}`}
										onclick={() => openRelationModal(character)}
									>
										関係
									</button>
									<button
										class={actionButtonClass('danger')}
										onclick={() => handleDelete(character.id)}
									>
										削除
									</button>
								</div>
							</Card>
						{/each}
					</div>
				{:else if viewMode === 'list'}
					<!-- リストビュー -->
					<div class="flex flex-direction:column gap:16">
						{#each characters as character (character.id)}
							<Card
								class="bg:theme-surface b:2px|solid|theme-border shadow:sm p:24"
								oncontextmenu={(e) => handleCharacterContextMenu(e, character)}
							>
								<div class="flex gap:20 align-items:start">
									<div
										class="w:64 h:64 r:full bg:theme-border flex align-items:center justify-content:center font:22 fg:theme-text flex-shrink:0"
									>
										{character.name.charAt(0)}
									</div>
									<div class="flex:1 flex flex-direction:column gap:16">
										<div class="flex justify-content:space-between align-items:start gap:16">
											<div>
												<h3 class="font:18 font-weight:600 fg:theme-text m:0">{character.name}</h3>
												<p class="font:14 fg:theme-text-secondary mt:6">
													{character.role}
													{#if character.age || character.gender}
														• {character.age ? `${character.age}歳` : ''}{character.age &&
														character.gender
															? ' / '
															: ''}{character.gender || ''}
													{/if}
												</p>
											</div>
											<div class="flex gap:8">
												<button class={actionButtonClass()} onclick={() => openEditModal(character)}
													>編集</button
												>
												<button
													class={actionButtonClass('secondary')}
													onclick={() => openRelationModal(character)}>関係</button
												>
												<button
													class={actionButtonClass('danger')}
													onclick={() => handleDelete(character.id)}>削除</button
												>
											</div>
										</div>

										<div class="grid cols:3 gap:16">
											{#if character.appearance}
												<div class="flex flex-direction:column gap:4">
													<p class="font:12 font-weight:600 fg:theme-text-secondary m:0">外見</p>
													<p class="font:14 fg:theme-text-secondary">{character.appearance}</p>
												</div>
											{/if}
											{#if character.personality}
												<div class="flex flex-direction:column gap:4">
													<p class="font:12 font-weight:600 fg:theme-text-secondary m:0">性格</p>
													<p class="font:14 fg:theme-text-secondary">{character.personality}</p>
												</div>
											{/if}
											{#if character.background}
												<div class="flex flex-direction:column gap:4">
													<p class="font:12 font-weight:600 fg:theme-text-secondary m:0">背景</p>
													<p class="font:14 fg:theme-text-secondary">{character.background}</p>
												</div>
											{/if}
										</div>
									</div>
								</div>
							</Card>
						{/each}
					</div>
				{:else}
					<!-- 相関図ビュー -->
					<Card class="bg:theme-surface b:2px|solid|theme-border shadow:sm p:24">
						<div class="flex flex-wrap gap:24 justify-content:center">
							{#each characters as character (character.id)}
								<div class="flex flex-direction:column align-items:center gap:8">
									<button
										class="w:80 h:80 r:full b:2px|solid|theme-border bg:$(theme.primary)/.18 fg:$(theme.primary) flex align-items:center justify-content:center font:22 transition:all|.2s|ease hover:bg:$(theme.primary)/.25"
										onclick={() => openRelationModal(character)}
									>
										{character.name.charAt(0)}
									</button>
									<p class="font:14 font-weight:600 fg:theme-text m:0">{character.name}</p>
									<p class="font:12 fg:theme-text-secondary m:0">{character.role}</p>
									{#if character.relationships.length > 0}
										<div class="mt:12 flex flex-direction:column gap:6 w:200">
											{#each getRelationships(character) as rel}
												<div
													class="flex align-items:center gap:8 px:12 py:6 bg:theme-background b:1px|solid|theme-border r:8"
												>
													<span class="font:12 fg:theme-text-secondary">{rel.relation}</span>
													<span class="font:12 font-weight:600 fg:theme-text-secondary">→</span>
													<span class="font:12 fg:theme.primary">{rel.name}</span>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</div>
						{#if characters.length === 0}
							<div class="flex justify-content:center align-items:center h:300">
								<p class="fg:theme-text-secondary">キャラクターがありません</p>
							</div>
						{/if}
					</Card>
				{/if}

				{#if characters.length === 0 && !isLoading}
					<div
						class="flex flex-direction:column align-items:center justify-content:center h:400 gap:16"
					>
						<p class="fg:theme-text-secondary font:18">キャラクターがまだありません</p>
						<Button
							class="px:20 py:12 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:10 font:14"
							onclick={openCreateModal}
						>
							最初のキャラクターを作成
						</Button>
					</div>
				{/if}
			</div>
		</main>
	</div>
</div>

<!-- 新規作成モーダル -->
<Modal bind:isOpen={showCreateModal} title="新規キャラクター作成">
	{#snippet children()}
		<div class="flex flex-direction:column gap:16">
			<Input label="名前 *" bind:value={formData.name} placeholder="キャラクター名" />
			<Input label="役割" bind:value={formData.role} placeholder="主人公、ヒロイン、悪役など" />

			<div class="grid cols:2 gap:16">
				<div>
					<label for="create-age" class="block mb:8 font:14 font:semibold">年齢</label>
					<input
						id="create-age"
						type="number"
						bind:value={formData.age}
						placeholder="年齢"
						class={`w:full ${fieldBaseClass}`}
					/>
				</div>
				<Input label="性別" bind:value={formData.gender} placeholder="性別" />
			</div>

			<div>
				<label for="create-appearance" class="block mb:8 font:14 font:semibold">外見</label>
				<textarea
					id="create-appearance"
					bind:value={formData.appearance}
					class={`${textareaBaseClass} min-h:80 resize:vertical`}
					placeholder="髪型、体格、服装など..."
				></textarea>
			</div>

			<div>
				<label for="create-personality" class="block mb:8 font:14 font:semibold">性格</label>
				<textarea
					id="create-personality"
					bind:value={formData.personality}
					class={`${textareaBaseClass} min-h:80 resize:vertical`}
					placeholder="性格の特徴..."
				></textarea>
			</div>

			<div>
				<label for="create-background" class="block mb:8 font:14 font:semibold">背景</label>
				<textarea
					id="create-background"
					bind:value={formData.background}
					class={`${textareaBaseClass} min-h:80 resize:vertical`}
					placeholder="生い立ち、経歴など..."
				></textarea>
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button variant="ghost" class={actionButtonClass()} onclick={() => (showCreateModal = false)}
				>キャンセル</Button
			>
			<Button
				class="px:20 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8 font:14"
				onclick={handleCreate}
				disabled={!formData.name.trim()}>作成</Button
			>
		</div>
	{/snippet}
</Modal>

<!-- 編集モーダル -->
<Modal bind:isOpen={showEditModal} title="キャラクター編集">
	{#snippet children()}
		<div class="flex flex-direction:column gap:16">
			<Input label="名前 *" bind:value={formData.name} placeholder="キャラクター名" />
			<Input label="役割" bind:value={formData.role} placeholder="主人公、ヒロイン、悪役など" />

			<div class="grid cols:2 gap:16">
				<div>
					<label for="edit-age" class="block mb:8 font:14 font:semibold">年齢</label>
					<input
						id="edit-age"
						type="number"
						bind:value={formData.age}
						placeholder="年齢"
						class={`w:full ${fieldBaseClass}`}
					/>
				</div>
				<Input label="性別" bind:value={formData.gender} placeholder="性別" />
			</div>

			<div>
				<label for="edit-appearance" class="block mb:8 font:14 font:semibold">外見</label>
				<textarea
					id="edit-appearance"
					bind:value={formData.appearance}
					class={`${textareaBaseClass} min-h:80 resize:vertical`}
					placeholder="髪型、体格、服装など..."
				></textarea>
			</div>

			<div>
				<label for="edit-personality" class="block mb:8 font:14 font:semibold">性格</label>
				<textarea
					id="edit-personality"
					bind:value={formData.personality}
					class={`${textareaBaseClass} min-h:80 resize:vertical`}
					placeholder="性格の特徴..."
				></textarea>
			</div>

			<div>
				<label for="edit-background" class="block mb:8 font:14 font:semibold">背景</label>
				<textarea
					id="edit-background"
					bind:value={formData.background}
					class={`${textareaBaseClass} min-h:80 resize:vertical`}
					placeholder="生い立ち、経歴など..."
				></textarea>
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button variant="ghost" class={actionButtonClass()} onclick={() => (showEditModal = false)}
				>キャンセル</Button
			>
			<Button
				class="px:20 py:10 bg:theme.primary fg:theme-background b:2px|solid|theme-text r:8 font:14"
				onclick={handleUpdate}
				disabled={!formData.name.trim()}>更新</Button
			>
		</div>
	{/snippet}
</Modal>

<!-- 関係編集モーダル -->
<Modal bind:isOpen={showRelationModal} title="キャラクター関係編集">
	{#snippet children()}
		{#if selectedCharacter}
			<div class="flex flex-direction:column gap:16">
				<div class="p:16 bg:theme-surface b:1px|solid|theme-border r:8">
					<p class="font:14 fg:theme-text-secondary mb:4">対象キャラクター</p>
					<p class="font:18 font-weight:600 fg:theme-text">{selectedCharacter.name}</p>
				</div>

				<div>
					<p class="font:14 font:semibold mb:12">現在の関係</p>
					{#if selectedCharacter.relationships.length === 0}
						<p class="fg:theme-text-secondary font:14">関係が登録されていません</p>
					{:else}
						<div class="flex flex-direction:column gap:8">
							{#each getRelationships(selectedCharacter) as rel, index}
								<div
									class="flex align-items:center justify-content:space-between p:12 bg:theme-background b:1px|solid|theme-border r:8"
								>
									<div class="flex align-items:center gap:12">
										<span class="font:14 fg:theme-text-secondary">{rel.relation}</span>
										<span class="fg:theme-text-secondary">→</span>
										<span class="font:14 font-weight:600 fg:theme.primary">{rel.name}</span>
									</div>
									<button
										class={actionButtonClass('danger')}
										onclick={() => handleRemoveRelation(selectedCharacter!.id, index)}
									>
										削除
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<div>
					<p class="font:14 font:semibold mb:12">新しい関係を追加</p>
					<div class="flex gap:8">
						<input
							type="text"
							placeholder="関係性（例: 親友、ライバル）"
							class={`flex:1 ${fieldBaseClass}`}
							id="relation-input"
						/>
						<select class={fieldBaseClass} id="target-character">
							<option value="">キャラクターを選択</option>
							{#each characters.filter((c) => c.id !== selectedCharacter?.id) as char}
								<option value={char.id}>{char.name}</option>
							{/each}
						</select>
						<Button
							class="px:16 py:10 bg:theme.primary fg:theme-background r:8"
							onclick={() => {
								const relationInput = document.getElementById('relation-input') as HTMLInputElement;
								const targetSelect = document.getElementById(
									'target-character'
								) as HTMLSelectElement;
								if (relationInput.value && targetSelect.value && selectedCharacter) {
									handleAddRelation(selectedCharacter.id, targetSelect.value, relationInput.value);
									relationInput.value = '';
									targetSelect.value = '';
								}
							}}
						>
							追加
						</Button>
					</div>
				</div>
			</div>
		{/if}
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button
				variant="ghost"
				class={actionButtonClass()}
				onclick={() => (showRelationModal = false)}>閉じる</Button
			>
		</div>
	{/snippet}
</Modal>

<!-- コンテキストメニュー -->
<ContextMenu
	visible={contextMenu.visible}
	x={contextMenu.x}
	y={contextMenu.y}
	items={contextMenu.items}
	onClose={() => (contextMenu.visible = false)}
/>

<style>
	.line-clamp\:2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
