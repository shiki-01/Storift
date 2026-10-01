<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirmDialog } from '$lib/stores/confirm.svelte';
	import { db, chaptersDB, scenesDB, settingsDB, recordWritingProgress } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import { AutoSave, enableUnsavedWarning, enableVisibilityAutoSave } from '$lib/utils/autoSave';
	import { matchesShortcut } from '$lib/utils/shortcuts';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SyncStatus from '$lib/components/ui/SyncStatus.svelte';
	import WritingAssistant from '$lib/components/ui/WritingAssistant.svelte';
	import PrintPreview from '$lib/components/ui/PrintPreview.svelte';
	import VersionManager from '$lib/components/ui/VersionManager.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import FontSelector from '$lib/components/ui/FontSelector.svelte';
	import SearchReplace from '$lib/components/ui/SearchReplace.svelte';
	import HistoryViewer from '$lib/components/ui/HistoryViewer.svelte';
	import ExportModal from '$lib/components/ui/ExportModal.svelte';
	import ProofreadPanel from '$lib/components/editor/ProofreadPanel.svelte';
	import PreviewViewer from '$lib/components/preview/PreviewViewer.svelte';
	import PreviewSettings from '$lib/components/preview/PreviewSettings.svelte';
	import SceneExportModal from '$lib/components/ui/SceneExportModal.svelte';
	import {
		createEditorContextMenu,
		createChapterContextMenu,
		createSceneContextMenu,
		type ContextMenuItem
	} from '$lib/utils/contextMenu';
	import type {
		Chapter,
		Scene,
		EditorFont,
		EditorFormatting,
		PreviewSettings as PreviewSettingsType,
		ViewMode
	} from '$lib/types';
	import { defaultPreviewSettings } from '$lib/types';
	import Icon from '$lib/components/ui/Icon.svelte';

	const DEFAULT_FORMATTING: EditorFormatting = {
		fontSize: 16,
		lineHeight: 2,
		letterSpacing: 0,
		paragraphSpacing: 16
	};

	let isChapterModalOpen = $state(false);
	let isSceneModalOpen = $state(false);
	let isRenameModalOpen = $state(false);
	let isTargetModalOpen = $state(false);
	let newChapterTitle = $state('');
	let newSceneTitle = $state('');
	let renameValue = $state('');
	let renameTarget = $state<{ type: 'chapter' | 'scene'; id: string } | null>(null);
	let targetValue = $state('');
	let targetSceneId = $state<string | null>(null);
	let selectedChapterId = $state<string | null>(null);

	// Phase 2: UI状態管理
	let showWritingAssistant = $state(false);
	let showPrintPreview = $state(false);
	let showVersionManager = $state(false);
	let showFormattingModal = $state(false);
	let showExportModal = $state(false);
	let showSearch = $state(false);
	let showProofread = $state(false);
	let showHistory = $state(false);
	let showProjectExport = $state(false);
	let isSidebarOpen = $state(true);

	// 全画面（集中）モード
	let isFocusMode = $state(false);
	let usesNativeFullscreen = false;

	// モバイル判定（ツールバーの折りたたみに使う）
	let isMobile = $state(false);

	// プレビュー機能
	let viewMode = $state<ViewMode>('editor');

	// 書式設定モーダル
	let formattingTab = $state<'editor' | 'preview'>('editor');
	// モーダル内で編集中の値。「保存」するまでエディタには反映しない
	let draftFormatting = $state<EditorFormatting>({ ...DEFAULT_FORMATTING });
	let draftFont = $state<EditorFont>('yu-gothic');
	let draftPreview = $state<PreviewSettingsType>({ ...defaultPreviewSettings });

	// エディタに適用済みの設定
	const formatting = $derived(settingsStore.editorFormatting ?? DEFAULT_FORMATTING);
	const appliedPreview = $derived(settingsStore.previewSettings);
	const isVertical = $derived(settingsStore.editorWritingMode === 'vertical');

	// コンテキストメニュー
	let contextMenu = $state<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
	}>({ visible: false, x: 0, y: 0, items: [] });

	let editorDiv = $state<HTMLDivElement | null>(null);
	let editorScrollContainer = $state<HTMLDivElement | null>(null);
	let previewViewerRef = $state<{ scrollToTop?: () => void } | null>(null);
	let lastSceneId = $state<string | null>(null);
	// 右クリック時点の選択範囲（メニュー操作でフォーカスが外れても復元できるように保持）
	let savedRange: Range | null = null;

	// サイドバー: 検索・折りたたみ・ドラッグ&ドロップ
	let sceneQuery = $state('');
	let collapsedChapters = $state<string[]>([]);
	type DragItem = { type: 'scene' | 'chapter'; id: string };
	type DropTarget = {
		type: 'scene' | 'chapter' | 'chapter-into';
		id: string;
		pos: 'before' | 'after';
	};
	let dragItem = $state<DragItem | null>(null);
	let dropTarget = $state<DropTarget | null>(null);

	const sortedChapters = $derived(
		[...currentProjectStore.chapters].sort((a, b) => a.order - b.order)
	);

	const normalizedQuery = $derived(sceneQuery.trim().toLowerCase());

	// 検索中は一致するシーンを持つ章だけを表示する
	const visibleChapters = $derived.by(() => {
		const byChapter = currentProjectStore.scenesByChapter;
		return sortedChapters
			.map((chapter) => {
				const all = byChapter.get(chapter.id) ?? [];
				const scenes = normalizedQuery
					? all.filter(
							(s) =>
								s.title.toLowerCase().includes(normalizedQuery) ||
								s.content.toLowerCase().includes(normalizedQuery)
						)
					: all;
				return { chapter, scenes, total: all.length };
			})
			.filter((entry) => !normalizedQuery || entry.scenes.length > 0);
	});

	const collapsedKey = () => `storift:collapsedChapters:${currentProjectStore.project?.id ?? ''}`;

	function toggleCollapsed(chapterId: string) {
		collapsedChapters = collapsedChapters.includes(chapterId)
			? collapsedChapters.filter((id) => id !== chapterId)
			: [...collapsedChapters, chapterId];
		try {
			localStorage.setItem(collapsedKey(), JSON.stringify(collapsedChapters));
		} catch {
			// 保存できなくても動作には影響しない
		}
	}

	// 表示モード切替
	const viewModes: { value: ViewMode; label: string; icon: string }[] = [
		{ value: 'editor', label: 'エディタのみ', icon: 'edit' },
		{ value: 'split', label: '二画面表示', icon: 'layout-columns' },
		{ value: 'preview', label: 'プレビューのみ', icon: 'eye' }
	];

	onMount(() => {
		const media = window.matchMedia('(max-width: 768px)');
		isMobile = media.matches;
		const onMediaChange = (e: MediaQueryListEvent) => (isMobile = e.matches);
		media.addEventListener('change', onMediaChange);

		try {
			const stored = localStorage.getItem(collapsedKey());
			if (stored) collapsedChapters = JSON.parse(stored);
		} catch {
			collapsedChapters = [];
		}

		// 初期化処理を即座に実行（非同期）
		(async () => {
			const { isFirebaseInitialized } = await import('$lib/firebase');
			const { syncStore } = await import('$lib/stores/sync.svelte');
			if (isFirebaseInitialized() && navigator.onLine && syncStore.status === 'offline') {
				syncStore.status = 'synced';
			}

			// 設定を読み込む
			try {
				const saved = await settingsDB.get();
				if (saved) {
					settingsStore.settings = saved;
				}
			} catch (error) {
				console.error('Failed to load settings:', error);
			}
		})();

		// キーボードショートカット（設定の shortcuts に従う）
		const handleKeyDown = (e: KeyboardEvent) => {
			const shortcuts = settingsStore.shortcuts;
			if (matchesShortcut(e, shortcuts?.save)) {
				e.preventDefault();
				void handleSave();
				return;
			}
			if (e.key === 'Escape' && isFocusMode && !usesNativeFullscreen && !isAnyModalOpen()) {
				exitFocusMode();
				return;
			}
			if (isAnyModalOpen()) return;
			if (matchesShortcut(e, shortcuts?.find) || matchesShortcut(e, shortcuts?.replace)) {
				e.preventDefault();
				void openSearch();
			} else if (matchesShortcut(e, shortcuts?.newChapter)) {
				e.preventDefault();
				isChapterModalOpen = true;
			} else if (matchesShortcut(e, shortcuts?.newScene)) {
				const chapterId =
					editorStore.currentScene?.chapterId ?? selectedChapterId ?? sortedChapters[0]?.id;
				if (chapterId) {
					e.preventDefault();
					openSceneModal(chapterId);
				}
			}
		};
		window.addEventListener('keydown', handleKeyDown);

		// 離脱前の警告を有効化
		const removeWarning = enableUnsavedWarning(() => editorStore.isDirty);

		// タブ非表示時の自動保存を有効化（自動保存が無効なら行わない）
		const removeVisibilitySave = enableVisibilityAutoSave(async () => {
			if (settingsStore.autoSave && editorStore.isDirty && editorStore.currentScene) {
				await handleSave({ silent: true });
			}
		});

		// クリーンアップ関数を同期的に返す
		return () => {
			removeWarning();
			removeVisibilitySave();
			window.removeEventListener('keydown', handleKeyDown);
			media.removeEventListener('change', onMediaChange);
		};
	});

	// 自動保存: 設定（有効/無効・間隔）の変更に追従して作り直す
	$effect(() => {
		if (!settingsStore.autoSave) return;
		const autoSave = new AutoSave({
			interval: settingsStore.autoSaveIntervalMs,
			onSave: async () => {
				await handleSave({ silent: true });
			},
			isDirty: () => editorStore.isDirty && editorStore.currentScene !== null,
			onError: (error) => {
				console.error('Auto-save error:', error);
				toast.error('自動保存に失敗しました。手動で保存してください。');
			}
		});
		autoSave.start();
		return () => autoSave.stop();
	});

	$effect(() => {
		const currentId = editorStore.currentScene?.id ?? null;
		if (!currentId || currentId === lastSceneId) return;
		lastSceneId = currentId;
		void tick().then(() => {
			editorScrollContainer?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
			previewViewerRef?.scrollToTop?.();
		});
	});

	function isAnyModalOpen() {
		return (
			isChapterModalOpen ||
			isSceneModalOpen ||
			isRenameModalOpen ||
			isTargetModalOpen ||
			showWritingAssistant ||
			showPrintPreview ||
			showVersionManager ||
			showFormattingModal ||
			showExportModal ||
			showSearch ||
			showProofread ||
			showHistory ||
			showProjectExport
		);
	}

	// ---------- 作成 ----------

	const handleCreateChapter = async () => {
		if (!newChapterTitle.trim() || !currentProjectStore.project) return;

		try {
			const chapter = await chaptersDB.create({
				projectId: currentProjectStore.project.id,
				title: newChapterTitle.trim(),
				synopsis: ''
			});
			currentProjectStore.chapters = [...currentProjectStore.chapters, chapter];
			isChapterModalOpen = false;
			newChapterTitle = '';
			toast.success(`章「${chapter.title}」を作成しました`);

			// 同期キューに追加
			await queueChange('chapters', chapter.id, 'create');
		} catch (error) {
			console.error('Failed to create chapter:', error);
			toast.error('章の作成に失敗しました');
		}
	};

	const handleCreateScene = async () => {
		if (!newSceneTitle.trim() || !selectedChapterId || !currentProjectStore.project) return;

		try {
			const scene = await scenesDB.create({
				chapterId: selectedChapterId,
				projectId: currentProjectStore.project.id,
				title: newSceneTitle.trim(),
				content: ''
			});
			currentProjectStore.scenes = [...currentProjectStore.scenes, scene];
			isSceneModalOpen = false;
			newSceneTitle = '';
			toast.success(`シーン「${scene.title}」を作成しました`);
			await handleSceneSelect(scene);

			// 同期キューに追加
			await queueChange('scenes', scene.id, 'create');
		} catch (error) {
			console.error('Failed to create scene:', error);
			toast.error('シーンの作成に失敗しました');
		}
	};

	// ---------- 保存 ----------

	// 進捗記録用: シーンごとの前回保存時の文字数（未保存なら DB 上の characterCount を基準にする）
	const lastSavedCounts = new SvelteMap<string, number>();

	const handleSave = async (options: { silent?: boolean } = {}) => {
		const scene = editorStore.currentScene;
		if (!scene || !editorStore.isDirty || editorStore.isSaving) return;

		const savedContent = editorStore.content;
		editorStore.isSaving = true;
		try {
			await scenesDB.update(scene.id, { content: savedContent });

			// 更新後のシーンを再取得してストアを更新
			const updatedScene = await scenesDB.getById(scene.id);
			if (updatedScene) {
				const index = currentProjectStore.scenes.findIndex((s) => s.id === updatedScene.id);
				if (index !== -1) {
					currentProjectStore.scenes[index] = updatedScene;
				}
				// 保存中に入力が続いていた場合は、本文を巻き戻さない
				if (editorStore.currentScene?.id === scene.id && editorStore.content === savedContent) {
					editorStore.currentScene = updatedScene;
				}
			}
			if (editorStore.currentScene?.id === scene.id && editorStore.content === savedContent) {
				editorStore.isDirty = false;
			}

			// 執筆文字数の増減を進捗ログに記録する（失敗しても保存自体は成功扱い）
			const previousCount = lastSavedCounts.get(scene.id) ?? scene.characterCount;
			lastSavedCounts.set(scene.id, savedContent.length);
			try {
				await recordWritingProgress(scene.projectId, savedContent.length - previousCount, scene.id);
			} catch (error) {
				console.error('Failed to record writing progress:', error);
			}

			if (!options.silent) toast.success('保存しました');

			// 同期キューに追加
			await queueChange('scenes', scene.id, 'update');
		} catch (error) {
			console.error('Failed to save scene:', error);
			toast.error('保存に失敗しました');
		} finally {
			editorStore.isSaving = false;
		}
	};

	async function handleSceneSelect(scene: Scene) {
		if (editorStore.currentScene?.id !== scene.id && editorStore.isDirty) {
			await handleSave({ silent: true });
			if (editorStore.isDirty) {
				const discard = await confirmDialog({
					title: '未保存の変更',
					message: '保存できていない変更があります。破棄して移動しますか？',
					confirmText: '破棄して移動',
					danger: true
				});
				if (!discard) return;
			}
		}
		editorStore.currentScene = scene;
		if (window.matchMedia('(max-width: 1024px)').matches) {
			isSidebarOpen = false;
		}
	}

	function openSceneModal(chapterId: string) {
		selectedChapterId = chapterId;
		isSceneModalOpen = true;
	}

	// 検索・置換（DB を直接書き換えるため、開く前に保存し、閉じたら読み込み直す）
	async function openSearch() {
		await handleSave({ silent: true });
		showSearch = true;
	}

	async function closeSearch() {
		showSearch = false;
		// 置換による文字数の変化は執筆量に含めない
		lastSavedCounts.clear();
		const project = currentProjectStore.project;
		if (!project) return;
		try {
			const [chapters, scenes] = await Promise.all([
				chaptersDB.getByProjectId(project.id),
				scenesDB.getByProjectId(project.id)
			]);
			currentProjectStore.chapters = chapters;
			currentProjectStore.scenes = scenes;
			const currentId = editorStore.currentScene?.id;
			if (currentId && !editorStore.isDirty) {
				const fresh = scenes.find((s) => s.id === currentId) ?? null;
				if (!fresh || fresh.content !== editorStore.content) {
					editorStore.currentScene = fresh;
				}
			}
		} catch (error) {
			console.error('Failed to reload project:', error);
			toast.error('プロジェクトの再読み込みに失敗しました');
		}
	}

	function handleHistoryRestore(snapshot: Scene | undefined) {
		if (!snapshot || snapshot.id !== editorStore.currentScene?.id) return;
		editorStore.content = snapshot.content;
		toast.info('履歴の内容を読み込みました。保存すると確定します');
	}

	// ---------- コンテキストメニュー ----------

	async function openMenu(items: ContextMenuItem[], x: number, y: number) {
		// ContextMenu は内部で visible を書き換えることがあるため、一度閉じてから開き直す
		contextMenu.visible = false;
		await tick();
		contextMenu = { visible: true, x, y, items };
	}

	function menuAnchor(e: Event): { x: number; y: number } {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: rect.left, y: rect.bottom };
	}

	function buildChapterMenu(chapter: Chapter): ContextMenuItem[] {
		const chapterIndex = sortedChapters.findIndex((c) => c.id === chapter.id);
		const canMoveUp = chapterIndex > 0;
		const canMoveDown = chapterIndex < sortedChapters.length - 1;
		return createChapterContextMenu({
			chapter,
			onRename: () => handleRenameChapter(chapter),
			onDelete: () => handleDeleteChapter(chapter),
			onDuplicate: () => handleDuplicateChapter(chapter),
			onAddScene: () => openSceneModal(chapter.id),
			onMoveUp: canMoveUp ? () => moveChapterTo(chapter.id, chapterIndex - 1) : undefined,
			onMoveDown: canMoveDown ? () => moveChapterTo(chapter.id, chapterIndex + 1) : undefined,
			canMoveUp,
			canMoveDown
		});
	}

	function buildSceneMenu(scene: Scene): ContextMenuItem[] {
		const chapterScenes = currentProjectStore.scenesByChapter.get(scene.chapterId) || [];
		const sceneIndex = chapterScenes.findIndex((s) => s.id === scene.id);
		const canMoveUp = sceneIndex > 0;
		const canMoveDown = sceneIndex < chapterScenes.length - 1;
		return createSceneContextMenu({
			scene,
			onOpen: () => handleSceneSelect(scene),
			onRename: () => handleRenameScene(scene),
			onDelete: () => handleDeleteScene(scene),
			onDuplicate: () => handleDuplicateScene(scene),
			onSetTarget: () => openTargetModal(scene),
			onMoveUp: canMoveUp
				? () => moveSceneTo(scene.id, scene.chapterId, sceneIndex - 1)
				: undefined,
			onMoveDown: canMoveDown
				? () => moveSceneTo(scene.id, scene.chapterId, sceneIndex + 1)
				: undefined,
			canMoveUp,
			canMoveDown
		});
	}

	function handleChapterContextMenu(e: MouseEvent, chapter: Chapter) {
		e.preventDefault();
		e.stopPropagation();
		void openMenu(buildChapterMenu(chapter), e.clientX, e.clientY);
	}

	function handleSceneContextMenu(e: MouseEvent, scene: Scene) {
		e.preventDefault();
		e.stopPropagation();
		void openMenu(buildSceneMenu(scene), e.clientX, e.clientY);
	}

	// タッチ端末でも使えるメニューボタン
	function openChapterMenuFromButton(e: MouseEvent, chapter: Chapter) {
		e.stopPropagation();
		const { x, y } = menuAnchor(e);
		void openMenu(buildChapterMenu(chapter), x, y);
	}

	function openSceneMenuFromButton(e: MouseEvent, scene: Scene) {
		e.stopPropagation();
		const { x, y } = menuAnchor(e);
		void openMenu(buildSceneMenu(scene), x, y);
	}

	// ---------- リネーム ----------

	function handleRenameChapter(chapter: Chapter) {
		renameValue = chapter.title;
		renameTarget = { type: 'chapter', id: chapter.id };
		isRenameModalOpen = true;
	}

	function handleRenameScene(scene: Scene) {
		renameValue = scene.title;
		renameTarget = { type: 'scene', id: scene.id };
		isRenameModalOpen = true;
	}

	/** DB 更新 → 再取得 → ストア反映 → 同期キュー、をまとめて行う */
	async function updateSceneFields(
		id: string,
		changes: Partial<Scene>
	): Promise<Scene | undefined> {
		await scenesDB.update(id, changes);
		const updated = await scenesDB.getById(id);
		if (updated) {
			currentProjectStore.scenes = currentProjectStore.scenes.map((s) =>
				s.id === id ? updated : s
			);
			// 編集中の本文を失わないよう、未保存の変更がないときだけ現在のシーンを差し替える
			if (editorStore.currentScene?.id === id && !editorStore.isDirty) {
				editorStore.currentScene = updated;
			}
		}
		await queueChange('scenes', id, 'update');
		return updated;
	}

	const applyRename = async () => {
		const title = renameValue.trim();
		if (!title || !renameTarget) return;
		const target = renameTarget;

		try {
			if (target.type === 'chapter') {
				await chaptersDB.update(target.id, { title });
				const updatedChapter = await chaptersDB.getById(target.id);
				if (updatedChapter) {
					currentProjectStore.chapters = currentProjectStore.chapters.map((c) =>
						c.id === target.id ? updatedChapter : c
					);
				}
				await queueChange('chapters', target.id, 'update');
			} else {
				await updateSceneFields(target.id, { title });
			}
			isRenameModalOpen = false;
			renameValue = '';
			toast.success('名前を変更しました');
		} catch (error) {
			console.error('Failed to rename:', error);
			toast.error('名前の変更に失敗しました');
		}
	};

	// ---------- 目標文字数 ----------

	function openTargetModal(scene: Scene) {
		targetSceneId = scene.id;
		targetValue = scene.targetCharacterCount ? String(scene.targetCharacterCount) : '';
		isTargetModalOpen = true;
	}

	const applyTarget = async () => {
		if (!targetSceneId) return;
		const parsed = Math.floor(Number(targetValue));
		const target = targetValue.trim() === '' || !(parsed > 0) ? undefined : parsed;
		try {
			await updateSceneFields(targetSceneId, { targetCharacterCount: target });
			isTargetModalOpen = false;
			toast.success(
				target
					? `目標文字数を${target.toLocaleString()}文字に設定しました`
					: '目標文字数を解除しました'
			);
		} catch (error) {
			console.error('Failed to set target:', error);
			toast.error('目標文字数の設定に失敗しました');
		}
	};

	// ---------- 削除（確認 → 削除 → 取り消し付きトースト） ----------

	async function handleDeleteChapter(chapter: Chapter) {
		const scenes = $state.snapshot(
			currentProjectStore.scenesByChapter.get(chapter.id) || []
		) as Scene[];
		const chapterSnapshot = $state.snapshot(chapter) as Chapter;
		const ok = await confirmDialog({
			title: '章の削除',
			message: `章「${chapter.title}」とそのシーン（${scenes.length}件）を削除しますか？`,
			confirmText: '削除',
			danger: true
		});
		if (!ok) return;

		try {
			// 編集中のシーンの未保存の内容も取り消し用に残す
			const current = editorStore.currentScene;
			if (current?.chapterId === chapter.id) {
				const target = scenes.find((s) => s.id === current.id);
				if (target) {
					target.content = editorStore.content;
					target.characterCount = editorStore.content.length;
				}
			}

			for (const scene of scenes) {
				await scenesDB.delete(scene.id);
				await queueChange('scenes', scene.id, 'delete');
			}
			await chaptersDB.delete(chapter.id);
			await queueChange('chapters', chapter.id, 'delete');

			currentProjectStore.chapters = currentProjectStore.chapters.filter(
				(c) => c.id !== chapter.id
			);
			currentProjectStore.scenes = currentProjectStore.scenes.filter(
				(s) => s.chapterId !== chapter.id
			);

			if (current?.chapterId === chapter.id) {
				editorStore.currentScene = null;
			}
		} catch (error) {
			console.error('Failed to delete chapter:', error);
			toast.error('章の削除に失敗しました');
			return;
		}

		toast.success(`章「${chapter.title}」を削除しました`, {
			action: {
				label: '元に戻す',
				onclick: async () => {
					try {
						await db.chapters.put(chapterSnapshot);
						await queueChange('chapters', chapterSnapshot.id, 'create');
						for (const scene of scenes) {
							await db.scenes.put(scene);
							await queueChange('scenes', scene.id, 'create');
						}
						currentProjectStore.chapters = [...currentProjectStore.chapters, chapterSnapshot];
						currentProjectStore.scenes = [...currentProjectStore.scenes, ...scenes];
						toast.success('削除を取り消しました');
					} catch (error) {
						console.error('Failed to restore chapter:', error);
						toast.error('取り消しに失敗しました');
					}
				}
			}
		});
	}

	async function handleDeleteScene(scene: Scene) {
		const ok = await confirmDialog({
			title: 'シーンの削除',
			message: `シーン「${scene.title}」を削除しますか？`,
			confirmText: '削除',
			danger: true
		});
		if (!ok) return;

		const snapshot = $state.snapshot(scene) as Scene;
		// 編集中の未保存の内容も取り消し用に残す
		const wasCurrent = editorStore.currentScene?.id === scene.id;
		if (wasCurrent) {
			snapshot.content = editorStore.content;
			snapshot.characterCount = editorStore.content.length;
		}

		try {
			await scenesDB.delete(scene.id);
			await queueChange('scenes', scene.id, 'delete');

			currentProjectStore.scenes = currentProjectStore.scenes.filter((s) => s.id !== scene.id);

			if (wasCurrent) {
				editorStore.currentScene = null;
			}
		} catch (error) {
			console.error('Failed to delete scene:', error);
			toast.error('シーンの削除に失敗しました');
			return;
		}

		toast.success(`シーン「${scene.title}」を削除しました`, {
			action: {
				label: '元に戻す',
				onclick: async () => {
					try {
						await db.scenes.put(snapshot);
						await queueChange('scenes', snapshot.id, 'create');
						currentProjectStore.scenes = [...currentProjectStore.scenes, snapshot];
						toast.success('削除を取り消しました');
					} catch (error) {
						console.error('Failed to restore scene:', error);
						toast.error('取り消しに失敗しました');
					}
				}
			}
		});
	}

	// ---------- 複製 ----------

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
			toast.success(`章「${chapter.title}」を複製しました`);
		} catch (error) {
			console.error('Failed to duplicate chapter:', error);
			toast.error('章の複製に失敗しました');
		}
	}

	async function handleDuplicateScene(scene: Scene) {
		if (!currentProjectStore.project) return;

		try {
			const newScene = await scenesDB.create({
				chapterId: scene.chapterId,
				projectId: currentProjectStore.project.id,
				title: `${scene.title} (コピー)`,
				content: editorStore.currentScene?.id === scene.id ? editorStore.content : scene.content
			});

			currentProjectStore.scenes = [...currentProjectStore.scenes, newScene];
			await queueChange('scenes', newScene.id, 'create');
			toast.success(`シーン「${scene.title}」を複製しました`);
		} catch (error) {
			console.error('Failed to duplicate scene:', error);
			toast.error('シーンの複製に失敗しました');
		}
	}

	// ---------- 並べ替え（ボタン・ドラッグ&ドロップ共通） ----------

	/** 章を、自身を除いた一覧の index 番目へ移動する */
	async function moveChapterTo(chapterId: string, index: number) {
		const moving = sortedChapters.find((c) => c.id === chapterId);
		if (!moving) return;
		const list = sortedChapters.filter((c) => c.id !== chapterId);
		list.splice(Math.max(0, Math.min(index, list.length)), 0, moving);

		try {
			const fresh = new SvelteMap<string, Chapter>();
			for (let i = 0; i < list.length; i++) {
				if (list[i].order === i) continue;
				await chaptersDB.update(list[i].id, { order: i });
				await queueChange('chapters', list[i].id, 'update');
				const updated = await chaptersDB.getById(list[i].id);
				if (updated) fresh.set(updated.id, updated);
			}
			currentProjectStore.chapters = list.map((c) => fresh.get(c.id) ?? c);
		} catch (error) {
			console.error('Failed to move chapter:', error);
			toast.error('章の並べ替えに失敗しました');
		}
	}

	/** シーンを、対象章の（自身を除いた）index 番目へ移動する。章をまたぐ移動も可 */
	async function moveSceneTo(sceneId: string, targetChapterId: string, index: number) {
		const scene = currentProjectStore.scenes.find((s) => s.id === sceneId);
		if (!scene) return;
		const byChapter = currentProjectStore.scenesByChapter;

		const targetList = (byChapter.get(targetChapterId) ?? []).filter((s) => s.id !== sceneId);
		targetList.splice(Math.max(0, Math.min(index, targetList.length)), 0, scene);

		const changes = new SvelteMap<string, Partial<Scene>>();
		targetList.forEach((s, i) => {
			if (s.order !== i || s.chapterId !== targetChapterId) {
				changes.set(s.id, { order: i, chapterId: targetChapterId });
			}
		});
		if (scene.chapterId !== targetChapterId) {
			(byChapter.get(scene.chapterId) ?? [])
				.filter((s) => s.id !== sceneId)
				.forEach((s, i) => {
					if (s.order !== i) changes.set(s.id, { order: i });
				});
		}
		if (changes.size === 0) return;

		try {
			for (const [id, change] of changes) {
				await updateSceneFields(id, change);
			}
		} catch (error) {
			console.error('Failed to move scene:', error);
			toast.error('シーンの並べ替えに失敗しました');
		}
	}

	function dragPosition(e: DragEvent): 'before' | 'after' {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
	}

	function startDrag(e: DragEvent, type: DragItem['type'], id: string) {
		dragItem = { type, id };
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', id);
		}
	}

	function endDrag() {
		dragItem = null;
		dropTarget = null;
	}

	function dragOverScene(e: DragEvent, scene: Scene) {
		if (dragItem?.type !== 'scene' || dragItem.id === scene.id) return;
		e.preventDefault();
		dropTarget = { type: 'scene', id: scene.id, pos: dragPosition(e) };
	}

	async function dropOnScene(e: DragEvent, scene: Scene) {
		if (dragItem?.type !== 'scene' || dragItem.id === scene.id) return;
		e.preventDefault();
		e.stopPropagation();
		const pos = dragPosition(e);
		const draggedId = dragItem.id;
		endDrag();
		const list = (currentProjectStore.scenesByChapter.get(scene.chapterId) ?? []).filter(
			(s) => s.id !== draggedId
		);
		const index = list.findIndex((s) => s.id === scene.id) + (pos === 'after' ? 1 : 0);
		await moveSceneTo(draggedId, scene.chapterId, index);
	}

	function dragOverChapter(e: DragEvent, chapter: Chapter) {
		if (!dragItem) return;
		if (dragItem.type === 'scene') {
			e.preventDefault();
			dropTarget = { type: 'chapter-into', id: chapter.id, pos: 'before' };
		} else if (dragItem.id !== chapter.id) {
			e.preventDefault();
			dropTarget = { type: 'chapter', id: chapter.id, pos: dragPosition(e) };
		}
	}

	async function dropOnChapter(e: DragEvent, chapter: Chapter) {
		if (!dragItem) return;
		e.preventDefault();
		e.stopPropagation();
		const item = dragItem;
		const pos = dragPosition(e);
		endDrag();
		if (item.type === 'scene') {
			await moveSceneTo(item.id, chapter.id, 0);
		} else if (item.id !== chapter.id) {
			const list = sortedChapters.filter((c) => c.id !== item.id);
			const index = list.findIndex((c) => c.id === chapter.id) + (pos === 'after' ? 1 : 0);
			await moveChapterTo(item.id, index);
		}
	}

	function dropIndicator(type: DropTarget['type'], id: string): string {
		if (!dropTarget || dropTarget.type !== type || dropTarget.id !== id) return '';
		if (type === 'chapter-into')
			return 'outline: 2px solid var(--color-primary); outline-offset: -2px;';
		return dropTarget.pos === 'before'
			? 'box-shadow: inset 0 2px 0 var(--color-primary);'
			: 'box-shadow: inset 0 -2px 0 var(--color-primary);';
	}

	// ---------- 書式設定 ----------

	async function updateFormatting() {
		try {
			await settingsDB.update({
				editorFont: draftFont,
				editorFormatting: { ...draftFormatting },
				previewSettings: { ...draftPreview }
			});
			settingsStore.editorFont = draftFont;
			settingsStore.editorFormatting = { ...draftFormatting };
			settingsStore.previewSettings = { ...draftPreview };
			showFormattingModal = false;
			toast.success('書式設定を保存しました');
		} catch (error) {
			console.error('Failed to save formatting:', error);
			toast.error('書式設定の保存に失敗しました');
		}
	}

	function openFormattingModal() {
		// モーダルを開く際に現在の設定をドラフトへ読み込む
		draftFormatting = { ...DEFAULT_FORMATTING, ...(settingsStore.editorFormatting ?? {}) };
		draftFont = settingsStore.editorFont;
		draftPreview = { ...settingsStore.previewSettings };
		showFormattingModal = true;
	}

	async function toggleWritingMode() {
		const next = isVertical ? 'horizontal' : 'vertical';
		settingsStore.editorWritingMode = next;
		try {
			await settingsDB.update({ editorWritingMode: next });
		} catch (error) {
			console.error('Failed to save writing mode:', error);
			toast.error('書字方向の保存に失敗しました');
		}
	}

	// フォントファミリーを取得
	function getFontFamily(font: EditorFont): string {
		const fontMap: Record<EditorFont, string> = {
			'yu-gothic': '"Yu Gothic", "游ゴシック", YuGothic, "游ゴシック体", sans-serif',
			'gen-shin-mincho': '"源真明朝", "Gen Shin Mincho", serif',
			'hiragino-mincho': '"Hiragino Mincho ProN", "ヒラギノ明朝 ProN", serif',
			'noto-sans': '"Noto Sans JP", sans-serif',
			'noto-serif': '"Noto Serif JP", serif',
			'hannari-mincho': '"はんなり明朝", "Hannari Mincho", serif',
			'sawarabi-mincho': '"さわらび明朝", "Sawarabi Mincho", serif',
			'sawarabi-gothic': '"さわらびゴシック", "Sawarabi Gothic", sans-serif'
		};
		return fontMap[font] || fontMap['yu-gothic'];
	}

	// ---------- 全画面（集中）モード ----------

	async function toggleFocusMode() {
		if (isFocusMode) {
			exitFocusMode();
			return;
		}
		isFocusMode = true;
		isSidebarOpen = false;
		try {
			// モーダルも表示されるよう、ページ全体を全画面にする
			await document.documentElement.requestFullscreen();
			usesNativeFullscreen = true;
		} catch {
			// 全画面 API が使えない端末では、画面いっぱいの表示だけで代用する
			usesNativeFullscreen = false;
		}
	}

	function exitFocusMode() {
		isFocusMode = false;
		if (document.fullscreenElement) {
			void document.exitFullscreen().catch(() => {});
		}
		usesNativeFullscreen = false;
	}

	function handleFullscreenChange() {
		// Esc などブラウザ側の操作で全画面が解除された場合に状態を合わせる
		if (!document.fullscreenElement && usesNativeFullscreen) {
			usesNativeFullscreen = false;
			isFocusMode = false;
		}
	}

	// ---------- ツールバー ----------

	interface ToolbarAction {
		id: string;
		label: string;
		icon: string;
		onclick: () => void;
		/** デスクトップでツールバーに常時表示する（それ以外は「その他」メニュー） */
		pinned?: boolean;
		active?: boolean;
	}

	const toolbarActions = $derived<ToolbarAction[]>([
		{
			id: 'format',
			label: '書式設定',
			icon: 'palette',
			onclick: openFormattingModal,
			pinned: true
		},
		{
			id: 'search',
			label: '検索・置換',
			icon: 'search',
			onclick: () => void openSearch(),
			pinned: true
		},
		{
			id: 'proofread',
			label: '校正',
			icon: 'abc',
			onclick: () => (showProofread = true),
			pinned: true
		},
		{
			id: 'assistant',
			label: '執筆支援',
			icon: 'pencil-bolt',
			onclick: () => (showWritingAssistant = true),
			pinned: true
		},
		{
			id: 'writing-mode',
			label: isVertical ? '横書きにする' : '縦書きにする',
			icon: 'book-2',
			onclick: () => void toggleWritingMode(),
			pinned: true,
			active: isVertical
		},
		{
			id: 'focus',
			label: isFocusMode ? '全画面を終了' : '全画面',
			icon: 'layout-board',
			onclick: () => void toggleFocusMode(),
			pinned: true,
			active: isFocusMode
		},
		{
			id: 'export',
			label: 'シーンをエクスポート',
			icon: 'download',
			onclick: () => (showExportModal = true)
		},
		{
			id: 'project-export',
			label: 'プロジェクトをエクスポート',
			icon: 'package-export',
			onclick: () => (showProjectExport = true)
		},
		{
			id: 'print',
			label: '印刷プレビュー',
			icon: 'printer',
			onclick: () => (showPrintPreview = true)
		},
		{
			id: 'versions',
			label: 'バージョン履歴',
			icon: 'history',
			onclick: () => (showVersionManager = true)
		},
		{ id: 'history', label: '変更履歴', icon: 'history', onclick: () => (showHistory = true) }
	]);

	const pinnedActions = $derived(toolbarActions.filter((a) => a.pinned));

	function openToolbarMenu(e: MouseEvent) {
		const { x, y } = menuAnchor(e);
		// モバイルでは全操作を、デスクトップでは常時表示していない操作だけを載せる
		const items = (isMobile ? toolbarActions : toolbarActions.filter((a) => !a.pinned)).map(
			(a) => ({ label: a.label, icon: a.icon, action: a.onclick })
		);
		void openMenu(items, x, y);
	}

	// ---------- 本文エディタ（contenteditable） ----------

	// 本文は 1 行 = 1 つの div で表現する（段落間隔を CSS で付けるため）
	function renderContent(text: string) {
		if (!editorDiv) return;
		// contenteditable の中身は Svelte 管理外なので、直接 DOM を組み立てる
		// eslint-disable-next-line svelte/no-dom-manipulating
		editorDiv.replaceChildren(
			...text.split('\n').map((line) => {
				const div = document.createElement('div');
				if (line === '') div.appendChild(document.createElement('br'));
				else div.textContent = line;
				return div;
			})
		);
	}

	const lineLength = (node: Node) => (node.nodeName === 'BR' ? 0 : (node.textContent ?? '').length);

	/** 本文先頭からの文字オフセット（改行 1 文字）でキャレット位置を求める */
	function getCaretOffset(root: HTMLElement, range: Range): number | null {
		if (!root.contains(range.startContainer)) return null;
		const lines = Array.from(root.childNodes);
		if (lines.length === 0) return 0;

		let index: number;
		let inLine: number;
		if (range.startContainer === root) {
			index = range.startOffset;
			inLine = 0;
			if (index >= lines.length) {
				index = lines.length - 1;
				inLine = lineLength(lines[index]);
			}
		} else {
			let node: Node = range.startContainer;
			while (node.parentNode !== root) node = node.parentNode as Node;
			index = lines.indexOf(node as ChildNode);
			const before = document.createRange();
			before.selectNodeContents(node);
			before.setEnd(range.startContainer, range.startOffset);
			inLine = before.toString().length;
		}

		let total = 0;
		for (let i = 0; i < index; i++) total += lineLength(lines[i]) + 1;
		return total + inLine;
	}

	function setCaretOffset(root: HTMLElement, offset: number) {
		const selection = window.getSelection();
		if (!selection) return;
		const lines = Array.from(root.childNodes);
		const range = document.createRange();
		range.setStart(root, 0);

		let remaining = offset;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const length = lineLength(line);
			if (remaining <= length || i === lines.length - 1) {
				const at = Math.min(remaining, length);
				if (line.nodeType === Node.TEXT_NODE) {
					range.setStart(line, at);
				} else {
					const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
					let left = at;
					let placed = false;
					for (let n = walker.nextNode(); n; n = walker.nextNode()) {
						const len = (n.textContent ?? '').length;
						if (left <= len) {
							range.setStart(n, left);
							placed = true;
							break;
						}
						left -= len;
					}
					if (!placed) range.setStart(line, 0);
				}
				break;
			}
			remaining -= length + 1;
		}
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	// contentEditable div用の入力ハンドラ
	function handleEditorInput() {
		if (editorDiv) editorStore.content = editorDiv.innerText;
	}

	// 貼り付け時にプレーンテキストとして処理（Undo履歴を維持）
	function handlePaste(e: ClipboardEvent) {
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';

		// execCommand を使用してテキストを挿入（ブラウザのUndo履歴に記録される）
		document.execCommand('insertText', false, text);

		if (editorDiv) editorStore.content = editorDiv.innerText;
	}

	function restoreSelection() {
		editorDiv?.focus();
		const selection = window.getSelection();
		if (selection && savedRange) {
			selection.removeAllRanges();
			selection.addRange(savedRange);
		}
	}

	function syncContentFromDom() {
		if (editorDiv) editorStore.content = editorDiv.innerText;
	}

	async function clipboardAction(action: () => Promise<void>) {
		try {
			await action();
		} catch (error) {
			console.error('Clipboard operation failed:', error);
			toast.error('クリップボードを利用できませんでした');
		}
	}

	// contentEditable div用のコンテキストメニューハンドラ
	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();

		const selection = window.getSelection();
		const hasSelection = selection ? selection.toString().length > 0 : false;
		savedRange =
			selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

		const items = createEditorContextMenu({
			scene: editorStore.currentScene,
			chapter:
				currentProjectStore.chapters.find((c) => c.id === editorStore.currentScene?.chapterId) ||
				null,
			hasSelection,
			onSave: () => void handleSave(),
			onCopy: () =>
				clipboardAction(async () => {
					await navigator.clipboard.writeText(savedRange?.toString() ?? '');
				}),
			onCut: () =>
				clipboardAction(async () => {
					restoreSelection();
					await navigator.clipboard.writeText(window.getSelection()?.toString() ?? '');
					// execCommand ならブラウザの Undo 履歴にも残り、input イベントで本文ストアも更新される
					document.execCommand('delete');
					syncContentFromDom();
				}),
			onPaste: () =>
				clipboardAction(async () => {
					const text = await navigator.clipboard.readText();
					restoreSelection();
					document.execCommand('insertText', false, text);
					syncContentFromDom();
				}),
			onSelectAll: () => {
				if (!editorDiv) return;
				editorDiv.focus();
				const range = document.createRange();
				range.selectNodeContents(editorDiv);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			},
			onRename: () => handleRenameScene(editorStore.currentScene!),
			onDelete: () => handleDeleteScene(editorStore.currentScene!),
			onDuplicate: () => handleDuplicateScene(editorStore.currentScene!),
			onExport: () => (showExportModal = true),
			onPrint: () => (showPrintPreview = true),
			onVersionHistory: () => (showVersionManager = true),
			onSearch: () => void openSearch(),
			onProofread: () => (showProofread = true)
		});

		void openMenu(items, e.clientX, e.clientY);
	}

	// 縦書きでは、ホイールの縦スクロールを横スクロールに変換する
	function handleEditorWheel(e: WheelEvent) {
		if (
			!isVertical ||
			!editorScrollContainer ||
			e.shiftKey ||
			Math.abs(e.deltaX) > Math.abs(e.deltaY)
		)
			return;
		editorScrollContainer.scrollLeft -= e.deltaY;
		e.preventDefault();
	}

	// contentを更新したときにdivの内容も更新（入力由来で一致している間は何もしない）
	$effect(() => {
		const content = editorStore.content;
		if (!editorDiv || content === editorDiv.innerText) return;

		// 本文内にキャレットがあるときだけ、文字オフセットで位置を保存・復元する
		const selection = window.getSelection();
		const caret =
			selection && selection.rangeCount > 0
				? getCaretOffset(editorDiv, selection.getRangeAt(0))
				: null;

		renderContent(content);

		if (caret !== null) {
			try {
				setCaretOffset(editorDiv, Math.min(caret, content.length));
			} catch {
				// カーソル復元失敗時は無視
			}
		}
	});

	const targetOf = (scene: Scene) => scene.targetCharacterCount ?? 0;
	const progressPercent = (count: number, target: number) =>
		target > 0 ? Math.min(100, Math.round((count / target) * 100)) : 0;
</script>

<svelte:document onfullscreenchange={handleFullscreenChange} />

<div
	class="editor-layout w:100% h:100% bg:theme-background"
	data-sidebar-open={isSidebarOpen ? 'true' : 'false'}
	data-focus={isFocusMode ? 'true' : 'false'}
>
	<!-- サイドバー -->
	<aside
		class="editor-sidebar w:100% bg:theme-background br:2px|solid|theme-text flex flex-direction:column"
	>
		<div class="flex-grow:1 overflow-y:auto p:16 pt:24px">
			<div class="flex justify-content:space-between align-items:center mb:12">
				<h3 class="font:14 font-weight:600 m:0 fg:theme-text">章・シーン</h3>
				<Button size="sm" onclick={() => (isChapterModalOpen = true)}>+ 章</Button>
			</div>

			{#if currentProjectStore.scenes.length > 0}
				<input
					type="search"
					bind:value={sceneQuery}
					placeholder="シーンを検索"
					aria-label="シーンを検索"
					class="w:full px:12 py:8 mb:12 b:1|solid|theme-border bg:theme-background fg:theme-text r:8 font:13 outline:none focus:b:$(theme.primary) transition:all|.2s"
				/>
			{/if}

			{#if currentProjectStore.chapters.length === 0}
				<p class="font:13 fg:theme-text-secondary m:0">章がまだありません</p>
			{:else if visibleChapters.length === 0}
				<p class="font:13 fg:theme-text-secondary m:0">一致するシーンがありません</p>
			{/if}

			{#each visibleChapters as { chapter, scenes, total } (chapter.id)}
				{@const collapsed = !normalizedQuery && collapsedChapters.includes(chapter.id)}
				<div class="mb:16">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="chapter-header flex justify-content:space-between align-items:center mb:8 r:4"
						style={dropIndicator('chapter', chapter.id) + dropIndicator('chapter-into', chapter.id)}
						draggable={!normalizedQuery}
						ondragstart={(e) => startDrag(e, 'chapter', chapter.id)}
						ondragover={(e) => dragOverChapter(e, chapter)}
						ondrop={(e) => dropOnChapter(e, chapter)}
						ondragend={endDrag}
						oncontextmenu={(e) => handleChapterContextMenu(e, chapter)}
					>
						<button
							class="flex align-items:center gap:4 min-w:0 bg:transparent border:none cursor:pointer fg:theme-text text-align:left p:4"
							onclick={() => toggleCollapsed(chapter.id)}
							aria-expanded={!collapsed}
							aria-label={`章「${chapter.title}」を${collapsed ? '展開' : '折りたたみ'}`}
							title={collapsed ? '展開' : '折りたたみ'}
						>
							<span class="chapter-caret font:11 fg:theme-text-secondary" aria-hidden="true">
								{collapsed ? '▶' : '▼'}
							</span>
							<h4 class="font:14 font-weight:500 m:0 fg:theme-text">{chapter.title}</h4>
							{#if collapsed}
								<span class="font:11 fg:theme-text-secondary">({total})</span>
							{/if}
						</button>
						<div class="flex align-items:center flex-shrink:0">
							<button
								class="bg:transparent border:none cursor:pointer fg:theme-text-secondary fg:$(theme.primary):hover font:12 p:4"
								onclick={() => openSceneModal(chapter.id)}
							>
								+ シーン
							</button>
							<button
								class="item-menu-button"
								aria-label={`章「${chapter.title}」のメニュー`}
								aria-haspopup="menu"
								onclick={(e) => openChapterMenuFromButton(e, chapter)}
							>
								⋯
							</button>
						</div>
					</div>

					{#if !collapsed}
						{#each scenes as scene (scene.id)}
							{@const target = targetOf(scene)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="scene-row flex align-items:center r:4 {editorStore.currentScene?.id ===
								scene.id
									? 'bg:$(theme.primary)/.1 fg:$(theme.primary)'
									: 'fg:theme-text bg:theme-background:hover'}"
								style={dropIndicator('scene', scene.id)}
								draggable={!normalizedQuery}
								ondragstart={(e) => startDrag(e, 'scene', scene.id)}
								ondragover={(e) => dragOverScene(e, scene)}
								ondrop={(e) => dropOnScene(e, scene)}
								ondragend={endDrag}
							>
								<button
									class="flex-grow:1 min-w:0 text-align:left p:8 bg:transparent border:none cursor:pointer fg:inherit"
									onclick={() => handleSceneSelect(scene)}
									oncontextmenu={(e) => handleSceneContextMenu(e, scene)}
									aria-current={editorStore.currentScene?.id === scene.id ? 'true' : undefined}
								>
									<div class="font:13">{scene.title}</div>
									<div class="font:11 fg:theme-text-secondary">
										{scene.characterCount.toLocaleString()}{target > 0
											? ` / ${target.toLocaleString()}`
											: ''}文字
									</div>
									{#if target > 0}
										<div
											class="scene-progress"
											role="progressbar"
											aria-label="目標文字数に対する進捗"
											aria-valuemin={0}
											aria-valuemax={100}
											aria-valuenow={progressPercent(scene.characterCount, target)}
										>
											<div
												class="scene-progress-bar"
												style="width: {progressPercent(scene.characterCount, target)}%"
											></div>
										</div>
									{/if}
								</button>
								<button
									class="item-menu-button"
									aria-label={`シーン「${scene.title}」のメニュー`}
									aria-haspopup="menu"
									onclick={(e) => openSceneMenuFromButton(e, scene)}
								>
									⋯
								</button>
							</div>
						{/each}

						{#if total === 0}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="p:12 b:1|dashed|theme-border r:8 text-align:center"
								ondragover={(e) => dragOverChapter(e, chapter)}
								ondrop={(e) => dropOnChapter(e, chapter)}
							>
								<p class="font:12 fg:theme-text-secondary m:0|0|8|0">シーンがありません</p>
								<Button size="sm" onclick={() => openSceneModal(chapter.id)}>+ シーンを作成</Button>
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>

		<div class="p:16 border-top:1|solid|theme-text">
			<div class="font:12 fg:theme-text-secondary">
				合計: {currentProjectStore.totalCharacterCount.toLocaleString()}文字
			</div>
		</div>
	</aside>
	<button
		aria-label="章・シーン一覧を閉じる"
		onclick={() => (isSidebarOpen = false)}
		class="sidebar-overlay"
	></button>

	<!-- エディタエリア -->
	<div class="editor-main flex flex:column w:100% h:100% overflow-y:auto">
		{#if !editorStore.currentScene}
			<div class="mobile-sidebar-open">
				<button
					class="mobile-sidebar-button"
					onclick={() => (isSidebarOpen = true)}
					aria-label="章・シーンを開く"
					title="章・シーンを開く"
				>
					<Icon name="list" class="w:18px" />
					<span>章・シーン</span>
				</button>
			</div>
			<div class="flex align-items:center justify-content:center h:full">
				<div class="text-align:center">
					<p class="fg:theme-text-secondary font:16 mb:16">シーンを選択または作成してください</p>
					{#if currentProjectStore.chapters.length === 0}
						<Button onclick={() => (isChapterModalOpen = true)}>最初の章を作成</Button>
					{:else if currentProjectStore.scenes.length === 0}
						<Button onclick={() => openSceneModal(sortedChapters[0].id)}>最初のシーンを作成</Button>
					{/if}
				</div>
			</div>
		{:else}
			<!-- ツールバー -->
			<div
				class="editor-toolbar bg:theme-background border-bottom:2|solid|theme-text px:16 w:100% h:60px flex flex-direction:column jc:center gap:8"
			>
				<!-- タイトルと保存状態 -->
				<div class="editor-toolbar-row flex justify-content:space-between align-items:center">
					<div class="editor-title-area flex align-items:center gap:16">
						<button
							class="sidebar-toggle p:8 r:6 hover:bg:theme-background cursor:pointer transition:all|0.2s"
							onclick={() => (isSidebarOpen = !isSidebarOpen)}
							aria-label="章・シーンの表示切替"
							title="章・シーンの表示切替"
						>
							<Icon name="list" class="w:20px" />
						</button>
						<h3 class="editor-title font:16 font-weight:500 m:0 fg:theme-text">
							{editorStore.currentScene.title}
						</h3>
						<span class="font:13 fg:theme-text-secondary white-space:nowrap">
							{editorStore.characterCount.toLocaleString()}{editorStore.currentScene
								.targetCharacterCount
								? ` / ${editorStore.currentScene.targetCharacterCount.toLocaleString()}`
								: ''}文字
						</span>
					</div>
					<div class="editor-toolbar-actions flex align-items:center gap:8">
						{#if !isMobile}
							{#each pinnedActions as action (action.id)}
								<button
									class="tb-button flex align-items:center gap:6 p:8 r:6 cursor:pointer transition:all|0.2s {action.active
										? 'bg:theme-text fg:theme-background'
										: 'hover:bg:theme-background fg:theme-text'}"
									onclick={action.onclick}
									aria-label={action.label}
									aria-pressed={action.active === undefined ? undefined : action.active}
									title={action.label}
								>
									<Icon name={action.icon} class="w:20px" />
									<span class="tb-label font:13 white-space:nowrap">{action.label}</span>
								</button>
							{/each}
						{/if}
						<!-- 表示モード切替 -->
						<div
							class="flex align-items:center gap:2 bg:theme-background-secondary r:6 p:2"
							role="group"
							aria-label="表示モード"
						>
							{#each viewModes as mode (mode.value)}
								<button
									class="p:6 r:4 cursor:pointer transition:all|0.2s {viewMode === mode.value
										? 'bg:theme-text fg:theme-background'
										: 'hover:bg:theme-background fg:theme-text'}"
									onclick={() => (viewMode = mode.value)}
									aria-label={mode.label}
									aria-pressed={viewMode === mode.value}
									title={mode.label}
								>
									<Icon name={mode.icon} class="w:18px" />
								</button>
							{/each}
						</div>
						<button
							class="tb-button flex align-items:center gap:6 p:8 r:6 hover:bg:theme-background cursor:pointer transition:all|0.2s fg:theme-text"
							onclick={openToolbarMenu}
							aria-label="その他の操作"
							aria-haspopup="menu"
							title="その他の操作"
						>
							<span class="font:18 line-height:1" aria-hidden="true">⋯</span>
							<span class="tb-label font:13 white-space:nowrap">その他</span>
						</button>
						<div class="w:1 h:20 bg:theme-text"></div>
						<SyncStatus />
						<span class="font:13 white-space:nowrap fg:theme-text-secondary" aria-live="polite">
							{editorStore.isSaving ? '保存中...' : editorStore.isDirty ? '未保存' : '保存済み'}
						</span>
						<Button
							class="white-space:nowrap"
							size="sm"
							onclick={() => handleSave()}
							disabled={!editorStore.isDirty || editorStore.isSaving}>保存</Button
						>
					</div>
				</div>
			</div>

			<!-- エディタ & プレビューエリア -->
			<div class="editor-panels flex-grow:1 flex overflow:hidden">
				<!-- エディタ -->
				{#if viewMode !== 'preview'}
					<div
						bind:this={editorScrollContainer}
						onwheel={handleEditorWheel}
						class="editor-panel editor-panel--editor {isVertical
							? 'editor-panel--vertical'
							: 'overflow-y:auto'} p:32 bg:editor-background {viewMode === 'split'
							? 'w:50%'
							: 'w:100%'} transition:width|0.3s"
					>
						<div
							class="editor-page max-w:800 mx:auto bg:editor-background p:48 r:8 min-h:full h:fit {isVertical
								? 'editor-page--vertical'
								: ''}"
						>
							<!-- contentEditable div -->
							<div
								bind:this={editorDiv}
								contenteditable="true"
								role="textbox"
								aria-label="エディタ"
								aria-multiline="true"
								tabindex="0"
								oninput={handleEditorInput}
								oncontextmenu={handleContextMenu}
								onpaste={handlePaste}
								class="editor-text w:full min-h:600 border:none outline:none bg:editor-background fg:$(editor.text) white-space:pre-wrap {isVertical
									? 'editor-text--vertical'
									: ''}"
								style="
									font-family: {getFontFamily(settingsStore.editorFont)};
									font-size: {formatting.fontSize ?? 16}px;
									line-height: {formatting.lineHeight ?? 2};
									letter-spacing: {formatting.letterSpacing ?? 0}em;
									--paragraph-gap: {formatting.paragraphSpacing ?? 0}px;
								"
								data-placeholder="ここに執筆を開始..."
							></div>
						</div>
					</div>
				{/if}

				<!-- プレビューエリア -->
				{#if viewMode !== 'editor'}
					<div
						class="editor-panel editor-panel--preview {viewMode === 'split'
							? 'w:50% border-left:1|solid|theme-text'
							: 'w:100%'} overflow:hidden"
					>
						<PreviewViewer
							bind:this={previewViewerRef}
							content={editorStore.content}
							settings={appliedPreview}
						/>
					</div>
				{/if}
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
			<Input label="章のタイトル" bind:value={newChapterTitle} placeholder="第1章" required />
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
			<Input
				label="シーンのタイトル"
				bind:value={newSceneTitle}
				placeholder="オープニング"
				required
			/>
		</div>
		<div class="flex justify-content:flex-end gap:12">
			<Button type="button" variant="secondary" onclick={() => (isSceneModalOpen = false)}>
				キャンセル
			</Button>
			<Button type="submit" disabled={!newSceneTitle.trim()}>作成</Button>
		</div>
	</form>
</Modal>

<!-- 目標文字数モーダル -->
<Modal bind:isOpen={isTargetModalOpen} title="目標文字数を設定">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			applyTarget();
		}}
	>
		<div class="mb:16">
			<Input
				label="目標文字数（空欄で解除）"
				type="number"
				bind:value={targetValue}
				placeholder="3000"
			/>
		</div>
		<div class="flex justify-content:flex-end gap:12">
			<Button type="button" variant="secondary" onclick={() => (isTargetModalOpen = false)}>
				キャンセル
			</Button>
			<Button type="submit">設定</Button>
		</div>
	</form>
</Modal>

<!-- Phase 2: 執筆支援モーダル -->
{#if showWritingAssistant && editorStore.currentScene}
	<Modal
		isOpen={showWritingAssistant}
		onClose={() => (showWritingAssistant = false)}
		title="執筆支援"
		size="large"
	>
		<WritingAssistant bind:text={editorStore.content} />
	</Modal>
{/if}

<!-- 校正 -->
{#if showProofread && editorStore.currentScene}
	<Modal isOpen={showProofread} onClose={() => (showProofread = false)} title="校正" size="large">
		<ProofreadPanel text={editorStore.content} onApply={(text) => (editorStore.content = text)} />
	</Modal>
{/if}

<!-- 検索・置換 -->
{#if currentProjectStore.project}
	<SearchReplace
		projectId={currentProjectStore.project.id}
		show={showSearch}
		onClose={closeSearch}
	/>
	<ExportModal
		projectId={currentProjectStore.project.id}
		projectTitle={currentProjectStore.project.title}
		show={showProjectExport}
		onClose={() => (showProjectExport = false)}
	/>
{/if}

<!-- 変更履歴 -->
{#if showHistory && editorStore.currentScene}
	<HistoryViewer
		bind:isOpen={showHistory}
		entityId={editorStore.currentScene.id}
		onRestore={handleHistoryRestore}
		onClose={() => (showHistory = false)}
	/>
{/if}

<!-- Phase 2: 印刷プレビュー -->
{#if showPrintPreview && currentProjectStore.project}
	<PrintPreview
		chapters={currentProjectStore.chapters.map((chapter) => ({
			title: chapter.title,
			scenes: currentProjectStore.scenes
				.filter((scene) => scene.chapterId === chapter.id)
				.map((scene) => ({
					title: scene.title,
					content: scene.content
				}))
		}))}
		isOpen={showPrintPreview}
		onClose={() => (showPrintPreview = false)}
	/>
{/if}

<!-- Phase 2: バージョン管理 -->
{#if showVersionManager && editorStore.currentScene && currentProjectStore.project}
	<Modal
		isOpen={showVersionManager}
		onClose={() => (showVersionManager = false)}
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

<!-- エクスポートモーダル -->
{#if showExportModal && editorStore.currentScene}
	<Modal
		isOpen={showExportModal}
		onClose={() => (showExportModal = false)}
		title="シーンをエクスポート"
		size="large"
	>
		<SceneExportModal
			content={editorStore.content}
			title={editorStore.currentScene.title}
			onClose={() => (showExportModal = false)}
		/>
	</Modal>
{/if}

<!-- 書式設定モーダル -->
<Modal bind:isOpen={showFormattingModal} title="書式設定" size="large">
	<div class="flex flex-direction:column gap:24">
		<!-- タブ -->
		<div
			class="flex gap:4 bg:theme-background-secondary r:8 p:4"
			role="group"
			aria-label="設定の種類"
		>
			<button
				class="flex:1 p:12 r:6 font:14 font-weight:500 cursor:pointer transition:all|0.2s border:none {formattingTab ===
				'editor'
					? 'bg:theme-text fg:theme-background'
					: 'bg:transparent fg:theme-text hover:bg:theme-background'}"
				aria-pressed={formattingTab === 'editor'}
				onclick={() => (formattingTab = 'editor')}
			>
				エディター設定
			</button>
			<button
				class="flex:1 p:12 r:6 font:14 font-weight:500 cursor:pointer transition:all|0.2s border:none {formattingTab ===
				'preview'
					? 'bg:theme-text fg:theme-background'
					: 'bg:transparent fg:theme-text hover:bg:theme-background'}"
				aria-pressed={formattingTab === 'preview'}
				onclick={() => (formattingTab = 'preview')}
			>
				プレビュー設定
			</button>
		</div>

		{#if formattingTab === 'editor'}
			<!-- エディター設定 -->
			<!-- フォント -->
			<div>
				<span class="display:block font-weight:500 m:0|0|12|0 fg:theme-text">フォント</span>
				<FontSelector value={draftFont} onchange={(font) => (draftFont = font)} />
			</div>

			<!-- フォントサイズ -->
			<div>
				<label class="display:block font-weight:500 m:0|0|8|0 fg:theme-text" for="fmt-font-size">
					フォントサイズ: {draftFormatting.fontSize}px
				</label>
				<input
					id="fmt-font-size"
					type="range"
					bind:value={draftFormatting.fontSize}
					min="12"
					max="24"
					step="1"
					class="w:full"
				/>
				<div class="flex justify-content:space-between font:12 fg:theme-text-secondary mt:4">
					<span>12px</span>
					<span>24px</span>
				</div>
			</div>

			<!-- 行間 -->
			<div>
				<label class="display:block font-weight:500 m:0|0|8|0 fg:theme-text" for="fmt-line-height">
					行間: {(draftFormatting.lineHeight ?? 2).toFixed(1)}
				</label>
				<input
					id="fmt-line-height"
					type="range"
					bind:value={draftFormatting.lineHeight}
					min="1.0"
					max="3.0"
					step="0.1"
					class="w:full"
				/>
				<div class="flex justify-content:space-between font:12 fg:theme-text-secondary mt:4">
					<span>1.0</span>
					<span>3.0</span>
				</div>
			</div>

			<!-- 字間 -->
			<div>
				<label
					class="display:block font-weight:500 m:0|0|8|0 fg:theme-text"
					for="fmt-letter-spacing"
				>
					字間: {(draftFormatting.letterSpacing ?? 0).toFixed(2)}em
				</label>
				<input
					id="fmt-letter-spacing"
					type="range"
					bind:value={draftFormatting.letterSpacing}
					min="-0.05"
					max="0.2"
					step="0.01"
					class="w:full"
				/>
				<div class="flex justify-content:space-between font:12 fg:theme-text-secondary mt:4">
					<span>-0.05em</span>
					<span>0.20em</span>
				</div>
			</div>

			<!-- 段落間隔 -->
			<div>
				<label
					class="display:block font-weight:500 m:0|0|8|0 fg:theme-text"
					for="fmt-paragraph-spacing"
				>
					段落間隔: {draftFormatting.paragraphSpacing ?? 0}px
				</label>
				<input
					id="fmt-paragraph-spacing"
					type="range"
					bind:value={draftFormatting.paragraphSpacing}
					min="0"
					max="48"
					step="2"
					class="w:full"
				/>
				<div class="flex justify-content:space-between font:12 fg:theme-text-secondary mt:4">
					<span>0px</span>
					<span>48px</span>
				</div>
			</div>

			<!-- プレビュー -->
			<div class="b:1|solid|theme-border r:8 p:16 bg:editor-background">
				<div class="font:12 font-weight:500 mb:8 fg:theme-text-secondary">プレビュー</div>
				<div
					style="
						font-family: {getFontFamily(draftFont)};
						font-size: {draftFormatting.fontSize ?? 16}px;
						line-height: {draftFormatting.lineHeight ?? 2};
						letter-spacing: {draftFormatting.letterSpacing ?? 0}em;
					"
					class="fg:$(editor.text)"
				>
					<p style="margin: 0 0 {draftFormatting.paragraphSpacing ?? 0}px;">
						吾輩は猫である。名前はまだ無い。
					</p>
					<p style="margin: 0;">
						どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。
					</p>
				</div>
			</div>
		{:else}
			<!-- プレビュー設定 -->
			<PreviewSettings
				settings={draftPreview}
				onSettingsChange={(newSettings) => (draftPreview = newSettings)}
			/>
		{/if}

		<!-- ボタン（エディター・プレビュー両方の変更をまとめて保存） -->
		<div class="flex justify-content:flex-end gap:12">
			<Button type="button" variant="secondary" onclick={() => (showFormattingModal = false)}>
				キャンセル
			</Button>
			<Button type="button" onclick={updateFormatting}>保存</Button>
		</div>
	</div>
</Modal>

<!-- リネームモーダル -->
<Modal bind:isOpen={isRenameModalOpen} title="名前を変更">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			applyRename();
		}}
	>
		<div class="mb:16">
			<Input label="新しい名前" bind:value={renameValue} placeholder="名前を入力" required />
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
	onClose={() => (contextMenu.visible = false)}
/>

<style>
	/* contentEditable divのプレースホルダー */
	[contenteditable]:empty:before {
		content: attr(data-placeholder);
		color: var(--color-text-secondary);
		opacity: 0.5;
	}

	/* フォーカス時のアウトライン除去 */
	[contenteditable]:focus {
		outline: none;
	}

	/* 1 行 = 1 段落。段落間隔は設定値（論理プロパティなので縦書きでも効く） */
	.editor-text > :global(div) {
		margin-block-end: var(--paragraph-gap, 0);
	}

	/* 縦書き */
	.editor-panel--vertical {
		overflow-x: auto;
		overflow-y: hidden;
		box-sizing: border-box;
	}

	.editor-page.editor-page--vertical {
		height: 100%;
		min-height: 0;
		width: max-content;
		min-width: 100%;
		max-width: none;
		padding: 24px;
		box-sizing: border-box;
	}

	.editor-text.editor-text--vertical {
		writing-mode: vertical-rl;
		height: 100%;
		min-height: 0;
		min-width: 20em;
		width: auto;
		box-sizing: border-box;
	}

	/* サイドバーの項目メニューボタン */
	.item-menu-button {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
	}

	.item-menu-button:hover {
		background: var(--color-background-secondary, var(--color-surface));
		color: var(--color-text);
	}

	.scene-progress {
		height: 3px;
		margin-top: 4px;
		border-radius: 2px;
		background: var(--color-border);
		overflow: hidden;
	}

	.scene-progress-bar {
		height: 100%;
		background: var(--color-primary);
	}

	.chapter-caret {
		display: inline-block;
		width: 12px;
	}

	.editor-layout {
		display: grid;
		grid-template-columns: 17.5rem 1fr;
		grid-template-rows: 1fr;
		position: relative;
	}

	.editor-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.editor-panels {
		flex: 1;
		min-height: 0;
	}

	.sidebar-overlay {
		display: none;
	}

	.sidebar-toggle {
		display: none;
	}

	.mobile-sidebar-open {
		display: none;
	}

	.mobile-sidebar-button {
		display: none;
	}

	/* 幅が狭いときはツールバーのラベルを隠し、アイコンのみにする */
	@media (max-width: 1279px) {
		.tb-label {
			display: none;
		}
	}

	/* 全画面（集中）モード: サイドバーは必要なときだけ重ねて表示する */
	.editor-layout[data-focus='true'] {
		position: fixed;
		inset: 0;
		z-index: 900;
		grid-template-columns: 1fr;
	}

	.editor-layout[data-focus='true'] .editor-sidebar {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: 17.5rem;
		transform: translateX(-100%);
		transition: transform 0.2s ease-in-out;
		z-index: 3;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
	}

	.editor-layout[data-focus='true'][data-sidebar-open='true'] .editor-sidebar {
		transform: translateX(0);
	}

	.editor-layout[data-focus='true'] .sidebar-overlay {
		display: block;
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease-in-out;
		z-index: 2;
	}

	.editor-layout[data-focus='true'][data-sidebar-open='true'] .sidebar-overlay {
		opacity: 1;
		pointer-events: auto;
	}

	.editor-layout[data-focus='true'] .sidebar-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	@media (max-width: 1024px) {
		.editor-layout {
			grid-template-columns: 1fr;
		}

		.editor-sidebar {
			position: absolute;
			top: 0;
			left: 0;
			height: 100%;
			width: 17.5rem;
			transform: translateX(-100%);
			transition: transform 0.2s ease-in-out;
			z-index: 3;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
		}

		.editor-layout[data-sidebar-open='true'] .editor-sidebar {
			transform: translateX(0);
		}

		.sidebar-overlay {
			display: block;
			position: absolute;
			inset: 0;
			background: rgba(0, 0, 0, 0.4);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.2s ease-in-out;
			z-index: 2;
		}

		.editor-layout[data-sidebar-open='true'] .sidebar-overlay {
			opacity: 1;
			pointer-events: auto;
		}

		.sidebar-toggle {
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}

		.mobile-sidebar-open {
			display: block;
			position: sticky;
			top: 0;
			z-index: 1;
			padding: 8px 12px;
			background: var(--color-background);
			border-bottom: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
		}

		.editor-layout[data-sidebar-open='true'] .mobile-sidebar-open {
			display: none;
		}

		.mobile-sidebar-button {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 6px 10px;
			border-radius: 8px;
			border: 1px solid var(--color-border, rgba(0, 0, 0, 0.12));
			background: var(--color-background-secondary, #f9fafb);
			color: var(--color-text);
			font-size: 12px;
			cursor: pointer;
		}

		.editor-panels {
			flex-direction: column;
		}

		.editor-panel--editor,
		.editor-panel--preview {
			width: 100% !important;
		}
	}

	@media (max-width: 768px) {
		.editor-toolbar {
			padding: 8px 12px;
		}

		.editor-toolbar-row {
			height: 60px;
			width: 100%;
			overflow-x: auto;
		}

		.editor-title {
			font-size: 14px;
			white-space: nowrap;
		}

		.editor-toolbar-actions {
			gap: 6px;
		}

		.editor-panel--editor {
			padding: 16px;
		}

		.editor-page {
			padding: 20px;
			max-width: 100%;
		}

		.editor-text {
			min-height: 420px;
		}
	}
</style>
