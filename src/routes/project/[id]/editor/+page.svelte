<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { chaptersDB, scenesDB, settingsDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import { AutoSave, enableUnsavedWarning, enableVisibilityAutoSave } from '$lib/utils/autoSave';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SyncStatus from '$lib/components/ui/SyncStatus.svelte';
	import WritingAssistant from '$lib/components/ui/WritingAssistant.svelte';
	import PrintPreview from '$lib/components/ui/PrintPreview.svelte';
	import VersionManager from '$lib/components/ui/VersionManager.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import FontSelector from '$lib/components/ui/FontSelector.svelte';
	import { createEditorContextMenu, createChapterContextMenu, createSceneContextMenu, type ContextMenuItem } from '$lib/utils/contextMenu';
	import type { Chapter, Scene, EditorFont } from '$lib/types';

	let isChapterModalOpen = $state(false);
	let isSceneModalOpen = $state(false);
	let isRenameModalOpen = $state(false);
	let newChapterTitle = $state('');
	let newSceneTitle = $state('');
	let renameValue = $state('');
	let selectedChapterId = $state<string | null>(null);
	let autoSave: AutoSave | null = null;
	
	// Phase 2: UI状態管理
	let showWritingAssistant = $state(false);
	let showPrintPreview = $state(false);
	let showVersionManager = $state(false);

	// コンテキストメニュー
	let contextMenu = $state<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
		targetType?: 'editor' | 'chapter' | 'scene';
		targetId?: string;
	}>({ visible: false, x: 0, y: 0, items: [] });

	let editorTextarea = $state<HTMLTextAreaElement | null>(null);

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

	const handleCreateChapter = async() => {
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

	const handleCreateScene = async() => {
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

	const handleSave = async() => {
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

	// コンテキストメニュー - エディター
	function handleEditorContextMenu(e: MouseEvent) {
		e.preventDefault();
		
		const hasSelection = editorTextarea ? 
			editorTextarea.selectionStart !== editorTextarea.selectionEnd : false;

		const items = createEditorContextMenu({
			scene: editorStore.currentScene,
			chapter: currentProjectStore.chapters.find(c => 
				c.id === editorStore.currentScene?.chapterId
			) || null,
			hasSelection,
			onSave: handleSave,
			onCopy: () => document.execCommand('copy'),
			onCut: () => document.execCommand('cut'),
			onPaste: () => document.execCommand('paste'),
			onSelectAll: () => editorTextarea?.select(),
			onRename: () => handleRenameScene(editorStore.currentScene!),
			onDelete: () => handleDeleteScene(editorStore.currentScene!),
			onDuplicate: () => handleDuplicateScene(editorStore.currentScene!),
			onExport: () => showPrintPreview = true,
			onPrint: () => showPrintPreview = true,
			onVersionHistory: () => showVersionManager = true
		});

		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items,
			targetType: 'editor'
		};
	}

	// コンテキストメニュー - チャプター
	function handleChapterContextMenu(e: MouseEvent, chapter: Chapter) {
		e.preventDefault();
		e.stopPropagation();

		const chapterIndex = currentProjectStore.chapters.findIndex(c => c.id === chapter.id);
		const items = createChapterContextMenu({
			chapter,
			onRename: () => handleRenameChapter(chapter),
			onDelete: () => handleDeleteChapter(chapter),
			onDuplicate: () => handleDuplicateChapter(chapter),
			onAddScene: () => openSceneModal(chapter.id),
			onMoveUp: chapterIndex > 0 ? () => handleMoveChapter(chapter, 'up') : undefined,
			onMoveDown: chapterIndex < currentProjectStore.chapters.length - 1 ? () => handleMoveChapter(chapter, 'down') : undefined,
			canMoveUp: chapterIndex > 0,
			canMoveDown: chapterIndex < currentProjectStore.chapters.length - 1
		});

		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items,
			targetType: 'chapter',
			targetId: chapter.id
		};
	}

	// コンテキストメニュー - シーン
	function handleSceneContextMenu(e: MouseEvent, scene: Scene) {
		e.preventDefault();
		e.stopPropagation();

		const chapterScenes = currentProjectStore.scenesByChapter.get(scene.chapterId) || [];
		const sceneIndex = chapterScenes.findIndex(s => s.id === scene.id);

		const items = createSceneContextMenu({
			scene,
			onOpen: () => handleSceneSelect(scene),
			onRename: () => handleRenameScene(scene),
			onDelete: () => handleDeleteScene(scene),
			onDuplicate: () => handleDuplicateScene(scene),
			onMoveUp: sceneIndex > 0 ? () => handleMoveScene(scene, 'up') : undefined,
			onMoveDown: sceneIndex < chapterScenes.length - 1 ? () => handleMoveScene(scene, 'down') : undefined,
			canMoveUp: sceneIndex > 0,
			canMoveDown: sceneIndex < chapterScenes.length - 1
		});

		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items,
			targetType: 'scene',
			targetId: scene.id
		};
	}

	// リネーム処理
	async function handleRenameChapter(chapter: Chapter) {
		renameValue = chapter.title;
		isRenameModalOpen = true;
		contextMenu.targetType = 'chapter';
		contextMenu.targetId = chapter.id;
	}

	async function handleRenameScene(scene: Scene) {
		renameValue = scene.title;
		isRenameModalOpen = true;
		contextMenu.targetType = 'scene';
		contextMenu.targetId = scene.id;
	}

	const applyRename = async() => {
		if (!renameValue.trim() || !contextMenu.targetId) return;

		try {
			if (contextMenu.targetType === 'chapter') {
				await chaptersDB.update(contextMenu.targetId, { title: renameValue });
				const updatedChapter = await chaptersDB.getById(contextMenu.targetId);
				if (updatedChapter) {
					const index = currentProjectStore.chapters.findIndex(c => c.id === contextMenu.targetId);
					if (index !== -1) {
						currentProjectStore.chapters[index] = updatedChapter;
					}
				}
				await queueChange('chapters', contextMenu.targetId, 'update');
			} else if (contextMenu.targetType === 'scene') {
				await scenesDB.update(contextMenu.targetId, { title: renameValue });
				const updatedScene = await scenesDB.getById(contextMenu.targetId);
				if (updatedScene) {
					const index = currentProjectStore.scenes.findIndex(s => s.id === contextMenu.targetId);
					if (index !== -1) {
						currentProjectStore.scenes[index] = updatedScene;
					}
					if (editorStore.currentScene?.id === contextMenu.targetId) {
						editorStore.currentScene = updatedScene;
					}
				}
				await queueChange('scenes', contextMenu.targetId, 'update');
			}
			isRenameModalOpen = false;
			renameValue = '';
		} catch (error) {
			console.error('Failed to rename:', error);
			alert('名前の変更に失敗しました');
		}
	}

	// 削除処理
	async function handleDeleteChapter(chapter: Chapter) {
		if (!confirm(`章「${chapter.title}」とそのシーンを削除しますか？`)) return;

		try {
			// チャプター内のシーンを削除
			const scenes = currentProjectStore.scenesByChapter.get(chapter.id) || [];
			for (const scene of scenes) {
				await scenesDB.delete(scene.id);
				await queueChange('scenes', scene.id, 'delete');
			}

			await chaptersDB.delete(chapter.id);
			await queueChange('chapters', chapter.id, 'delete');

			currentProjectStore.chapters = currentProjectStore.chapters.filter(c => c.id !== chapter.id);
			currentProjectStore.scenes = currentProjectStore.scenes.filter(s => s.chapterId !== chapter.id);
			
			if (editorStore.currentScene?.chapterId === chapter.id) {
				editorStore.currentScene = null;
			}
		} catch (error) {
			console.error('Failed to delete chapter:', error);
			alert('章の削除に失敗しました');
		}
	}

	async function handleDeleteScene(scene: Scene) {
		if (!confirm(`シーン「${scene.title}」を削除しますか？`)) return;

		try {
			await scenesDB.delete(scene.id);
			await queueChange('scenes', scene.id, 'delete');
			
			currentProjectStore.scenes = currentProjectStore.scenes.filter(s => s.id !== scene.id);
			
			if (editorStore.currentScene?.id === scene.id) {
				editorStore.currentScene = null;
			}
		} catch (error) {
			console.error('Failed to delete scene:', error);
			alert('シーンの削除に失敗しました');
		}
	}

	// 複製処理
	async function handleDuplicateChapter(chapter: Chapter) {
		if (!currentProjectStore.project) return;

		try {
			const newChapter = await chaptersDB.create({
				projectId: currentProjectStore.project.id,
				title: `${chapter.title} (コピー)`,
				synopsis: chapter.synopsis
			});
			
			currentProjectStore.chapters = [...currentProjectStore.chapters, newChapter];
			await queueChange('chapters', newChapter.id, 'create');

			// シーンも複製
			const scenes = currentProjectStore.scenesByChapter.get(chapter.id) || [];
			for (const scene of scenes) {
				const newScene = await scenesDB.create({
					chapterId: newChapter.id,
					projectId: currentProjectStore.project.id,
					title: scene.title,
					content: scene.content
				});
				currentProjectStore.scenes = [...currentProjectStore.scenes, newScene];
				await queueChange('scenes', newScene.id, 'create');
			}
		} catch (error) {
			console.error('Failed to duplicate chapter:', error);
			alert('章の複製に失敗しました');
		}
	}

	async function handleDuplicateScene(scene: Scene) {
		if (!currentProjectStore.project) return;

		try {
			const newScene = await scenesDB.create({
				chapterId: scene.chapterId,
				projectId: currentProjectStore.project.id,
				title: `${scene.title} (コピー)`,
				content: scene.content
			});
			
			currentProjectStore.scenes = [...currentProjectStore.scenes, newScene];
			await queueChange('scenes', newScene.id, 'create');
		} catch (error) {
			console.error('Failed to duplicate scene:', error);
			alert('シーンの複製に失敗しました');
		}
	}

	// 移動処理
	async function handleMoveChapter(chapter: Chapter, direction: 'up' | 'down') {
		const chapters = [...currentProjectStore.chapters];
		const index = chapters.findIndex(c => c.id === chapter.id);
		if (index === -1) return;

		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= chapters.length) return;

		// 順序を入れ替え
		[chapters[index], chapters[newIndex]] = [chapters[newIndex], chapters[index]];
		
		// order を更新
		for (let i = 0; i < chapters.length; i++) {
			await chaptersDB.update(chapters[i].id, { order: i });
			await queueChange('chapters', chapters[i].id, 'update');
		}

		currentProjectStore.chapters = chapters;
	}

	async function handleMoveScene(scene: Scene, direction: 'up' | 'down') {
		const chapterScenes = [...(currentProjectStore.scenesByChapter.get(scene.chapterId) || [])];
		const index = chapterScenes.findIndex(s => s.id === scene.id);
		if (index === -1) return;

		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= chapterScenes.length) return;

		// 順序を入れ替え
		[chapterScenes[index], chapterScenes[newIndex]] = [chapterScenes[newIndex], chapterScenes[index]];
		
		// order を更新
		for (let i = 0; i < chapterScenes.length; i++) {
			await scenesDB.update(chapterScenes[i].id, { order: i });
			await queueChange('scenes', chapterScenes[i].id, 'update');
		}

		// ストアを更新
		const allScenes = currentProjectStore.scenes.map(s => {
			const updated = chapterScenes.find(cs => cs.id === s.id);
			return updated || s;
		});
		currentProjectStore.scenes = allScenes;
	}

	// フォント変更処理
	async function handleFontChange(font: EditorFont) {
		settingsStore.editorFont = font;
		try {
			await settingsDB.update({ editorFont: font });
		} catch (error) {
			console.error('Failed to save font setting:', error);
		}
	}

	// フォントファミリーを取得
	function getFontFamily(font: EditorFont): string {
		const fontMap: Record<EditorFont, string> = {
			'yu-gothic': '"Yu Gothic", "YuGothic", sans-serif',
			'gen-shin-mincho': '"Gen Shin Mincho", "源ノ明朝", serif',
			'hiragino-mincho': '"Hiragino Mincho ProN", "ヒラギノ明朝 ProN", serif',
			'noto-sans': '"Noto Sans JP", sans-serif',
			'noto-serif': '"Noto Serif JP", serif',
			'hannari-mincho': '"Hannari", "はんなり明朝", serif',
			'sawarabi-mincho': '"Sawarabi Mincho", "さわらび明朝", serif',
			'sawarabi-gothic': '"Sawarabi Gothic", "さわらびゴシック", sans-serif'
		};
		return fontMap[font] || fontMap['yu-gothic'];
	}
</script>

<div class="flex w:100% h:100%">
	<!-- サイドバー -->
	<aside class="w:280 bg:$(theme.surface) br:2px|solid|$(theme.border) flex flex-direction:column">
		<div class="flex-grow:1 overflow-y:auto p:16 pt:24px">
			<div class="flex justify-content:space-between align-items:center mb:12">
				<h3 class="font:14 font-weight:600 m:0 fg:$(theme.text)">章・シーン</h3>
				<Button size="sm" onclick={() => (isChapterModalOpen = true)}>+ 章</Button>
			</div>

			{#each currentProjectStore.chapters as chapter (chapter.id)}
				<div class="mb:16">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div 
						class="flex justify-content:space-between align-items:center mb:8"
						oncontextmenu={(e) => handleChapterContextMenu(e, chapter)}
					>
						<h4 class="font:14 font-weight:500 m:0 fg:$(theme.text)">{chapter.title}</h4>
						<button
							class="bg:transparent border:none cursor:pointer fg:$(theme.text-secondary) fg:$(theme.primary):hover font:12 p:4"
							onclick={() => openSceneModal(chapter.id)}
						>
							+ シーン
						</button>
					</div>

					{#each currentProjectStore.scenesByChapter.get(chapter.id) || [] as scene (scene.id)}
						<button
							class="w:full text-align:left p:8 bg:transparent border:none cursor:pointer r:4 {editorStore
								.currentScene?.id === scene.id
								? 'bg:$(theme.primary)/.1 fg:$(theme.primary)'
								: 'fg:$(theme.text) bg:$(theme.surface):hover'}"
							onclick={() => handleSceneSelect(scene)}
							oncontextmenu={(e) => handleSceneContextMenu(e, scene)}
						>
							<div class="font:13">{scene.title}</div>
							<div class="font:11 fg:$(theme.text-secondary)">{scene.characterCount}文字</div>
						</button>
					{/each}
				</div>
			{/each}
		</div>

		<div class="p:16 border-top:1|solid|$(theme.border)">
			<div class="font:12 fg:$(theme.text-secondary)">
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
				class="bg:$(theme.surface) border-bottom:1|solid|$(theme.border) p:12|16 flex justify-content:space-between align-items:center"
			>
				<div class="flex align-items:center gap:16">
					<h3 class="font:16 font-weight:500 m:0 fg:$(theme.text)">{editorStore.currentScene.title}</h3>
					<span class="font:13 fg:$(theme.text-secondary)">{editorStore.characterCount}文字</span>
				</div>
				<div class="flex align-items:center gap:8">
					<!-- フォント選択 -->
					<FontSelector value={settingsStore.editorFont} onchange={handleFontChange} />
					<div class="w:1 h:20 bg:$(theme.border)"></div>
					<!-- Phase 2: 執筆支援ツール -->
					<button
						class="p:8 r:6 hover:bg:$(theme.surface) cursor:pointer transition:all|0.2s"
						onclick={() => showWritingAssistant = true}
						title="執筆支援"
					>
						📝
					</button>
					<button
						class="p:8 r:6 hover:bg:$(theme.surface) cursor:pointer transition:all|0.2s"
						onclick={() => showPrintPreview = true}
						title="印刷プレビュー"
					>
						🖨️
					</button>
					<button
						class="p:8 r:6 hover:bg:$(theme.surface) cursor:pointer transition:all|0.2s"
						onclick={() => showVersionManager = true}
						title="バージョン履歴"
					>
						📜
					</button>
					<div class="w:1 h:20 bg:$(theme.border)"></div>
					<SyncStatus />
					<span class="font:13 fg:$(theme.text-secondary)">
						{editorStore.isDirty ? '未保存' : editorStore.isSaving ? '保存中...' : '保存済み'}
					</span>
					<Button size="sm" onclick={handleSave} disabled={!editorStore.isDirty}>保存</Button>
				</div>
			</div>

			<!-- エディタ -->
			<div class="flex-grow:1 overflow-y:auto p:32 bg:$(editor.background)">
				<div
					class="max-w:800 mx:auto bg:$(theme.background) p:48 r:8 box-shadow:0|2|8|rgba(0,0,0,0.08) min-h:full h:fit"
				>
					<textarea
						bind:this={editorTextarea}
						bind:value={editorStore.content}
						class="w:full h:fit min-h:600 border:none outline:none resize:none font:16 line-height:2 bg:$(editor.background) fg:$(editor.text)"
                        style="field-sizing: content; font-family: {getFontFamily(settingsStore.editorFont)};"
						placeholder="ここに執筆を開始..."
						oncontextmenu={handleEditorContextMenu}
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

<!-- リネームモーダル -->
<Modal bind:isOpen={isRenameModalOpen} title="名前を変更">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			applyRename();
		}}
	>
		<div class="mb:16">
			<label class="display:block font-weight:500 m:0|0|8|0" for="renameValue">新しい名前</label>
			<Input bind:value={renameValue} placeholder="名前を入力" required />
		</div>
		<div class="flex justify-content:flex-end gap:12">
			<Button type="button" variant="secondary" onclick={() => (isRenameModalOpen = false)}>
				キャンセル
			</Button>
			<Button type="submit" disabled={!renameValue.trim()}>変更</Button>
		</div>
	</form>
</Modal>

<!-- コンテキストメニュー -->
<ContextMenu
	visible={contextMenu.visible}
	x={contextMenu.x}
	y={contextMenu.y}
	items={contextMenu.items}
	onClose={() => contextMenu.visible = false}
/>
