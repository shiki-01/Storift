<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { chaptersDB, scenesDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import { AutoSave, enableUnsavedWarning, enableVisibilityAutoSave } from '$lib/utils/autoSave';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SyncStatus from '$lib/components/ui/SyncStatus.svelte';
	import WritingAssistant from '$lib/components/ui/WritingAssistant.svelte';
	import PrintPreview from '$lib/components/ui/PrintPreview.svelte';
	import VersionManager from '$lib/components/ui/VersionManager.svelte';

	let isChapterModalOpen = $state(false);
	let isSceneModalOpen = $state(false);
	let newChapterTitle = $state('');
	let newSceneTitle = $state('');
	let selectedChapterId = $state<string | null>(null);
	let autoSave: AutoSave | null = null;
	
	// Phase 2: UI状態管理
	let showWritingAssistant = $state(false);
	let showPrintPreview = $state(false);
	let showVersionManager = $state(false);

	onMount(() => {
		// 初期化処理を即座に実行（非同期）
		(async () => {
			const { isFirebaseInitialized } = await import('$lib/firebase');
			const { syncStore } = await import('$lib/stores/sync.svelte');
			if (isFirebaseInitialized() && navigator.onLine && syncStore.status === 'offline') {
				syncStore.status = 'synced';
			}
		})();

		// 自動保存を初期化
		autoSave = new AutoSave({
			interval: 30000, // 30秒
			onSave: async () => {
				await handleSave();
			},
			isDirty: () => editorStore.isDirty && editorStore.currentScene !== null,
			onError: (error) => {
				console.error('Auto-save error:', error);
				alert('自動保存に失敗しました。手動で保存してください。');
			},
			onSuccess: () => {
				console.log('✅ Auto-saved');
			}
		});
		autoSave.start();

		// 離脱前の警告を有効化
		const removeWarning = enableUnsavedWarning(() => editorStore.isDirty);

		// タブ非表示時の自動保存を有効化
		const removeVisibilitySave = enableVisibilityAutoSave(async () => {
			if (editorStore.isDirty && editorStore.currentScene) {
				await handleSave();
			}
		});

		// クリーンアップ関数を同期的に返す
		return () => {
			if (autoSave) autoSave.stop();
			removeWarning();
			removeVisibilitySave();
		};
	});

	async function handleCreateChapter() {
		if (!newChapterTitle.trim() || !currentProjectStore.project) return;

		try {
			const chapter = await chaptersDB.create({
				projectId: currentProjectStore.project.id,
				title: newChapterTitle,
				synopsis: ''
			});
			currentProjectStore.chapters = [...currentProjectStore.chapters, chapter];
			isChapterModalOpen = false;
			newChapterTitle = '';

			// 同期キューに追加
			await queueChange('chapters', chapter.id, 'create');
		} catch (error) {
			console.error('Failed to create chapter:', error);
		}
	}

	async function handleCreateScene() {
		if (!newSceneTitle.trim() || !selectedChapterId || !currentProjectStore.project) return;

		try {
			const scene = await scenesDB.create({
				chapterId: selectedChapterId,
				projectId: currentProjectStore.project.id,
				title: newSceneTitle,
				content: ''
			});
			currentProjectStore.scenes = [...currentProjectStore.scenes, scene];
			isSceneModalOpen = false;
			newSceneTitle = '';
			editorStore.currentScene = scene;

			// 同期キューに追加
			await queueChange('scenes', scene.id, 'create');
		} catch (error) {
			console.error('Failed to create scene:', error);
		}
	}

	async function handleSave() {
		if (!editorStore.currentScene || !editorStore.isDirty) return;

		editorStore.isSaving = true;
		try {
			await scenesDB.update(editorStore.currentScene.id, {
				content: editorStore.content
			});
			editorStore.isDirty = false;

			// 更新後のシーンを再取得してストアを更新
			const updatedScene = await scenesDB.getById(editorStore.currentScene.id);
			if (updatedScene) {
				const index = currentProjectStore.scenes.findIndex((s) => s.id === updatedScene.id);
				if (index !== -1) {
					currentProjectStore.scenes[index] = updatedScene;
					editorStore.currentScene = updatedScene;
				}
			}

			// 同期キューに追加
			await queueChange('scenes', editorStore.currentScene.id, 'update');
		} catch (error) {
			console.error('Failed to save scene:', error);
		} finally {
			editorStore.isSaving = false;
		}
	}

	function handleSceneSelect(scene: (typeof currentProjectStore.scenes)[0]) {
		editorStore.currentScene = scene;
	}

	function openSceneModal(chapterId: string) {
		selectedChapterId = chapterId;
		isSceneModalOpen = true;
	}
</script>

<div class="flex w:100% h:100%">
	<!-- サイドバー -->
	<aside class="w:280 bg:white br:2px|solid|black flex flex-direction:column">
		<div class="flex-grow:1 overflow-y:auto p:16 pt:24px">
			<div class="flex justify-content:space-between align-items:center mb:12">
				<h3 class="font:14 font-weight:600 m:0">章・シーン</h3>
				<Button size="sm" onclick={() => (isChapterModalOpen = true)}>+ 章</Button>
			</div>

			{#each currentProjectStore.chapters as chapter (chapter.id)}
				<div class="mb:16">
					<div class="flex justify-content:space-between align-items:center mb:8">
						<h4 class="font:14 font-weight:500 m:0">{chapter.title}</h4>
						<button
							class="bg:transparent border:none cursor:pointer fg:gray-600 fg:blue-600:hover font:12 p:4"
							onclick={() => openSceneModal(chapter.id)}
						>
							+ シーン
						</button>
					</div>

					{#each currentProjectStore.scenesByChapter.get(chapter.id) || [] as scene (scene.id)}
						<button
							class="w:full text-align:left p:8 bg:transparent border:none cursor:pointer r:4 {editorStore
								.currentScene?.id === scene.id
								? 'bg:blue-50 fg:blue-700'
								: 'fg:gray-700 bg:gray-50:hover'}"
							onclick={() => handleSceneSelect(scene)}
						>
							<div class="font:13">{scene.title}</div>
							<div class="font:11 fg:gray-500">{scene.characterCount}文字</div>
						</button>
					{/each}
				</div>
			{/each}
		</div>

		<div class="p:16 border-top:1|solid|gray-200">
			<div class="font:12 fg:gray-600">
				合計: {currentProjectStore.totalCharacterCount.toLocaleString()}文字
			</div>
		</div>
	</aside>

	<!-- エディタエリア -->
	<div class="flex-grow:1 flex flex-direction:column">
		{#if !editorStore.currentScene}
			<div class="flex align-items:center justify-content:center h:full">
				<div class="text-align:center">
					<p class="fg:gray-600 font:16 mb:16">シーンを選択または作成してください</p>
					{#if currentProjectStore.chapters.length === 0}
						<Button onclick={() => (isChapterModalOpen = true)}>最初の章を作成</Button>
					{/if}
				</div>
			</div>
		{:else}
			<!-- ツールバー -->
			<div
				class="bg:white border-bottom:1|solid|gray-200 p:12|16 flex justify-content:space-between align-items:center"
			>
				<div class="flex align-items:center gap:16">
					<h3 class="font:16 font-weight:500 m:0">{editorStore.currentScene.title}</h3>
					<span class="font:13 fg:gray-600">{editorStore.characterCount}文字</span>
				</div>
				<div class="flex align-items:center gap:8">
					<!-- Phase 2: 執筆支援ツール -->
					<button
						class="p:8 r:6 hover:bg:gray-100 cursor:pointer transition:all|0.2s"
						onclick={() => showWritingAssistant = true}
						title="執筆支援"
					>
						📝
					</button>
					<button
						class="p:8 r:6 hover:bg:gray-100 cursor:pointer transition:all|0.2s"
						onclick={() => showPrintPreview = true}
						title="印刷プレビュー"
					>
						🖨️
					</button>
					<button
						class="p:8 r:6 hover:bg:gray-100 cursor:pointer transition:all|0.2s"
						onclick={() => showVersionManager = true}
						title="バージョン履歴"
					>
						📜
					</button>
					<div class="w:1 h:20 bg:gray-300"></div>
					<SyncStatus />
					<span class="font:13 fg:gray-600">
						{editorStore.isDirty ? '未保存' : editorStore.isSaving ? '保存中...' : '保存済み'}
					</span>
					<Button size="sm" onclick={handleSave} disabled={!editorStore.isDirty}>保存</Button>
				</div>
			</div>

			<!-- エディタ -->
			<div class="flex-grow:1 overflow-y:auto p:32 bg:gray-50">
				<div
					class="max-w:800 mx:auto bg:white p:48 r:8 box-shadow:0|2|8|rgba(0,0,0,0.08) min-h:full"
				>
					<textarea
						bind:value={editorStore.content}
						class="w:full h:full min-h:600 border:none outline:none resize:none font:16 line-height:2"
						placeholder="ここに執筆を開始..."
					></textarea>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- 章作成モーダル -->
<Modal bind:isOpen={isChapterModalOpen} title="新しい章を作成">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleCreateChapter();
		}}
	>
		<div class="mb:16">
			<label class="display:block font-weight:500 m:0|0|8|0" for="chapterTitle">章のタイトル</label>
			<Input bind:value={newChapterTitle} placeholder="第1章" required />
		</div>
		<div class="flex justify-content:flex-end gap:12">
			<Button type="button" variant="secondary" onclick={() => (isChapterModalOpen = false)}>
				キャンセル
			</Button>
			<Button type="submit" disabled={!newChapterTitle.trim()}>作成</Button>
		</div>
	</form>
</Modal>

<!-- シーン作成モーダル -->
<Modal bind:isOpen={isSceneModalOpen} title="新しいシーンを作成">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleCreateScene();
		}}
	>
		<div class="mb:16">
			<label class="display:block font-weight:500 m:0|0|8|0" for="sceneTitle"
				>シーンのタイトル</label
			>
			<Input bind:value={newSceneTitle} placeholder="オープニング" required />
		</div>
		<div class="flex justify-content:flex-end gap:12">
			<Button type="button" variant="secondary" onclick={() => (isSceneModalOpen = false)}>
				キャンセル
			</Button>
			<Button type="submit" disabled={!newSceneTitle.trim()}>作成</Button>
		</div>
	</form>
</Modal>

<!-- Phase 2: 執筆支援モーダル -->
{#if showWritingAssistant && editorStore.currentScene}
	<Modal 
		isOpen={showWritingAssistant}
		onClose={() => showWritingAssistant = false}
		title="執筆支援"
		size="large"
	>
		<WritingAssistant bind:text={editorStore.content} />
	</Modal>
{/if}

<!-- Phase 2: 印刷プレビュー -->
{#if showPrintPreview && currentProjectStore.project}
	<PrintPreview
		chapters={currentProjectStore.chapters.map(chapter => ({
			title: chapter.title,
			scenes: currentProjectStore.scenes
				.filter(scene => scene.chapterId === chapter.id)
				.map(scene => ({
					title: scene.title,
					content: scene.content
				}))
		}))}
		isOpen={showPrintPreview}
		onClose={() => showPrintPreview = false}
	/>
{/if}

<!-- Phase 2: バージョン管理 -->
{#if showVersionManager && editorStore.currentScene && currentProjectStore.project}
	<Modal
		isOpen={showVersionManager}
		onClose={() => showVersionManager = false}
		title="バージョン履歴"
		size="large"
	>
		<VersionManager
			entityType="scene"
			entityId={editorStore.currentScene.id}
			projectId={currentProjectStore.project.id}
		/>
	</Modal>
{/if}
