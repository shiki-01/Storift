<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { charactersDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Character } from '$lib/types';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { onMount } from 'svelte';

	let characters = $state<Character[]>([]);
	let isLoading = $state(true);
	let showCreateModal = $state(false);
	let showEditModal = $state(false);
	let showRelationModal = $state(false);
	let editingCharacter = $state<Character | null>(null);
	let selectedCharacter = $state<Character | null>(null);
	let viewMode = $state<'grid' | 'list' | 'graph'>('grid');

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

	async function loadCharacters() {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			characters = await charactersDB.getByProjectId(currentProjectStore.project.id);
		} finally {
			isLoading = false;
		}
	}

	function openCreateModal() {
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
	}

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

	async function handleCreate() {
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
	}

	async function handleUpdate() {
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
	}

	async function handleDelete(id: string) {
		if (!confirm('このキャラクターを削除しますか?')) return;
		await charactersDB.delete(id);
		// 同期キューに追加
		await queueChange('characters', id, 'delete');
		await loadCharacters();
	}

	async function handleAddRelation(fromCharacterId: string, toCharacterId: string, relation: string) {
		const character = characters.find((c) => c.id === fromCharacterId);
		if (!character) return;

		// プレーンなオブジェクトと配列に変換
		const newRelationships = [
			...character.relationships.map(r => ({ characterId: r.characterId, relation: r.relation })),
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
			.map(r => ({ characterId: r.characterId, relation: r.relation }));

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
</script>

<div class="p:32 h:100% overflow:auto">
	<!-- ヘッダー -->
	<div class="flex justify-content:space-between align-items:center mb:24">
		<div>
			<h1 class="font:32 font:bold mb:8">キャラクター管理</h1>
			<p class="fg:gray-600">登場人物の情報と相関図を管理します</p>
		</div>
		<div class="flex gap:12">
			<div class="flex bg:gray-100 r:8 p:4">
				<button
					class="px:16 py:8 r:6 {viewMode === 'grid' ? 'bg:white shadow:1' : ''}"
					onclick={() => (viewMode = 'grid')}
				>
					グリッド
				</button>
				<button
					class="px:16 py:8 r:6 {viewMode === 'list' ? 'bg:white shadow:1' : ''}"
					onclick={() => (viewMode = 'list')}
				>
					リスト
				</button>
				<button
					class="px:16 py:8 r:6 {viewMode === 'graph' ? 'bg:white shadow:1' : ''}"
					onclick={() => (viewMode = 'graph')}
				>
					相関図
				</button>
			</div>
			<Button onclick={openCreateModal}>+ 新規キャラクター</Button>
		</div>
	</div>

	{#if isLoading}
		<div class="flex justify-content:center align-items:center h:400">
			<p class="fg:gray-600">読み込み中...</p>
		</div>
	{:else if viewMode === 'grid'}
		<!-- グリッドビュー -->
		<div class="grid cols:3 gap:16">
			{#each characters as character (character.id)}
				<Card class="p:20">
					<div class="flex flex:col align-items:center text-align:center mb:16">
						<div class="w:80 h:80 r:full bg:gray-200 flex align-items:center justify-content:center mb:12 font:32 fg:gray-500">
							{character.name.charAt(0)}
						</div>
						<h3 class="font:20 font:semibold mb:4">{character.name}</h3>
						<p class="fg:gray-600 font:14">{character.role}</p>
						{#if character.age || character.gender}
							<p class="fg:gray-500 font:12 mt:4">
								{character.age ? `${character.age}歳` : ''}{character.age && character.gender ? ' / ' : ''}{character.gender || ''}
							</p>
						{/if}
					</div>

					{#if character.personality}
						<div class="mb:12">
							<p class="font:12 font:semibold fg:gray-700 mb:4">性格</p>
							<p class="fg:gray-600 font:14 line-clamp:2">{character.personality}</p>
						</div>
					{/if}

					{#if character.relationships.length > 0}
						<div class="mb:12">
							<p class="font:12 font:semibold fg:gray-700 mb:4">関係</p>
							<div class="flex flex:wrap gap:4">
								{#each character.relationships.slice(0, 3) as rel}
									<span class="px:8 py:4 r:full bg:blue-50 fg:blue-700 font:12">
										{getCharacterName(rel.characterId)}
									</span>
								{/each}
								{#if character.relationships.length > 3}
									<span class="px:8 py:4 r:full bg:gray-100 fg:gray-700 font:12">
										+{character.relationships.length - 3}
									</span>
								{/if}
							</div>
						</div>
					{/if}

					<div class="flex gap:8">
						<button
							class="flex:1 px:12 py:8 bg:blue-50 fg:blue-600 r:6 font:14 hover:bg:blue-100"
							onclick={() => openEditModal(character)}
						>
							編集
						</button>
						<button
							class="flex:1 px:12 py:8 bg:purple-50 fg:purple-600 r:6 font:14 hover:bg:purple-100"
							onclick={() => openRelationModal(character)}
						>
							関係
						</button>
						<button
							class="px:12 py:8 bg:red-50 fg:red-600 r:6 font:14 hover:bg:red-100"
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
		<div class="flex flex:col gap:12">
			{#each characters as character (character.id)}
				<Card class="p:20">
					<div class="flex gap:16">
						<div class="w:60 h:60 r:full bg:gray-200 flex align-items:center justify-content:center font:24 fg:gray-500 flex-shrink:0">
							{character.name.charAt(0)}
						</div>
						<div class="flex:1">
							<div class="flex justify-content:space-between align-items:start mb:12">
								<div>
									<h3 class="font:18 font:semibold mb:4">{character.name}</h3>
									<p class="fg:gray-600 font:14">
										{character.role}
										{#if character.age || character.gender}
											• {character.age ? `${character.age}歳` : ''}{character.age && character.gender ? ' / ' : ''}{character.gender || ''}
										{/if}
									</p>
								</div>
								<div class="flex gap:8">
									<Button variant="secondary" onclick={() => openEditModal(character)}>
										編集
									</Button>
									<Button variant="secondary" onclick={() => openRelationModal(character)}>
										関係
									</Button>
									<Button variant="secondary" onclick={() => handleDelete(character.id)}>
										削除
									</Button>
								</div>
							</div>

							<div class="grid cols:3 gap:16">
								{#if character.appearance}
									<div>
										<p class="font:12 font:semibold fg:gray-700 mb:4">外見</p>
										<p class="fg:gray-600 font:14">{character.appearance}</p>
									</div>
								{/if}
								{#if character.personality}
									<div>
										<p class="font:12 font:semibold fg:gray-700 mb:4">性格</p>
										<p class="fg:gray-600 font:14">{character.personality}</p>
									</div>
								{/if}
								{#if character.background}
									<div>
										<p class="font:12 font:semibold fg:gray-700 mb:4">背景</p>
										<p class="fg:gray-600 font:14">{character.background}</p>
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
		<Card class="p:24">
			<div class="flex flex:wrap gap:24 justify-content:center">
				{#each characters as character (character.id)}
					<div class="flex flex:col align-items:center">
						<button
							class="w:80 h:80 r:full bg:blue-500 fg:white flex align-items:center justify-content:center font:24 mb:8 cursor:pointer hover:bg:blue-600 b:none"
							onclick={() => openRelationModal(character)}
						>
							{character.name.charAt(0)}
						</button>
						<p class="font:14 font:semibold mb:4">{character.name}</p>
						<p class="fg:gray-600 font:12">{character.role}</p>
						{#if character.relationships.length > 0}
							<div class="mt:12 flex flex:col gap:4">
								{#each getRelationships(character) as rel}
									<div class="flex align-items:center gap:8 px:12 py:6 bg:gray-50 r:6">
										<span class="font:12 fg:gray-700">{rel.relation}</span>
										<span class="font:12 font:semibold">→</span>
										<span class="font:12 fg:blue-600">{rel.name}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
			{#if characters.length === 0}
				<div class="flex justify-content:center align-items:center h:300">
					<p class="fg:gray-500">キャラクターがありません</p>
				</div>
			{/if}
		</Card>
	{/if}

	{#if characters.length === 0 && !isLoading}
		<div class="flex flex:col align-items:center justify-content:center h:400 gap:16">
			<p class="fg:gray-500 font:18">キャラクターがまだありません</p>
			<Button onclick={openCreateModal}>最初のキャラクターを作成</Button>
		</div>
	{/if}
</div>

<!-- 新規作成モーダル -->
<Modal bind:isOpen={showCreateModal} title="新規キャラクター作成">
	{#snippet children()}
		<div class="flex flex:col gap:16">
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
						class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
					/>
				</div>
				<Input label="性別" bind:value={formData.gender} placeholder="性別" />
			</div>

			<div>
				<label for="create-appearance" class="block mb:8 font:14 font:semibold">外見</label>
				<textarea
					id="create-appearance"
					bind:value={formData.appearance}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:80 resize:vertical font-family:inherit"
					placeholder="髪型、体格、服装など..."
				></textarea>
			</div>

			<div>
				<label for="create-personality" class="block mb:8 font:14 font:semibold">性格</label>
				<textarea
					id="create-personality"
					bind:value={formData.personality}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:80 resize:vertical font-family:inherit"
					placeholder="性格の特徴..."
				></textarea>
			</div>

			<div>
				<label for="create-background" class="block mb:8 font:14 font:semibold">背景</label>
				<textarea
					id="create-background"
					bind:value={formData.background}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:80 resize:vertical font-family:inherit"
					placeholder="生い立ち、経歴など..."
				></textarea>
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button variant="secondary" onclick={() => (showCreateModal = false)}>キャンセル</Button>
			<Button onclick={handleCreate} disabled={!formData.name.trim()}>作成</Button>
		</div>
	{/snippet}
</Modal>

<!-- 編集モーダル -->
<Modal bind:isOpen={showEditModal} title="キャラクター編集">
	{#snippet children()}
		<div class="flex flex:col gap:16">
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
						class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
					/>
				</div>
				<Input label="性別" bind:value={formData.gender} placeholder="性別" />
			</div>

			<div>
				<label for="edit-appearance" class="block mb:8 font:14 font:semibold">外見</label>
				<textarea
					id="edit-appearance"
					bind:value={formData.appearance}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:80 resize:vertical font-family:inherit"
					placeholder="髪型、体格、服装など..."
				></textarea>
			</div>

			<div>
				<label for="edit-personality" class="block mb:8 font:14 font:semibold">性格</label>
				<textarea
					id="edit-personality"
					bind:value={formData.personality}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:80 resize:vertical font-family:inherit"
					placeholder="性格の特徴..."
				></textarea>
			</div>

			<div>
				<label for="edit-background" class="block mb:8 font:14 font:semibold">背景</label>
				<textarea
					id="edit-background"
					bind:value={formData.background}
					class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500 min-h:80 resize:vertical font-family:inherit"
					placeholder="生い立ち、経歴など..."
				></textarea>
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button variant="secondary" onclick={() => (showEditModal = false)}>キャンセル</Button>
			<Button onclick={handleUpdate} disabled={!formData.name.trim()}>更新</Button>
		</div>
	{/snippet}
</Modal>

<!-- 関係編集モーダル -->
<Modal bind:isOpen={showRelationModal} title="キャラクター関係編集">
	{#snippet children()}
	{#if selectedCharacter}
		<div class="flex flex:col gap:16">
			<div class="p:16 bg:gray-50 r:8">
				<p class="font:14 fg:gray-600 mb:4">対象キャラクター</p>
				<p class="font:18 font:semibold">{selectedCharacter.name}</p>
			</div>

			<div>
				<p class="font:14 font:semibold mb:12">現在の関係</p>
				{#if selectedCharacter.relationships.length === 0}
					<p class="fg:gray-500 font:14">関係が登録されていません</p>
				{:else}
					<div class="flex flex:col gap:8">
						{#each getRelationships(selectedCharacter) as rel, index}
							<div class="flex align-items:center justify-content:space-between p:12 bg:gray-50 r:8">
								<div class="flex align-items:center gap:12">
									<span class="font:14">{rel.relation}</span>
									<span class="fg:gray-400">→</span>
									<span class="font:14 font:semibold">{rel.name}</span>
								</div>
								<button
									class="px:12 py:6 bg:red-50 fg:red-600 r:6 font:12 hover:bg:red-100"
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
						class="flex:1 px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
						id="relation-input"
					/>
					<select
						class="px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
						id="target-character"
					>
						<option value="">キャラクターを選択</option>
						{#each characters.filter((c) => c.id !== selectedCharacter?.id) as char}
							<option value={char.id}>{char.name}</option>
						{/each}
					</select>
					<Button
						onclick={() => {
							const relationInput = document.getElementById('relation-input') as HTMLInputElement;
							const targetSelect = document.getElementById('target-character') as HTMLSelectElement;
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
			<Button variant="secondary" onclick={() => (showRelationModal = false)}>閉じる</Button>
		</div>
	{/snippet}
</Modal>

<style>
	.line-clamp\:2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
