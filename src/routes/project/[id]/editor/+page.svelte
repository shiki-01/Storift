<script lang="ts">
	import { toast, confirmDialog } from '$lib/stores/toast.svelte';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { dataChange } from '$lib/stores/dataChange.svelte';
	import { chaptersDB, scenesDB, settingsDB, progressLogsDB, projectsDB, memosDB } from '$lib/db';
	import { getDateKey } from '$lib/utils/dateUtils';
	import { computeHeaderVisibility } from '$lib/utils/headerVisibility';
	import { queueChange } from '$lib/services/sync.service';
	import { filterReadOnlyMenu, isReadOnlyProject } from '$lib/utils/readOnly';
	import { AutoSave, enableUnsavedWarning, enableVisibilityAutoSave } from '$lib/utils/autoSave';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import WritingAssistant from '$lib/components/ui/WritingAssistant.svelte';
	import PrintPreview from '$lib/components/ui/PrintPreview.svelte';
	import VersionManager from '$lib/components/ui/VersionManager.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import FontSelector from '$lib/components/ui/FontSelector.svelte';
	import PreviewViewer from '$lib/components/preview/PreviewViewer.svelte';
	import PreviewSettings from '$lib/components/preview/PreviewSettings.svelte';
	import SceneExportModal from '$lib/components/ui/SceneExportModal.svelte';
	import SearchReplace from '$lib/components/ui/SearchReplace.svelte';
	import Sheet from '$lib/components/mobile/Sheet.svelte';
	import AssistBar from '$lib/components/mobile/AssistBar.svelte';
	import GoalRing from '$lib/components/mobile/GoalRing.svelte';
	import ReferenceSheet from '$lib/components/mobile/ReferenceSheet.svelte';
	import ProofreadSheet from '$lib/components/mobile/ProofreadSheet.svelte';
	import { longpress } from '$lib/utils/longpress';
	import { historyActionOf, matchesShortcut, normalizeAutoSaveMs } from '$lib/utils/shortcuts';
	import {
		typewriterScroll,
		ensureCaretVisible,
		updateDimHighlight,
		selectTextRange,
		setHistoryHandler,
		supportsHighlight,
		textRange
	} from '$lib/utils/editorInput';
	import { CrdtOpenError, type SceneDocHandle } from '$lib/crdt/doc';
	import { EditorBinding, type TextSelection } from '$lib/crdt/editorBinding';
	import { createDomAdapter, type DomEditorAdapter } from '$lib/crdt/domAdapter';
	import { trackLocalGrowth, type LocalGrowthTracker } from '$lib/crdt/progress';
	import { presenceLabel } from '$lib/crdt/presencePolicy';
	import { getSceneText, openSceneDoc } from '$lib/services/sceneText.service';
	import { startPresence, type PresenceSession } from '$lib/services/presence.service';
	import { presenceStore } from '$lib/stores/presence.svelte';
	import {
		createEditorContextMenu,
		createChapterContextMenu,
		createSceneContextMenu,
		type ContextMenuItem
	} from '$lib/utils/contextMenu';
	import { makeAnchor, rangeTextOffsets, reanchorMemos, resolveAnchor } from '$lib/utils/memos';
	import type {
		Chapter,
		Scene,
		EditorFont,
		Memo,
		MemoDraft,
		PreviewSettings as PreviewSettingsType,
		ViewMode
	} from '$lib/types';
	import { defaultPreviewSettings } from '$lib/types';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { getSystemFontName, systemFontToCss } from '$lib/utils/fonts';
	import MemoPanel from '$lib/components/memo/MemoPanel.svelte';
	import { claudeStore } from '$lib/stores/claude.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let isChapterModalOpen = $state(false);

	// デスクトップ版(Tauri)だけ、本文の横に Claude Code のパネルを出せる
	const desktop = isDesktop();
	// シーンを切り替えた時だけ、本文を軽くフェードインさせる
	let lastAnimatedSceneId: string | null = null;
	$effect(() => {
		const id = editorStore.currentScene?.id ?? null;
		if (!id || id === lastAnimatedSceneId) return;
		const first = lastAnimatedSceneId === null;
		lastAnimatedSceneId = id;
		if (first || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		editorDiv?.animate(
			[
				{ opacity: 0, transform: 'translateY(4px)' },
				{ opacity: 1, transform: 'none' }
			],
			{ duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
		);
	});

	let showClaude = $derived(
		desktop && claudeStore.open && !viewport.isMobile && !editorStore.focusMode
	);
	// メモパネルは Claude パネルと同じ位置に出す(Claude が開いているときは Claude を優先)
	let showMemo = $derived(
		editorStore.memoOpen && !showClaude && !viewport.isMobile && !editorStore.focusMode
	);
	// Claude パネルが開いたら、メモパネルは閉じる(どちらか一方だけ出す)
	$effect(() => {
		if (desktop && claudeStore.open && editorStore.memoOpen) editorStore.memoOpen = false;
	});
	let isSceneModalOpen = $state(false);
	let isRenameModalOpen = $state(false);
	let newChapterTitle = $state('');
	let newSceneTitle = $state('');
	let renameValue = $state('');
	let selectedChapterId = $state<string | null>(null);
	let autoSave: AutoSave | null = null;

	// 閲覧専用(閲覧権限、またはアクセス権の失効)。本文・章・シーンの編集の入口を無効にする。
	// 同期層にも安全網があり、UI で止め損ねた変更もリモートには送られない
	const readOnly = $derived(isReadOnlyProject(currentProjectStore.project?.id));

	// Phase 2: UI状態管理
	let showWritingAssistant = $state(false);
	let showPrintPreview = $state(false);
	let showVersionManager = $state(false);
	let showFormattingModal = $state(false);
	let showExportModal = $state(false);
	let showSearch = $state(false);
	let showProofread = $state(false);

	// プレビュー機能
	let viewMode = $state<ViewMode>('editor');
	// プレビュー設定は端末ごとに保存し、画面を移動しても初期値に戻らないようにする
	const PREVIEW_SETTINGS_KEY = 'storift:preview-settings';

	function loadPreviewSettings(): PreviewSettingsType {
		try {
			const raw = localStorage.getItem(PREVIEW_SETTINGS_KEY);
			return raw
				? { ...defaultPreviewSettings, ...JSON.parse(raw) }
				: { ...defaultPreviewSettings };
		} catch {
			return { ...defaultPreviewSettings };
		}
	}

	function updatePreviewSettings(next: PreviewSettingsType) {
		previewSettings = next;
		try {
			localStorage.setItem(PREVIEW_SETTINGS_KEY, JSON.stringify(next));
		} catch {
			// 保存できなくても、そのセッション内では反映される
		}
	}

	let previewSettings = $state<PreviewSettingsType>(loadPreviewSettings());

	// 書式設定モーダルのタブ
	let formattingTab = $state<'editor' | 'preview'>('editor');

	// コンテキストメニュー
	let contextMenu = $state<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
		targetType?: 'editor' | 'chapter' | 'scene';
		targetId?: string;
	}>({ visible: false, x: 0, y: 0, items: [] });

	let editorDiv = $state<HTMLDivElement | null>(null);
	let editorScrollContainer = $state<HTMLDivElement | null>(null);
	let previewViewerRef = $state<{ scrollToTop?: () => void } | null>(null);
	let lastSceneId = $state<string | null>(null);

	// エディタツールバーの書式設定（ローカル状態）
	let localFormatting = $state<{
		fontSize: number;
		lineHeight: number;
		letterSpacing: number;
	}>({
		fontSize: 16,
		lineHeight: 2,
		letterSpacing: 0
	});

	onMount(() => {
		// 狭い画面では章・シーン一覧が本文に重なるので、開いた直後は閉じておく
		if (window.matchMedia('(max-width: 1024px)').matches) {
			editorStore.sceneListOpen = false;
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
					// ローカル書式設定を初期化
					if (saved.editorFormatting) {
						localFormatting.fontSize = saved.editorFormatting.fontSize;
						localFormatting.lineHeight = saved.editorFormatting.lineHeight;
						localFormatting.letterSpacing = saved.editorFormatting.letterSpacing;
					}
				}
			} catch (error) {
				console.error('Failed to load settings:', error);
			}
		})();

		// キーボードショートカット(設定画面で変更できる)
		const handleKeyDown = (e: KeyboardEvent) => {
			const shortcuts = settingsStore.settings.shortcuts;
			// メモパネルの開閉(固定。Ctrl+Shift+M)
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'm') {
				e.preventDefault();
				toggleMemoPanel();
			} else if (matchesShortcut(e, shortcuts.find) || matchesShortcut(e, shortcuts.replace)) {
				e.preventDefault();
				void openSearch();
			} else if (matchesShortcut(e, shortcuts.save)) {
				e.preventDefault();
				if (session) void session.handle.flush();
				else if (editorStore.currentScene && editorStore.isDirty) void handleSave();
			} else if (matchesShortcut(e, shortcuts.newChapter)) {
				e.preventDefault();
				if (!readOnly) isChapterModalOpen = true;
			} else if (matchesShortcut(e, shortcuts.newScene)) {
				e.preventDefault();
				const chapterId =
					editorStore.currentScene?.chapterId ?? currentProjectStore.chapters[0]?.id;
				if (chapterId) openSceneModal(chapterId);
			}
		};
		window.addEventListener('keydown', handleKeyDown);

		// 自動保存を初期化
		autoSave = new AutoSave({
			interval: 30000, // 30秒
			onSave: async () => {
				await handleSave();
			},
			isDirty: () =>
				editorStore.isDirty && editorStore.currentScene !== null && settingsStore.settings.autoSave,
			onError: (error) => {
				console.error('Auto-save error:', error);
				saveFailed = true;
			},
			onSuccess: () => {
				console.log('✅ Auto-saved');
			}
		});
		autoSave.start();

		// 離脱前の警告を有効化
		const removeWarning = enableUnsavedWarning(() => editorStore.isDirty);

		// タブ非表示時の自動保存を有効化
		const removeVisibilitySave = enableVisibilityAutoSave(saveOnLeave);

		// ページを閉じる/バックグラウンドへ移るときも保存する(自動保存の設定に関わらず)
		const handlePageHide = () => void saveOnLeave();
		window.addEventListener('pagehide', handlePageHide);

		// クリーンアップ関数を同期的に返す
		return () => {
			if (autoSave) autoSave.stop();
			removeWarning();
			removeVisibilitySave();
			window.removeEventListener('pagehide', handlePageHide);
			window.removeEventListener('keydown', handleKeyDown);
		};
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

	const handleCreateChapter = async () => {
		if (readOnly || !newChapterTitle.trim() || !currentProjectStore.project) return;

		try {
			const chapter = await chaptersDB.create({
				projectId: currentProjectStore.project.id,
				title: newChapterTitle,
				synopsis: ''
			});
			currentProjectStore.chapters = [...currentProjectStore.chapters, chapter];
			isChapterModalOpen = false;
			newChapterTitle = '';
			toast.success('章を作成しました');

			// 同期キューに追加
			await queueChange('chapters', chapter.id, 'create');
		} catch (error) {
			console.error('Failed to create chapter:', error);
			toast.error('章の作成に失敗しました');
		}
	};

	const handleCreateScene = async () => {
		if (readOnly || !newSceneTitle.trim() || !selectedChapterId || !currentProjectStore.project) {
			return;
		}

		try {
			const scene = await scenesDB.create({
				chapterId: selectedChapterId,
				projectId: currentProjectStore.project.id,
				title: newSceneTitle,
				content: ''
			});
			currentProjectStore.scenes = [...currentProjectStore.scenes, scene];
			isSceneModalOpen = false;
			showSceneSheet = false;
			newSceneTitle = '';
			editorStore.currentScene = scene;
			rememberLastScene(scene.id);
			toast.success('シーンを作成しました');

			// 同期キューに追加
			await queueChange('scenes', scene.id, 'create');
		} catch (error) {
			console.error('Failed to create scene:', error);
			toast.error('シーンの作成に失敗しました');
		}
	};

	const handleSave = async () => {
		if (readOnly) return;
		// 共同編集のシーンの本文は Y が正(ミラーは共同編集側が行う)。従来の保存経路は使わない
		if (collabActive) return;
		if (!editorStore.currentScene || !editorStore.isDirty || editorStore.isSaving) return;

		const sceneId = editorStore.currentScene.id;
		const savedContent = editorStore.content;
		const previousCount = editorStore.currentScene.characterCount;

		editorStore.isSaving = true;
		try {
			await scenesDB.update(sceneId, { content: savedContent });
			saveFailed = false;
			// 保存中に入力が続いていた場合は未保存のまま残す(次の自動保存で拾う)
			if (editorStore.content === savedContent) editorStore.isDirty = false;

			// 更新後のシーンを再取得。本文・未保存状態には触れず、メタ情報だけ反映する
			const updatedScene = await scenesDB.getById(sceneId);
			if (updatedScene) {
				const index = currentProjectStore.scenes.findIndex((s) => s.id === updatedScene.id);
				if (index !== -1) currentProjectStore.scenes[index] = updatedScene;
				if (editorStore.currentScene?.id === sceneId) editorStore.updateSceneMeta(updatedScene);
			}

			// 同期キューに追加
			await queueChange('scenes', sceneId, 'update');

			// 執筆文字数を今日の進捗へ自動記録(増えた分のみ)
			const delta = savedContent.length - previousCount;
			const projectId = currentProjectStore.project?.id;
			if (delta > 0 && projectId) {
				try {
					await progressLogsDB.addProgress(projectId, getDateKey(Date.now()), delta, 0, sceneId);
					todayWritten += delta;
				} catch (error) {
					// 進捗の記録に失敗しても、本文の保存は成功扱いにする
					console.error('Failed to record progress:', error);
				}
			}
		} catch (error) {
			console.error('Failed to save scene:', error);
			saveFailed = true;
		} finally {
			editorStore.isSaving = false;
		}
	};

	// 離脱時の保存。保存中(isSaving)でも、その時点の本文を必ず書き込む。自動保存の設定にも依存しない
	async function saveOnLeave() {
		if (readOnly) return;
		// 共同編集のシーン: Y の状態の永続化と、保留中の送信の試行
		if (session) {
			await recordProgress(session);
			try {
				await session.handle.flush();
			} catch (error) {
				console.error('Failed to flush collaborative scene on leave:', error);
			}
			return;
		}
		const scene = editorStore.currentScene;
		if (!scene || !editorStore.isDirty) return;
		const sceneId = scene.id;
		const content = editorStore.content;
		try {
			await scenesDB.update(sceneId, { content });
			if (editorStore.currentScene?.id === sceneId && editorStore.content === content) {
				editorStore.isDirty = false;
			}
			await queueChange('scenes', sceneId, 'update');
		} catch (error) {
			console.error('Failed to save scene on leave:', error);
			saveFailed = true;
		}
	}

	// ルート遷移の直前に保存を開始する(同一ドキュメント内の遷移なので IndexedDB への書き込みは完了する)
	beforeNavigate(() => {
		clearSaveTimers();
		void saveOnLeave();
	});

	onDestroy(() => {
		clearSaveTimers();
		void saveOnLeave();
		// 共同編集のハンドルを手放す(参照カウントを下げ、最後なら保存・送信・圧縮をして閉じる)
		const previous = detachSession();
		if (previous) void closeSession(previous);
		if (reanchorTimer) clearTimeout(reanchorTimer);
	});

	// 検索・置換はDBを直接書き換えるため、開く前に保存し、閉じたら画面側のデータを読み直す
	async function openSearch() {
		if (!(await flushSave())) {
			toast.error('未保存の変更を保存できませんでした');
			return;
		}
		showSearch = true;
	}

	async function closeSearch() {
		showSearch = false;
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
			if (currentId) {
				const fresh = scenes.find((s) => s.id === currentId);
				// 内容が変わっていれば本文も差し替える
				if (fresh && fresh.content !== editorStore.content) editorStore.currentScene = fresh;
			}
		} catch (error) {
			console.error('Failed to reload after search:', error);
		}
	}

	async function openSceneById(sceneId: string) {
		// closeSearch の読み直しが終わってから開く
		await closeSearch();
		const scene = currentProjectStore.scenes.find((s) => s.id === sceneId);
		if (scene) await goToScene(scene);
	}

	// 校正の指摘箇所を選択し、見える位置までスクロールする
	function jumpToText(start: number, end: number) {
		if (!editorDiv) return;
		editorDiv.focus({ preventScroll: true });
		if (selectTextRange(editorDiv, start, end) && editorScrollContainer) {
			typewriterScroll(editorScrollContainer, 0.35);
		}
	}

	// ===== 共同編集(共有プロジェクトのシーン本文は Y.Text が正) =====
	// off: 共同編集の対象ではない / connecting: 接続中(編集不可) / on: 共同編集中 /
	// fallback: 接続できなかったので従来の編集(Scene.content)で扱う
	type CollabState = 'off' | 'connecting' | 'on' | 'fallback';

	interface CollabSession {
		sceneId: string;
		projectId: string;
		handle: SceneDocHandle;
		binding: EditorBinding;
		adapter: DomEditorAdapter;
		progress: LocalGrowthTracker;
		cleanups: (() => void)[];
	}

	let collab = $state<CollabState>('off');
	let collabNotice = $state('');
	// 権限エラー(アクセス失効など)で、ハンドルが読み取り専用になった
	let collabReadOnly = $state(false);
	// 'on' / 'connecting' の間は従来の保存経路(handleSave・自動保存)を使わない
	const collabActive = $derived(collab === 'on' || collab === 'connecting');
	const editable = $derived(!readOnly && collab !== 'connecting' && !collabReadOnly);
	const collabProject = $derived(
		currentProjectStore.project?.sharing?.status === 'active' &&
			!currentProjectStore.project.sharing.revokedAt
	);

	let session: CollabSession | null = null;
	let collabTarget: string | null = null;
	let collabToken = 0;
	let progressTimer: ReturnType<typeof setTimeout> | null = null;
	let reanchorTimer: ReturnType<typeof setTimeout> | null = null;
	let dragSelection: TextSelection | null = null;

	const PROGRESS_DELAY = 5000;
	const REANCHOR_DELAY = 800;

	const COLLAB_NOTICES: Partial<Record<CrdtOpenError['reason'], string>> = {
		offline: 'オフラインのため共同編集は再接続後に有効になります',
		'no-snapshot': '共同編集の本文はまだ作成されていません(編集権限のある人が開くと有効になります)',
		denied: 'この本文を共同編集する権限がありません'
	};

	/** 開いているシーンを共同編集の対象にする(null なら従来どおり)。前のシーンのハンドルは閉じる */
	async function switchCollab(sceneId: string | null) {
		const token = ++collabToken;
		collabTarget = sceneId;
		const previous = detachSession();
		collab = sceneId ? 'connecting' : 'off';
		collabNotice = '';
		collabReadOnly = false;
		// 前のシーンの保存・送信・圧縮は待たずに、新しいシーンを開く
		if (previous) void closeSession(previous);
		if (!sceneId) return;

		let handle: SceneDocHandle;
		try {
			handle = await openSceneDoc(sceneId);
		} catch (error) {
			if (token !== collabToken) return;
			const reason = error instanceof CrdtOpenError ? error.reason : 'unavailable';
			if (!(error instanceof CrdtOpenError)) console.error('Failed to open scene doc:', error);
			collabNotice =
				COLLAB_NOTICES[reason] ?? '共同編集を開始できなかったため、通常の編集で開きます';
			collab = 'fallback';
			return;
		}
		if (token !== collabToken) {
			await handle.destroy().catch(() => undefined);
			return;
		}
		startSession(sceneId, handle);
	}

	function startSession(sceneId: string, handle: SceneDocHandle) {
		const adapter = createDomAdapter();
		const binding = new EditorBinding({
			doc: handle,
			adapter,
			onText: (text) => {
				if (editorStore.currentScene?.id === sceneId) editorStore.setContentFromSource(text);
			}
		});
		const progress = trackLocalGrowth(handle.ytext);
		const next: CollabSession = {
			sceneId,
			projectId: currentProjectStore.project?.id ?? '',
			handle,
			binding,
			adapter,
			progress,
			cleanups: [
				handle.onLocalChange(() => scheduleProgress()),
				handle.onRemoteChange(() => scheduleReanchor()),
				handle.onReadOnlyChange((value) => (collabReadOnly = value))
			]
		};
		session = next;
		collabReadOnly = handle.readOnly;
		editorStore.crdtSceneId = sceneId;
		editorStore.setContentFromSource(handle.ytext.toString());
		editorStore.isDirty = false;
		// 元に戻す/やり直す(補助入力バー)も自分の編集だけを対象にした履歴へ
		setHistoryHandler({ undo: () => binding.undo(), redo: () => binding.redo() });
		editorStore.externalTextSink = (text) => binding.setExternalText(text);
		collab = 'on';
	}

	/** 同期的に切り離す(以後の入力・保存の対象にしない)。閉じる処理は closeSession */
	function detachSession(): CollabSession | null {
		const current = session;
		session = null;
		editorStore.crdtSceneId = null;
		editorStore.externalTextSink = null;
		setHistoryHandler(null);
		if (progressTimer) clearTimeout(progressTimer);
		progressTimer = null;
		if (!current) return null;
		for (const cleanup of current.cleanups) cleanup();
		current.binding.destroy();
		return current;
	}

	async function closeSession(closing: CollabSession) {
		try {
			await recordProgress(closing);
			closing.progress.dispose();
			await closing.handle.flush();
		} catch (error) {
			console.error('Failed to flush collaborative scene:', error);
		} finally {
			await closing.handle
				.destroy()
				.catch((error) => console.error('Failed to close scene doc:', error));
		}
	}

	/** 自分の入力(リモート由来を除く)の純増分を、今日の進捗へ記録する */
	async function recordProgress(target: CollabSession | null) {
		if (!target) return;
		const delta = target.progress.take();
		if (delta <= 0 || !target.projectId) return;
		try {
			await progressLogsDB.addProgress(
				target.projectId,
				getDateKey(Date.now()),
				delta,
				0,
				target.sceneId
			);
			if (currentProjectStore.project?.id === target.projectId) todayWritten += delta;
		} catch (error) {
			// 進捗の記録に失敗しても、本文の保存には影響しない
			console.error('Failed to record progress:', error);
		}
	}

	function scheduleProgress() {
		if (progressTimer) return;
		progressTimer = setTimeout(() => {
			progressTimer = null;
			void recordProgress(session);
		}, PROGRESS_DELAY);
	}

	/** リモート由来の変更のあと、範囲メモの位置を現在の本文に合わせ直す(見つからないものは孤立表示のまま) */
	function scheduleReanchor() {
		if (reanchorTimer) clearTimeout(reanchorTimer);
		reanchorTimer = setTimeout(() => {
			reanchorTimer = null;
			void reanchorSceneMemos();
		}, REANCHOR_DELAY);
	}

	async function reanchorSceneMemos() {
		const current = session;
		if (!current) return;
		const targets = memoAnchors.filter((m) => m.sceneId === current.sceneId);
		const updates = reanchorMemos(current.handle.ytext.toString(), targets);
		if (updates.length === 0) return;
		try {
			for (const update of updates) await memosDB.update(update.id, { anchor: update.anchor });
			editorStore.bumpMemos();
		} catch (error) {
			console.error('Failed to update memo anchors:', error);
		}
	}

	async function retryCollab() {
		if (collab !== 'fallback') return;
		const sceneId = editorStore.currentScene?.id ?? null;
		if (!sceneId) return;
		// 通常の編集で入れた変更を先に保存してから、共同編集として開き直す
		if (!(await flushSave())) {
			toast.error('未保存の変更を保存できませんでした');
			return;
		}
		await switchCollab(sceneId);
	}

	// 開いているシーンが共有プロジェクト(共有が有効)のものなら、共同編集として開く
	$effect(() => {
		const sceneId = editorStore.currentScene?.id ?? null;
		const target = sceneId && collabProject ? sceneId : null;
		untrack(() => {
			if (target === collabTarget) return;
			void switchCollab(target);
		});
	});

	// 本文の DOM が(表示モードの切り替えなどで)作り直されたら、結合し直す
	$effect(() => {
		const element = editorDiv;
		if (!element || collab !== 'on' || !session) return;
		const current = session;
		current.adapter.setRoot(element);
		// 最初に必ず書き直して、Svelte が管理していた元のテキストノードを DOM から外す
		current.adapter.setText(current.binding.text);
		current.binding.resync();
		return () => current.adapter.setRoot(null);
	});

	// 執筆支援・校正・Claude などが editorStore.content を書き換えたら、差分を Y へ反映する
	$effect(() => {
		const content = editorStore.content;
		const sceneId = editorStore.currentScene?.id;
		untrack(() => {
			const current = session;
			if (!current || current.sceneId !== sceneId) return;
			if (content !== current.binding.text) {
				if (!current.binding.setExternalText(content)) {
					// 読み取り専用などで反映できない: ストアを Y の本文に戻す
					editorStore.setContentFromSource(current.binding.text);
				}
			}
			editorStore.isDirty = false;
		});
	});

	function handleBeforeInput(e: InputEvent) {
		if (session?.binding.handleBeforeInput(e.inputType)) e.preventDefault();
	}

	function handleCompositionStart() {
		session?.binding.compositionStart();
	}

	function handleCompositionEnd() {
		if (!session) return;
		session.binding.compositionEnd();
		onTyped();
	}

	// 元に戻す/やり直す: 共同編集のシーンでは自分の編集だけを戻す履歴へ
	function handleEditorKeydown(e: KeyboardEvent) {
		if (!session || e.isComposing) return;
		const action = historyActionOf(e, settingsStore.settings.shortcuts);
		if (!action) return;
		e.preventDefault();
		if (action === 'undo') session.binding.undo();
		else session.binding.redo();
		onTyped();
	}

	function handleDragStart() {
		dragSelection = session?.adapter.getSelection() ?? null;
	}

	function handleDrop(e: DragEvent) {
		if (!session) return;
		e.preventDefault();
		const moveFrom = dragSelection;
		dragSelection = null;
		if (readOnly || collabReadOnly) return;
		const text = e.dataTransfer?.getData('text/plain') ?? '';
		const index = session.adapter.indexFromPoint(e.clientX, e.clientY);
		if (!text || index === null) return;
		// Ctrl/Alt を押していればコピー、そうでなければ(このエディタ内からのドラッグは)移動
		const copy = e.ctrlKey || e.altKey;
		if (
			session.binding.dropText(
				text.replace(/\r\n?/g, '\n'),
				index,
				copy ? undefined : (moveFrom ?? undefined)
			)
		) {
			onTyped();
		}
	}

	// ===== 在席表示(誰がこのプロジェクトを開いているか) =====
	let presenceSession: PresenceSession | null = null;
	const presenceKey = $derived.by(() => {
		const sharing = currentProjectStore.project?.sharing;
		return sharing?.status === 'active' && !sharing.revokedAt
			? `${currentProjectStore.project?.id}:${sharing.connectionId ?? ''}`
			: '';
	});

	$effect(() => {
		if (!presenceKey) return;
		const project = untrack(() => currentProjectStore.project);
		if (!project) return;
		const sceneId = untrack(() => editorStore.currentScene?.id ?? null);
		let cancelled = false;
		let started: PresenceSession | null = null;
		void startPresence(project, sceneId)
			.then((created) => {
				if (cancelled) void created?.stop();
				else {
					started = created;
					presenceSession = created;
					created?.setScene(untrack(() => editorStore.currentScene?.id ?? null));
				}
			})
			.catch((error) => console.debug('Failed to start presence:', error));
		return () => {
			cancelled = true;
			presenceSession = null;
			void started?.stop();
		};
	});

	$effect(() => {
		presenceSession?.setScene(editorStore.currentScene?.id ?? null);
	});

	const otherMembers = $derived(presenceStore.others);
	const presenceText = $derived(presenceLabel(otherMembers, 5));
	const membersOnScene = (sceneId: string) => otherMembers.filter((m) => m.sceneId === sceneId);

	// ===== メモ(執筆画面のサイドパネル・範囲メモ・本文の強調) =====
	const MEMO_HIGHLIGHT = 'storift-memo';
	// 本文の強調に使う、この作品のメモ(範囲があるものだけ)
	let memoAnchors = $state<Memo[]>([]);

	// パネルは Claude パネルと同じ位置に出すので、Claude は閉じる
	function openMemoPanel(draft: MemoDraft | null = null) {
		if (desktop) claudeStore.open = false;
		editorStore.requestMemo(draft);
	}

	function toggleMemoPanel() {
		if (showMemo) editorStore.memoOpen = false;
		else openMemoPanel();
	}

	/** 本文で選んだ範囲を、新規メモの範囲にする(選択がなければ null) */
	function memoDraftFromSelection(): MemoDraft | null {
		const scene = editorStore.currentScene;
		const selection = window.getSelection();
		if (!scene || !editorDiv || !selection || selection.isCollapsed || selection.rangeCount === 0) {
			return null;
		}
		const offsets = rangeTextOffsets(editorDiv, selection.getRangeAt(0));
		if (!offsets || offsets.end <= offsets.start) return null;
		return {
			sceneId: scene.id,
			anchor: makeAnchor(editorStore.content, offsets.start, offsets.end)
		};
	}

	function memoFromSelection() {
		const draft = memoDraftFromSelection();
		if (!draft) {
			toast.info('本文の範囲を選択してからメモを付けてください');
			return;
		}
		openMemoPanel(draft);
	}

	/** メモの範囲へ移る。別のシーンのメモなら、先にそのシーンを開く */
	async function jumpToMemo(memo: Memo) {
		if (!memo.sceneId) return;
		if (memo.sceneId !== editorStore.currentScene?.id) {
			const scene = currentProjectStore.scenes.find((s) => s.id === memo.sceneId);
			if (!scene) return;
			await goToScene(scene);
		}
		if (viewMode === 'preview') viewMode = 'editor';
		await tick();
		if (!memo.anchor) return;
		const span = resolveAnchor(editorStore.content, memo.anchor);
		if (!span) {
			toast.info('本文の位置が見つかりませんでした');
			return;
		}
		jumpToText(span.start, span.end);
	}

	async function reloadMemoAnchors() {
		const projectId = currentProjectStore.project?.id;
		if (!projectId) return;
		try {
			memoAnchors = (await memosDB.getByProject(projectId)).filter((m) => !!m.anchor);
		} catch (error) {
			console.error('Failed to load memo anchors:', error);
		}
	}

	$effect(() => {
		void editorStore.memoVersion;
		void dataChange.revision('memos');
		void currentProjectStore.project?.id;
		void reloadMemoAnchors();
	});

	/**
	 * 現在のシーンの範囲メモを薄く強調する。CSS Custom Highlight API が無ければ何もしない。
	 * 本文の DOM は書き換えない(強調は Range の集合として別に持つ)。
	 */
	function updateMemoHighlight() {
		if (!supportsHighlight()) return;
		const highlights = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
		const scene = editorStore.currentScene;
		const root = editorDiv;
		const ranges: Range[] = [];
		if (scene && root) {
			for (const memo of memoAnchors) {
				if (!memo.anchor || memo.sceneId !== scene.id) continue;
				const span = resolveAnchor(editorStore.content, memo.anchor);
				const range = span ? textRange(root, span.start, span.end) : null;
				if (range) ranges.push(range);
			}
		}
		if (ranges.length > 0) highlights.set(MEMO_HIGHLIGHT, new Highlight(...ranges));
		else highlights.delete(MEMO_HIGHLIGHT);
	}

	// 本文・シーン・メモ・表示が変わったら、DOM の反映を待ってから強調を描き直す
	$effect(() => {
		void editorStore.content;
		void editorStore.currentScene;
		void memoAnchors;
		void effectiveViewMode;
		void tick().then(updateMemoHighlight);
	});

	onDestroy(() => {
		if (supportsHighlight()) {
			(CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(MEMO_HIGHLIGHT);
		}
	});

	// 未保存の変更があれば保存してから次の操作へ進む。未保存のまま残った場合は false
	async function flushSave(): Promise<boolean> {
		clearSaveTimers();
		if (session) {
			await recordProgress(session);
			try {
				await session.handle.flush();
			} catch (error) {
				console.error('Failed to flush collaborative scene:', error);
			}
			return true;
		}
		for (let attempt = 0; attempt < 3; attempt++) {
			// 保存中なら完了を待つ(最大10秒)
			for (let i = 0; i < 250 && editorStore.isSaving; i++) {
				await new Promise((r) => setTimeout(r, 40));
			}
			if (editorStore.isSaving) return false;
			if (!editorStore.isDirty || !editorStore.currentScene) return true;
			await handleSave();
		}
		return !editorStore.isDirty || !editorStore.currentScene;
	}

	async function handleSceneSelect(scene: (typeof currentProjectStore.scenes)[0]) {
		if (scene.id !== editorStore.currentScene?.id && !(await flushSave())) {
			toast.error('未保存の変更を保存できなかったため、シーンを切り替えませんでした');
			return;
		}
		editorStore.currentScene = scene;
		rememberLastScene(scene.id);
		if (window.matchMedia('(max-width: 1024px)').matches) {
			editorStore.sceneListOpen = false;
		}
		showSceneSheet = false;
	}

	function openSceneModal(chapterId: string) {
		if (readOnly) return;
		selectedChapterId = chapterId;
		isSceneModalOpen = true;
	}

	// コンテキストメニュー - チャプター
	function handleChapterContextMenu(
		e: Pick<MouseEvent, 'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation'>,
		chapter: Chapter
	) {
		e.preventDefault();
		e.stopPropagation();

		const chapterIndex = currentProjectStore.chapters.findIndex((c) => c.id === chapter.id);
		const menuItems = createChapterContextMenu({
			chapter,
			onRename: () => handleRenameChapter(chapter),
			onDelete: () => handleDeleteChapter(chapter),
			onDuplicate: () => handleDuplicateChapter(chapter),
			onAddScene: () => openSceneModal(chapter.id),
			onMoveUp: chapterIndex > 0 ? () => handleMoveChapter(chapter, 'up') : undefined,
			onMoveDown:
				chapterIndex < currentProjectStore.chapters.length - 1
					? () => handleMoveChapter(chapter, 'down')
					: undefined,
			canMoveUp: chapterIndex > 0,
			canMoveDown: chapterIndex < currentProjectStore.chapters.length - 1
		});
		const items = readOnly ? filterReadOnlyMenu(menuItems) : menuItems;
		if (items.length === 0) return;

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
	function handleSceneContextMenu(
		e: Pick<MouseEvent, 'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation'>,
		scene: Scene
	) {
		e.preventDefault();
		e.stopPropagation();

		const chapterScenes = currentProjectStore.scenesByChapter.get(scene.chapterId) || [];
		const sceneIndex = chapterScenes.findIndex((s) => s.id === scene.id);

		const menuItems = createSceneContextMenu({
			scene,
			onOpen: () => handleSceneSelect(scene),
			onRename: () => handleRenameScene(scene),
			onDelete: () => handleDeleteScene(scene),
			onDuplicate: () => handleDuplicateScene(scene),
			onMoveUp: sceneIndex > 0 ? () => handleMoveScene(scene, 'up') : undefined,
			onMoveDown:
				sceneIndex < chapterScenes.length - 1 ? () => handleMoveScene(scene, 'down') : undefined,
			canMoveUp: sceneIndex > 0,
			canMoveDown: sceneIndex < chapterScenes.length - 1
		});
		const items = readOnly ? filterReadOnlyMenu(menuItems) : menuItems;

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

	const applyRename = async () => {
		if (readOnly || !renameValue.trim() || !contextMenu.targetId) return;

		try {
			if (contextMenu.targetType === 'chapter') {
				await chaptersDB.update(contextMenu.targetId, { title: renameValue });
				const updatedChapter = await chaptersDB.getById(contextMenu.targetId);
				if (updatedChapter) {
					const index = currentProjectStore.chapters.findIndex(
						(c) => c.id === contextMenu.targetId
					);
					if (index !== -1) {
						currentProjectStore.chapters[index] = updatedChapter;
					}
				}
				await queueChange('chapters', contextMenu.targetId, 'update');
			} else if (contextMenu.targetType === 'scene') {
				await scenesDB.update(contextMenu.targetId, { title: renameValue });
				const updatedScene = await scenesDB.getById(contextMenu.targetId);
				if (updatedScene) {
					const index = currentProjectStore.scenes.findIndex((s) => s.id === contextMenu.targetId);
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
			toast.success('名前を変更しました');
		} catch (error) {
			console.error('Failed to rename:', error);
			toast.error('名前の変更に失敗しました');
		}
	};

	// 削除処理
	async function handleDeleteChapter(chapter: Chapter) {
		if (readOnly) return;
		if (
			!(await confirmDialog({
				message: `章「${chapter.title}」とそのシーンを削除しますか？`,
				danger: true
			}))
		)
			return;

		try {
			// チャプター内のシーンを削除
			const scenes = currentProjectStore.scenesByChapter.get(chapter.id) || [];
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

			if (editorStore.currentScene?.chapterId === chapter.id) {
				editorStore.currentScene = null;
			}
			toast.success(`章「${chapter.title}」を削除しました`);
		} catch (error) {
			console.error('Failed to delete chapter:', error);
			toast.error('章の削除に失敗しました');
		}
	}

	async function handleDeleteScene(scene: Scene) {
		if (readOnly) return;
		if (
			!(await confirmDialog({ message: `シーン「${scene.title}」を削除しますか？`, danger: true }))
		)
			return;

		try {
			await scenesDB.delete(scene.id);
			await queueChange('scenes', scene.id, 'delete');

			currentProjectStore.scenes = currentProjectStore.scenes.filter((s) => s.id !== scene.id);

			if (editorStore.currentScene?.id === scene.id) {
				editorStore.currentScene = null;
			}
			toast.success(`シーン「${scene.title}」を削除しました`);
		} catch (error) {
			console.error('Failed to delete scene:', error);
			toast.error('シーンの削除に失敗しました');
		}
	}

	// 複製する本文。共有プロジェクトでは、ミラー(Scene.content)より新しいことがある共同編集の本文を使う
	async function currentContentOf(scene: Scene): Promise<string> {
		if (!collabProject) return scene.content;
		return (await getSceneText(scene.id)) ?? scene.content;
	}

	// 複製処理
	async function handleDuplicateChapter(chapter: Chapter) {
		if (readOnly || !currentProjectStore.project) return;

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
					content: await currentContentOf(scene)
				});
				currentProjectStore.scenes = [...currentProjectStore.scenes, newScene];
				await queueChange('scenes', newScene.id, 'create');
			}
		} catch (error) {
			console.error('Failed to duplicate chapter:', error);
			toast.error('章の複製に失敗しました');
		}
	}

	async function handleDuplicateScene(scene: Scene) {
		if (readOnly || !currentProjectStore.project) return;

		try {
			const newScene = await scenesDB.create({
				chapterId: scene.chapterId,
				projectId: currentProjectStore.project.id,
				title: `${scene.title} (コピー)`,
				content: await currentContentOf(scene)
			});

			currentProjectStore.scenes = [...currentProjectStore.scenes, newScene];
			await queueChange('scenes', newScene.id, 'create');
			toast.success('シーンを複製しました');
		} catch (error) {
			console.error('Failed to duplicate scene:', error);
			toast.error('シーンの複製に失敗しました');
		}
	}

	// 移動処理
	async function handleMoveChapter(chapter: Chapter, direction: 'up' | 'down') {
		if (readOnly) return;
		const chapters = [...currentProjectStore.chapters];
		const index = chapters.findIndex((c) => c.id === chapter.id);
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
		if (readOnly) return;
		const chapterScenes = [...(currentProjectStore.scenesByChapter.get(scene.chapterId) || [])];
		const index = chapterScenes.findIndex((s) => s.id === scene.id);
		if (index === -1) return;

		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= chapterScenes.length) return;

		// 順序を入れ替え
		[chapterScenes[index], chapterScenes[newIndex]] = [
			chapterScenes[newIndex],
			chapterScenes[index]
		];

		// order を更新
		for (let i = 0; i < chapterScenes.length; i++) {
			await scenesDB.update(chapterScenes[i].id, { order: i });
			await queueChange('scenes', chapterScenes[i].id, 'update');
		}

		// ストアを更新
		const allScenes = currentProjectStore.scenes.map((s) => {
			const updated = chapterScenes.find((cs) => cs.id === s.id);
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

	async function updateFormatting() {
		try {
			await settingsDB.update({
				editorFormatting: {
					fontSize: localFormatting.fontSize,
					lineHeight: localFormatting.lineHeight,
					letterSpacing: localFormatting.letterSpacing,
					paragraphSpacing: settingsStore.editorFormatting?.paragraphSpacing ?? 16
				}
			});
			settingsStore.editorFormatting = {
				fontSize: localFormatting.fontSize,
				lineHeight: localFormatting.lineHeight,
				letterSpacing: localFormatting.letterSpacing,
				paragraphSpacing: settingsStore.editorFormatting?.paragraphSpacing ?? 16
			};
			showFormattingModal = false;
		} catch (error) {
			console.error('Failed to save formatting:', error);
		}
	}

	function openFormattingModal() {
		// モーダルを開く際に現在の設定を読み込む
		if (settingsStore.editorFormatting) {
			localFormatting.fontSize = settingsStore.editorFormatting.fontSize ?? 16;
			localFormatting.lineHeight = settingsStore.editorFormatting.lineHeight ?? 2;
			localFormatting.letterSpacing = settingsStore.editorFormatting.letterSpacing ?? 0;
		}
		showFormattingModal = true;
	}

	// フォントファミリーを取得
	function getFontFamily(font: EditorFont): string {
		const systemName = getSystemFontName(font);
		if (systemName) return systemFontToCss(systemName);
		const fontMap: Record<string, string> = {
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

	// contentEditable div用の入力ハンドラ
	function handleEditorInput(e: Event) {
		if (readOnly) return;
		if (collabActive) {
			// 共同編集: DOM の変化を Y へ反映する(変換中は保留される)。Y の本文がストアへ反映される
			session?.binding.handleInput();
			onTyped();
			return;
		}
		const target = e.target as HTMLDivElement;
		editorStore.content = target.innerText;
		onTyped();
	}

	// DOM 側の変更(切り取り・貼り付けなど)をストアへ反映する
	function syncContentFromDom() {
		if (readOnly) return;
		if (session) {
			session.binding.handleInput();
			return;
		}
		if (editorDiv) editorStore.content = editorDiv.innerText;
	}

	// 貼り付け時にプレーンテキストとして処理（Undo履歴を維持）
	function handlePaste(e: ClipboardEvent) {
		e.preventDefault();
		if (readOnly) return;
		const text = e.clipboardData?.getData('text/plain') ?? '';

		if (collabActive) {
			// 共同編集: 選択範囲をテキストで置き換える(Y に入れてから DOM に書く)
			if (session?.binding.insertText(text.replace(/\r\n?/g, '\n'))) onTyped();
			return;
		}

		// execCommand を使用してテキストを挿入（ブラウザのUndo履歴に記録される）
		document.execCommand('insertText', false, text);

		// contentを更新
		if (editorDiv) {
			editorStore.content = editorDiv.innerText;
		}
		editorStore.isDirty = true;
	}

	// contentEditable div用のコンテキストメニューハンドラ
	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();

		const selection = window.getSelection();
		const hasSelection = selection ? selection.toString().length > 0 : false;

		const menuItems = createEditorContextMenu({
			scene: editorStore.currentScene,
			chapter:
				currentProjectStore.chapters.find((c) => c.id === editorStore.currentScene?.chapterId) ||
				null,
			hasSelection,
			onSave: handleSave,
			onCopy: async () => {
				const selection = window.getSelection();
				if (selection) {
					await navigator.clipboard.writeText(selection.toString());
				}
			},
			onCut: async () => {
				const selection = window.getSelection();
				if (selection && selection.rangeCount > 0) {
					await navigator.clipboard.writeText(selection.toString());
					const range = selection.getRangeAt(0);
					range.deleteContents();
					syncContentFromDom();
				}
			},
			onPaste: async () => {
				const text = await navigator.clipboard.readText();
				const selection = window.getSelection();
				if (selection && selection.rangeCount > 0) {
					const range = selection.getRangeAt(0);
					range.deleteContents();
					const textNode = document.createTextNode(text);
					range.insertNode(textNode);
					range.setStartAfter(textNode);
					range.setEndAfter(textNode);
					selection.removeAllRanges();
					selection.addRange(range);
					syncContentFromDom();
				}
			},
			onSelectAll: () => {
				const range = document.createRange();
				if (editorDiv) {
					range.selectNodeContents(editorDiv);
					selection?.removeAllRanges();
					selection?.addRange(range);
				}
			},
			onRename: () => handleRenameScene(editorStore.currentScene!),
			onDelete: () => handleDeleteScene(editorStore.currentScene!),
			onDuplicate: () => handleDuplicateScene(editorStore.currentScene!),
			onExport: () => (showPrintPreview = true),
			onPrint: () => (showPrintPreview = true),
			onVersionHistory: () => (showVersionManager = true),
			onMemo: memoFromSelection
		});
		const items = readOnly ? filterReadOnlyMenu(menuItems) : menuItems;

		contextMenu = {
			visible: true,
			x: e.clientX,
			y: e.clientY,
			items,
			targetType: 'editor'
		};
	}

	// contentを更新したときにdivの内容も更新
	$effect(() => {
		// 共同編集中は EditorBinding が DOM を書く
		if (collab === 'on') return;
		if (editorDiv && editorStore.content !== editorDiv.innerText) {
			// カーソル位置を保存
			const selection = window.getSelection();
			let offset = 0;

			// 選択範囲が存在する場合のみカーソル位置を取得
			if (selection && selection.rangeCount > 0) {
				try {
					const range = selection.getRangeAt(0);
					offset = range.startOffset;
				} catch {
					// getRangeAt失敗時はoffset = 0のまま
				}
			}

			// eslint-disable-next-line svelte/no-dom-manipulating -- contenteditable の中身は Svelte の管理外
			editorDiv.innerText = editorStore.content;

			// カーソル位置を復元（可能な限り）
			try {
				if (editorDiv.firstChild && selection) {
					const newRange = document.createRange();
					const textNode = editorDiv.firstChild;
					const safeOffset = Math.min(offset, textNode.textContent?.length ?? 0);
					newRange.setStart(textNode, safeOffset);
					newRange.collapse(true);
					selection.removeAllRanges();
					selection.addRange(newRange);
				}
			} catch {
				// カーソル復元失敗時は無視
			}
		}
	});

	// ===== スマホ向け UI / 自動保存 / 執筆補助 =====
	const AUTOSAVE_DELAY = 2000;

	let saveFailed = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let todayWritten = $state(0);

	let showSceneSheet = $state(false);
	let showReference = $state(false);
	let referenceTab = $state<'characters' | 'world' | 'memo'>('characters');
	let showDisplaySheet = $state(false);
	let showActionSheet = $state(false);
	let chromeHidden = $state(false);

	let sceneFilter = $state('');
	let collapsedChapters = new SvelteSet<string>();

	// プレビュー表示はスマホでは 2 画面にしない
	let effectiveViewMode = $derived<ViewMode>(
		viewport.isMobile && viewMode === 'split' ? 'editor' : viewMode
	);

	let orderedScenes = $derived(
		currentProjectStore.chapters.flatMap((c) => currentProjectStore.scenesByChapter.get(c.id) ?? [])
	);
	let currentIndex = $derived(
		orderedScenes.findIndex((s) => s.id === editorStore.currentScene?.id)
	);
	let prevScene = $derived(currentIndex > 0 ? orderedScenes[currentIndex - 1] : null);
	let nextScene = $derived(
		currentIndex >= 0 && currentIndex < orderedScenes.length - 1
			? orderedScenes[currentIndex + 1]
			: null
	);
	let currentChapterTitle = $derived(
		currentProjectStore.chapters.find((c) => c.id === editorStore.currentScene?.chapterId)?.title ??
			''
	);

	let saveState = $derived<'saving' | 'dirty' | 'error' | 'saved'>(
		editorStore.isSaving ? 'saving' : saveFailed ? 'error' : editorStore.isDirty ? 'dirty' : 'saved'
	);
	const saveLabels = {
		saving: '保存中',
		dirty: '未保存',
		error: '保存失敗',
		saved: '保存済み'
	} as const;

	// 目標(1日あたり or 全体)に対する達成率
	let goal = $derived(currentProjectStore.project?.settings?.goal);
	let goalDone = $derived(
		goal?.type === 'total' ? currentProjectStore.totalCharacterCount : todayWritten
	);
	let goalRatio = $derived<number | null>(goal && goal.target > 0 ? goalDone / goal.target : null);

	// --- 目標の設定 ---
	let showGoalSheet = $state(false);
	let goalType = $state<'daily' | 'total'>('daily');
	let goalTarget = $state(2000);

	function openGoalSheet() {
		if (readOnly) return;
		goalType = goal?.type ?? 'daily';
		goalTarget = goal?.target ?? 2000;
		showGoalSheet = true;
	}

	async function saveGoal() {
		const project = currentProjectStore.project;
		if (!project || readOnly) return;
		const target = Math.max(100, Math.round(Number(goalTarget)) || 2000);
		const settings = { ...project.settings, goal: { type: goalType, target } };
		try {
			await projectsDB.update(project.id, { settings });
			currentProjectStore.project = { ...project, settings };
			await queueChange('projects', project.id, 'update');
			showGoalSheet = false;
		} catch (error) {
			console.error('Failed to save goal:', error);
		}
	}

	// スマホは iOS の自動ズームを避けるため 16px 未満にしない
	let effectiveFontSize = $derived(
		viewport.isMobile
			? Math.max(16, localFormatting.fontSize ?? 16)
			: (localFormatting.fontSize ?? 16)
	);

	// --- 自動保存(入力が止まって約2秒後。入力し続けても最大待ち時間ごとに保存) ---
	let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

	function clearSaveTimers() {
		if (saveTimer) clearTimeout(saveTimer);
		if (maxWaitTimer) clearTimeout(maxWaitTimer);
		saveTimer = null;
		maxWaitTimer = null;
	}

	$effect(() => {
		// 依存: 本文 / 未保存状態 / 保存中状態 / 設定
		void editorStore.content;
		const dirty = editorStore.isDirty;
		const saving = editorStore.isSaving;
		const autoSave = settingsStore.settings.autoSave;
		const maxWait = normalizeAutoSaveMs(settingsStore.settings.autoSaveInterval);
		if (!dirty && maxWaitTimer) {
			clearTimeout(maxWaitTimer);
			maxWaitTimer = null;
		}
		if (!dirty || saving || !editorStore.currentScene || !autoSave) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			clearSaveTimers();
			void handleSave();
		}, AUTOSAVE_DELAY);
		if (!maxWaitTimer) {
			maxWaitTimer = setTimeout(() => {
				clearSaveTimers();
				void handleSave();
			}, maxWait);
		}
		return () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
		};
	});

	// --- 今日の執筆文字数の読み込み ---
	$effect(() => {
		const id = currentProjectStore.project?.id;
		if (!id) return;
		progressLogsDB
			.getByDate(id, getDateKey(Date.now()))
			.then((log) => (todayWritten = log?.charactersWritten ?? 0))
			.catch((error) => console.error('Failed to load progress:', error));
	});

	// 作品全体を通して読む画面へ(未保存の変更は beforeNavigate で保存される)
	function openManuscriptPreview() {
		void goto(resolve('/project/[id]/preview', { id: currentProjectStore.project?.id ?? '' }));
	}

	// --- 前回のシーンを自動で開く ---
	const lastSceneKey = (projectId: string) => `storift:last-scene:${projectId}`;

	function rememberLastScene(sceneId: string) {
		const projectId = currentProjectStore.project?.id;
		if (!projectId) return;
		try {
			localStorage.setItem(lastSceneKey(projectId), sceneId);
		} catch {
			// 保存できなくても動作には影響しない
		}
	}

	$effect(() => {
		const project = currentProjectStore.project;
		if (!project) return;
		const current = editorStore.currentScene;
		// 別プロジェクトのシーンが残っていたら破棄する
		if (current && current.projectId !== project.id) {
			editorStore.currentScene = null;
			return;
		}
		if (current || orderedScenes.length === 0) return;
		let remembered: string | null = null;
		try {
			remembered = localStorage.getItem(lastSceneKey(project.id));
		} catch {
			remembered = null;
		}
		const target =
			orderedScenes.find((s) => s.id === remembered) ??
			[...orderedScenes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
		if (target) editorStore.currentScene = target;
	});

	// --- 入力時の挙動 ---
	function onTyped() {
		// ソフトウェアキーボードで入力しているときだけ隠す(物理キーボードでは隠さない)
		if (viewport.isMobile && viewport.isKeyboardOpen) chromeHidden = true;
		requestAnimationFrame(() => {
			if (!editorScrollContainer) return;
			if (editorStore.typewriter) typewriterScroll(editorScrollContainer);
			else ensureCaretVisible(editorScrollContainer);
		});
	}

	// キーボードが閉じたら上部バーを戻す
	$effect(() => {
		if (!viewport.isKeyboardOpen) chromeHidden = false;
	});

	// キーボードの出入りで高さが変わったとき、カーソルを見える位置に保つ
	$effect(() => {
		void viewport.height;
		if (!viewport.isMobile || !viewport.isKeyboardOpen) return;
		requestAnimationFrame(() => {
			if (editorScrollContainer) ensureCaretVisible(editorScrollContainer);
		});
	});

	// タイプライタースクロール / 今の段落以外を薄く表示
	$effect(() => {
		const onSelectionChange = () => {
			if (!editorDiv || document.activeElement !== editorDiv) return;
			const selection = window.getSelection();
			if (editorStore.typewriter && editorScrollContainer && selection?.isCollapsed) {
				typewriterScroll(editorScrollContainer);
			}
			if (editorStore.dimOthers) updateDimHighlight(editorDiv, true);
		};
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	$effect(() => {
		updateDimHighlight(editorDiv, editorStore.dimOthers);
		return () => updateDimHighlight(null, false);
	});

	// スクロール方向で上部バーを隠す/出す(ユーザーの操作によるスクロールのみ)
	let lastScrollTop = 0;
	let lastTouchAt = 0;

	function markUserScroll() {
		lastTouchAt = Date.now();
	}

	// ソフトキーボードの出入りによる viewport のリサイズ直後は、スクロールの揺れを無視する
	const RESIZE_SETTLE_MS = 500;
	let lastResizeAt = 0;
	let headerTravel = 0;

	$effect(() => {
		void viewport.height;
		void viewport.keyboardHeight;
		lastResizeAt = Date.now();
		headerTravel = 0;
	});

	function onEditorScroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		const prevY = lastScrollTop;
		lastScrollTop = el.scrollTop;
		// 先頭まで戻ったら、操作の種類にかかわらずバーを出す
		if (el.scrollTop <= 0) {
			chromeHidden = false;
			headerTravel = 0;
			return;
		}
		const now = Date.now();
		if (!viewport.isMobile || now - lastTouchAt > 400 || now - lastResizeAt < RESIZE_SETTLE_MS) {
			return;
		}
		const next = computeHeaderVisibility(prevY, el.scrollTop, {
			visible: !chromeHidden,
			travel: headerTravel
		});
		headerTravel = next.travel;
		chromeHidden = !next.visible;
	}

	function dismissKeyboard() {
		editorDiv?.blur();
		chromeHidden = false;
	}

	// --- 一覧(章の折りたたみ・項目メニュー) ---
	function toggleChapter(id: string) {
		if (collapsedChapters.has(id)) collapsedChapters.delete(id);
		else collapsedChapters.add(id);
	}

	type PointLike = Pick<MouseEvent, 'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation'>;

	// ⋯ ボタンの直下にコンテキストメニューを出す
	function openItemMenu(e: Event, kind: 'scene' | 'chapter', item: Scene | Chapter) {
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const point: PointLike = {
			clientX: rect.right - 160,
			clientY: rect.bottom,
			preventDefault: () => {},
			stopPropagation: () => {}
		};
		if (kind === 'scene') handleSceneContextMenu(point, item as Scene);
		else handleChapterContextMenu(point, item as Chapter);
	}

	async function goToScene(scene: Scene | null) {
		if (!scene) return;
		await handleSceneSelect(scene);
		chromeHidden = false;
		editorScrollContainer?.scrollTo({ top: 0 });
	}

	// --- 表示シート(書式はプレビューしながら調整し、閉じるだけなら元に戻す) ---
	let displaySnapshot: { fontSize: number; lineHeight: number; letterSpacing: number } | null =
		null;
	let displayCommitted = false;

	function openDisplaySheet() {
		if (settingsStore.editorFormatting) {
			localFormatting.fontSize = settingsStore.editorFormatting.fontSize ?? 16;
			localFormatting.lineHeight = settingsStore.editorFormatting.lineHeight ?? 2;
			localFormatting.letterSpacing = settingsStore.editorFormatting.letterSpacing ?? 0;
		}
		displaySnapshot = { ...localFormatting };
		displayCommitted = false;
		showDisplaySheet = true;
	}

	function onDisplayClosed() {
		if (!displayCommitted && displaySnapshot) Object.assign(localFormatting, displaySnapshot);
		displaySnapshot = null;
	}

	async function commitDisplay() {
		await updateFormatting();
		displayCommitted = true;
		showDisplaySheet = false;
	}

	// 書式設定モーダルのキャンセル/閉じるでスライダーの変更を元に戻す
	function cancelFormatting() {
		if (settingsStore.editorFormatting) {
			localFormatting.fontSize = settingsStore.editorFormatting.fontSize ?? 16;
			localFormatting.lineHeight = settingsStore.editorFormatting.lineHeight ?? 2;
			localFormatting.letterSpacing = settingsStore.editorFormatting.letterSpacing ?? 0;
		}
		showFormattingModal = false;
	}

	function runAction(action: () => void) {
		showActionSheet = false;
		// シートが閉じるアニメーションの後に実行(モーダル・メニューの重なりを避ける)
		setTimeout(action, 60);
	}
</script>

{#snippet presenceChips()}
	<span class="presence" role="status" aria-label={presenceText ?? ''} data-testid="presence">
		<span class="presence-label">他 {otherMembers.length} 人が閲覧中:</span>
		{#each otherMembers as member (member.uid)}
			<span
				class="presence-chip"
				class:here={member.sceneId === editorStore.currentScene?.id}
				style="--member-color: {member.color}"
				title={member.sceneId === editorStore.currentScene?.id
					? `${member.name}(このシーンを開いています)`
					: member.name}
			>
				<span class="presence-chip-dot"></span>{member.name}
			</span>
		{/each}
	</span>
{/snippet}

{#snippet collabNoticeView()}
	<span class="collab-note" role="status" data-testid="collab-notice">
		{collabNotice}
		<button type="button" class="collab-retry" onclick={retryCollab}>再試行</button>
	</span>
{/snippet}

{#snippet sceneList()}
	<div class="scene-list">
		<div class="scene-list-head">
			<input
				class="scene-filter"
				type="search"
				placeholder="シーンを検索"
				aria-label="シーンを検索"
				bind:value={sceneFilter}
			/>
			{#if !readOnly}
				<button class="add-chapter" onclick={() => (isChapterModalOpen = true)} title="章を追加"
					>＋ 章</button
				>
			{/if}
		</div>

		{#if currentProjectStore.chapters.length === 0}
			<div class="list-empty">
				<p>章がまだありません</p>
				{#if !readOnly}
					<Button onclick={() => (isChapterModalOpen = true)}>最初の章を作成</Button>
				{/if}
			</div>
		{/if}

		{#each currentProjectStore.chapters as chapter (chapter.id)}
			{@const filter = sceneFilter.trim()}
			{@const allScenes = currentProjectStore.scenesByChapter.get(chapter.id) || []}
			{@const visibleScenes = filter
				? allScenes.filter((s) => s.title.includes(filter))
				: allScenes}
			{@const collapsed = !filter && collapsedChapters.has(chapter.id)}
			{#if !filter || visibleScenes.length > 0}
				<section class="chapter">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="chapter-head"
						oncontextmenu={(e) => handleChapterContextMenu(e, chapter)}
						use:longpress={{ onLongPress: (e) => handleChapterContextMenu(e, chapter) }}
					>
						<button
							class="chapter-toggle"
							aria-expanded={!collapsed}
							onclick={() => toggleChapter(chapter.id)}
						>
							<svg
								class="chev"
								class:collapsed
								viewBox="0 0 12 12"
								width="10"
								height="10"
								aria-hidden="true"
								><path
									d="M3 4.5l3 3 3-3"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
							<span class="chapter-title">{chapter.title}</span>
							<span class="count"
								>{allScenes.reduce((n, s) => n + s.characterCount, 0).toLocaleString()}字</span
							>
						</button>
						{#if !readOnly}
							<button class="mini" onclick={() => openSceneModal(chapter.id)}>＋ シーン</button>
						{/if}
						<button
							class="more"
							aria-label="章のメニュー"
							onclick={(e) => openItemMenu(e, 'chapter', chapter)}>⋯</button
						>
					</div>

					{#if !collapsed}
						<div class="scene-group" transition:slide={{ duration: 180, easing: cubicOut }}>
							{#each visibleScenes as scene (scene.id)}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="scene-row"
									class:active={editorStore.currentScene?.id === scene.id}
									oncontextmenu={(e) => handleSceneContextMenu(e, scene)}
									use:longpress={{ onLongPress: (e) => handleSceneContextMenu(e, scene) }}
								>
									<button
										class="scene-main"
										aria-current={editorStore.currentScene?.id === scene.id ? 'true' : undefined}
										onclick={() => handleSceneSelect(scene)}
									>
										<span class="scene-title-row">
											<span class="scene-title">{scene.title}</span>
											{#each membersOnScene(scene.id) as member (member.uid)}
												<span
													class="presence-dot"
													style="background: {member.color}"
													title={`${member.name}が閲覧中`}
												></span>
											{/each}
										</span>
										<span class="scene-count">{scene.characterCount.toLocaleString()}文字</span>
									</button>
									<button
										class="more"
										aria-label="シーンのメニュー"
										onclick={(e) => openItemMenu(e, 'scene', scene)}>⋯</button
									>
								</div>
							{:else}
								{#if readOnly}
									<span class="scene-empty">シーンがありません</span>
								{:else}
									<button class="scene-empty" onclick={() => openSceneModal(chapter.id)}>
										シーンがありません。<span class="link">作成する</span>
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</section>
			{/if}
		{/each}

		<div class="scene-list-foot">
			合計: {currentProjectStore.totalCharacterCount.toLocaleString()}文字
		</div>
	</div>
{/snippet}

<div
	class="editor-layout w:100% h:100%"
	data-sidebar-open={editorStore.sceneListOpen ? 'true' : 'false'}
	data-focus={editorStore.focusMode ? 'true' : 'false'}
	data-mobile={viewport.isMobile ? 'true' : 'false'}
>
	<!-- サイドバー(デスクトップ/タブレット) -->
	{#if !viewport.isMobile && !editorStore.focusMode}
		<aside class="editor-sidebar" aria-label="章・シーン一覧" data-tour="editor-scene-list">
			<div class="editor-sidebar-scroll">
				{@render sceneList()}
			</div>
		</aside>
		<button
			aria-label="scene list overlay"
			onclick={() => (editorStore.sceneListOpen = false)}
			class="sidebar-overlay"
		></button>
	{/if}

	<!-- エディタエリア -->
	<div class="editor-main flex flex:column w:100% h:100% overflow-y:auto">
		<!-- スマホ: 1 本だけの上部バー -->
		{#if viewport.isMobile && !editorStore.focusMode}
			<div
				class="m-bar-wrap"
				class:m-bar-off={chromeHidden}
				inert={chromeHidden}
				aria-hidden={chromeHidden ? 'true' : undefined}
			>
				<div class="m-bar">
					<button class="m-btn" aria-label="章・シーン一覧" onclick={() => (showSceneSheet = true)}>
						<Icon name="list" class="w:22px" />
					</button>
					<button class="m-title" onclick={() => (showSceneSheet = true)}>
						<span class="m-title-main">{editorStore.currentScene?.title ?? 'シーンを選択'}</span>
						{#if editorStore.currentScene}
							<span class="m-title-sub">
								{#if currentChapterTitle}<span class="ellipsis">{currentChapterTitle}</span><span
										>·</span
									>{/if}
								<span>{editorStore.characterCount.toLocaleString()}字</span>
								{#if goalRatio !== null}
									<GoalRing
										ratio={goalRatio}
										size={14}
										label={`${goal?.type === 'total' ? '全体' : '今日'} ${goalDone.toLocaleString()} / ${goal?.target.toLocaleString()}字`}
									/>
								{/if}
								<span class="save-state" data-state={saveState} role="status"
									>{saveLabels[saveState]}</span
								>
								{#if otherMembers.length > 0}
									<span class="presence-mini" title={presenceText ?? ''}
										>👥{otherMembers.length}</span
									>
								{/if}
								{#if collab === 'fallback' && collabNotice}
									<span class="presence-mini">{collabNotice}</span>
								{/if}
							</span>
						{/if}
					</button>
					<button
						class="m-btn"
						aria-label="参照(キャラクター・設定資料・メモ)"
						onclick={() => {
							referenceTab = 'characters';
							showReference = true;
						}}
					>
						<Icon name="book-2" class="w:22px" />
					</button>
					<button class="m-btn" aria-label="表示と書式" onclick={openDisplaySheet}>
						<span class="aa" aria-hidden="true">Aa</span>
					</button>
					<button class="m-btn" aria-label="その他の操作" onclick={() => (showActionSheet = true)}>
						<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"
							><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle
								cx="19"
								cy="12"
								r="1.8"
							/></svg
						>
					</button>
				</div>
			</div>
		{/if}

		{#if editorStore.focusMode}
			<button
				class="focus-exit"
				aria-label="集中モードを終了"
				onclick={() => (editorStore.focusMode = false)}
			>
				<svg
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg
				>
			</button>
		{/if}

		{#if !editorStore.currentScene}
			{#if !viewport.isMobile}
				<div class="mobile-sidebar-open">
					<button
						class="mobile-sidebar-button"
						onclick={() => (editorStore.sceneListOpen = true)}
						aria-label="章・シーンを開く"
						title="章・シーンを開く"
					>
						<Icon name="list" class="w:18px" />
						<span>章・シーン</span>
					</button>
				</div>
			{/if}
			<div class="flex ai:center jc:center h:full">
				<div class="text-align:center p:24">
					<p class="fg:theme-text-secondary font:16 mb:16">
						{currentProjectStore.chapters.length === 0
							? 'まずは章を作りましょう'
							: 'シーンを選択または作成してください'}
					</p>
					{#if currentProjectStore.chapters.length === 0}
						{#if !readOnly}
							<Button onclick={() => (isChapterModalOpen = true)}>最初の章を作成</Button>
						{/if}
					{:else if viewport.isMobile}
						<Button onclick={() => (showSceneSheet = true)}>一覧を開く</Button>
					{/if}
				</div>
			</div>
		{:else}
			<!-- ツールバー(デスクトップ/タブレット) -->
			{#if !viewport.isMobile && !editorStore.focusMode}
				<div class="editor-toolbar">
					<!-- タイトルと保存状態 -->
					<div class="editor-toolbar-row flex jc:space-between ai:center">
						<div class="editor-title-area flex ai:center gap:16">
							<button
								class="tool sidebar-toggle"
								class:on={editorStore.sceneListOpen}
								onclick={() => (editorStore.sceneListOpen = !editorStore.sceneListOpen)}
								aria-label="章・シーンの表示切替"
								title="章・シーンの表示切替"
							>
								<svg
									viewBox="0 0 24 24"
									width="19"
									height="19"
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
									><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path
										d="M9.5 4.5v15"
									/></svg
								>
							</button>
							<div class="editor-heading">
								{#if currentChapterTitle}<span class="editor-crumb">{currentChapterTitle}</span
									>{/if}
								<h1 class="editor-title">{editorStore.currentScene.title}</h1>
							</div>
							<span class="editor-count">
								{editorStore.characterCount.toLocaleString()}<small>字</small>
							</span>
							{#if presenceText}
								{@render presenceChips()}
							{/if}
							{#if goalRatio !== null}
								<button
									class="goal-btn"
									onclick={openGoalSheet}
									title={`${goal?.type === 'total' ? '全体' : '今日'} ${goalDone.toLocaleString()} / ${goal?.target.toLocaleString()}字(クリックで目標を変更)`}
									aria-label="目標を設定"
								>
									<GoalRing ratio={goalRatio} size={16} />
								</button>
							{/if}
						</div>
						<div class="editor-toolbar-actions flex ai:center gap:8">
							<!-- 書式設定ボタン -->
							<button
								class="tool"
								onclick={openFormattingModal}
								aria-label="書式設定"
								title="書式設定"
							>
								<Icon name="palette" class="w:20px" />
							</button>
							<!-- プレビューボタン -->
							<div
								class="seg-tools"
								role="group"
								aria-label="表示モード"
								data-tour="editor-view-mode"
							>
								<button
									class="seg-tool"
									class:on={viewMode === 'editor'}
									aria-pressed={viewMode === 'editor'}
									onclick={() => (viewMode = 'editor')}
									aria-label="エディタのみ"
									title="エディタのみ"
								>
									<Icon name="edit" class="w:18px" />
								</button>
								<button
									class="seg-tool"
									class:on={viewMode === 'split'}
									aria-pressed={viewMode === 'split'}
									onclick={() => (viewMode = 'split')}
									aria-label="二画面表示"
									title="二画面表示"
								>
									<Icon name="layout-columns" class="w:18px" />
								</button>
								<button
									class="seg-tool"
									class:on={viewMode === 'preview'}
									aria-pressed={viewMode === 'preview'}
									onclick={() => (viewMode = 'preview')}
									aria-label="プレビューのみ"
									title="プレビューのみ"
								>
									<Icon name="eye" class="w:18px" />
								</button>
							</div>
							<div class="tool-sep"></div>
							<!-- Phase 2: 執筆支援ツール -->
							<button
								class="tool"
								onclick={() => (showWritingAssistant = true)}
								disabled={readOnly}
								aria-label="執筆支援"
								title="執筆支援"
							>
								<Icon name="pencil-bolt" class="w:20px" />
							</button>
							<button
								class="tool"
								data-tour="editor-export"
								onclick={() => (showExportModal = true)}
								aria-label="エクスポート"
								title="エクスポート"
							>
								<Icon name="download" class="w:20px" />
							</button>
							<button
								class="tool"
								onclick={openManuscriptPreview}
								aria-label="作品全体を通して読む"
								title="作品全体を通して読む"
								data-testid="open-manuscript-preview"
							>
								<Icon name="book-2" class="w:20px" />
							</button>
							<button
								class="tool"
								onclick={() => (showPrintPreview = true)}
								aria-label="印刷プレビュー"
								title="印刷プレビュー"
							>
								<Icon name="printer" class="w:20px" />
							</button>
							<button
								class="tool"
								onclick={() => (showVersionManager = true)}
								disabled={readOnly}
								aria-label="バージョン履歴"
								title="バージョン履歴"
							>
								<Icon name="history" class="w:20px" />
							</button>
							<button
								class="tool"
								onclick={() => (showProofread = true)}
								aria-label="校正"
								title="校正"
							>
								<Icon name="abc" class="w:20px" />
							</button>
							<button
								class="tool"
								onclick={openSearch}
								aria-label="検索・置換 (Ctrl+Shift+F)"
								title="検索・置換 (Ctrl+Shift+F)"
							>
								<Icon name="search" class="w:20px" />
							</button>
							<button
								class="tool"
								onclick={() => (editorStore.focusMode = true)}
								aria-label="集中モード"
								title="集中モード"
							>
								<Icon name="wallpaper" class="w:20px" />
							</button>
							<button
								class="tool"
								class:on={showMemo}
								aria-pressed={showMemo}
								data-tour="editor-memo-button"
								onclick={toggleMemoPanel}
								aria-label="メモ (Ctrl+Shift+M)"
								title="メモ (Ctrl+Shift+M)"
							>
								<Icon name="clipboard-text" class="w:20px" />
							</button>
							{#if desktop}
								<div class="tool-sep"></div>
								<button
									class="tool tool--claude"
									class:on={claudeStore.open}
									aria-pressed={claudeStore.open}
									data-tour="editor-claude"
									onclick={() => claudeStore.toggle()}
									aria-label="Claude Code パネル (Ctrl+Shift+L)"
									title="Claude Code パネル (Ctrl+Shift+L)"
								>
									<Icon name="sparkles" class="w:20px" />
								</button>
							{/if}
							<div class="tool-sep"></div>
							{#if collab === 'fallback' && collabNotice}
								{@render collabNoticeView()}
							{/if}
							<span class="save-state font:12" data-state={saveState} role="status">
								{saveLabels[saveState]}
							</span>
						</div>
					</div>
				</div>
			{/if}

			<!-- エディタ & プレビューエリア(デスクトップ版は右に Claude パネル) -->
			<div class="editor-workspace">
				<div class="editor-panels flex-grow:1 flex overflow:hidden">
					<!-- エディタ -->
					{#if effectiveViewMode !== 'preview'}
						<div
							bind:this={editorScrollContainer}
							onscroll={onEditorScroll}
							ontouchstart={markUserScroll}
							ontouchmove={markUserScroll}
							onwheel={markUserScroll}
							class="editor-panel editor-panel--editor overflow-y:auto bg:editor-background {effectiveViewMode ===
							'split'
								? 'w:50%'
								: 'w:100%'} transition:width|0.3s"
						>
							<div
								class="editor-page"
								class:typewriter={editorStore.typewriter}
								class:with-m-bar={viewport.isMobile && !editorStore.focusMode}
							>
								<!-- contentEditable div -->
								<div
									bind:this={editorDiv}
									data-tour="editor-body"
									contenteditable={editable ? 'true' : 'false'}
									role="textbox"
									aria-label="エディタ"
									aria-multiline="true"
									aria-readonly={!editable}
									tabindex="0"
									oninput={handleEditorInput}
									onbeforeinput={handleBeforeInput}
									oncompositionstart={handleCompositionStart}
									oncompositionend={handleCompositionEnd}
									onkeydown={handleEditorKeydown}
									ondragstart={handleDragStart}
									ondragend={() => (dragSelection = null)}
									ondrop={handleDrop}
									oncontextmenu={handleContextMenu}
									onpaste={handlePaste}
									class="editor-text w:full min-h:600 border:none outline:none bg:editor-background fg:editor-text white-space:pre-wrap"
									style="
									font-family: {getFontFamily(settingsStore.editorFont)};
									font-size: {effectiveFontSize}px;
									line-height: {localFormatting.lineHeight ?? 2};
									letter-spacing: {localFormatting.letterSpacing ?? 0}em;
								"
									data-placeholder="ここに執筆を開始..."
								>
									{editorStore.content}
								</div>

								{#if viewport.isMobile}
									<div class="scene-nav">
										<button disabled={!prevScene} onclick={() => goToScene(prevScene)}>
											‹ {prevScene ? prevScene.title : '最初のシーン'}
										</button>
										<button disabled={!nextScene} onclick={() => goToScene(nextScene)}>
											{nextScene ? nextScene.title : '最後のシーン'} ›
										</button>
									</div>
								{/if}
							</div>
						</div>
					{/if}

					<!-- プレビューエリア -->
					{#if effectiveViewMode !== 'editor'}
						<div
							class="editor-panel editor-panel--preview {effectiveViewMode === 'split'
								? 'w:50% border-left:1|solid|theme-border'
								: 'w:100%'} overflow:hidden"
						>
							<PreviewViewer
								bind:this={previewViewerRef}
								content={editorStore.content}
								settings={previewSettings}
							/>
						</div>
					{/if}
				</div>
				{#if showClaude}
					<!-- Claude パネルはプロジェクト全体のレイアウト側に出す -->
				{:else if showMemo && currentProjectStore.project}
					<div class="claude-slot" transition:slide={{ axis: 'x', duration: 220 }}>
						<MemoPanel
							projectId={currentProjectStore.project.id}
							onJump={jumpToMemo}
							onClose={() => (editorStore.memoOpen = false)}
						/>
					</div>
				{/if}
			</div>

			<!-- スマホ: キーボード上の補助バー -->
			{#if viewport.isMobile && viewport.isKeyboardOpen && effectiveViewMode !== 'preview'}
				<AssistBar
					hasPrev={!!prevScene}
					hasNext={!!nextScene}
					onPrev={() => goToScene(prevScene)}
					onNext={() => goToScene(nextScene)}
					onDismiss={dismissKeyboard}
				/>
			{/if}
		{/if}
	</div>
</div>

<!-- スマホ: 章・シーン一覧 -->
<Sheet bind:open={showSceneSheet} title="章・シーン" size="half">
	{@render sceneList()}
</Sheet>

<!-- スマホ: 参照(キャラクター・設定資料・メモ) -->
{#if currentProjectStore.project}
	<ReferenceSheet
		bind:open={showReference}
		projectId={currentProjectStore.project.id}
		initialTab={referenceTab}
	/>
{/if}

<!-- スマホ: 表示と書式 -->
<Sheet bind:open={showDisplaySheet} title="表示と書式" size="half" onClose={onDisplayClosed}>
	{#snippet headerRight()}
		<button class="done-btn" onclick={commitDisplay}>完了</button>
	{/snippet}
	<div class="display-sheet">
		<div class="seg" role="group" aria-label="表示モード">
			<button class:on={viewMode !== 'preview'} onclick={() => (viewMode = 'editor')}>本文</button>
			<button class:on={viewMode === 'preview'} onclick={() => (viewMode = 'preview')}
				>プレビュー</button
			>
		</div>

		<div class="field">
			<div class="field-label">
				<span>文字サイズ</span><span class="value">{localFormatting.fontSize}px</span>
			</div>
			<div class="stepper">
				<button
					aria-label="文字を小さく"
					onclick={() => (localFormatting.fontSize = Math.max(12, localFormatting.fontSize - 1))}
					>−</button
				>
				<input
					type="range"
					min="12"
					max="24"
					step="1"
					bind:value={localFormatting.fontSize}
					aria-label="文字サイズ"
				/>
				<button
					aria-label="文字を大きく"
					onclick={() => (localFormatting.fontSize = Math.min(24, localFormatting.fontSize + 1))}
					>＋</button
				>
			</div>
			{#if localFormatting.fontSize < 16}
				<p class="hint">スマホでは入力時の自動拡大を避けるため 16px 以上で表示します</p>
			{/if}
		</div>

		<div class="field">
			<div class="field-label">
				<span>行間</span><span class="value">{(localFormatting.lineHeight ?? 2).toFixed(1)}</span>
			</div>
			<input
				type="range"
				min="1"
				max="3"
				step="0.1"
				bind:value={localFormatting.lineHeight}
				aria-label="行間"
			/>
		</div>

		<div class="field">
			<div class="field-label">
				<span>字間</span><span class="value"
					>{(localFormatting.letterSpacing ?? 0).toFixed(2)}em</span
				>
			</div>
			<input
				type="range"
				min="-0.05"
				max="0.2"
				step="0.01"
				bind:value={localFormatting.letterSpacing}
				aria-label="字間"
			/>
		</div>

		<div class="field">
			<span class="field-label"><span>フォント</span></span>
			<FontSelector value={settingsStore.editorFont} onchange={handleFontChange} />
		</div>

		<label class="toggle">
			<span>
				<strong>タイプライタースクロール</strong>
				<small>書いている行を画面の一定の高さに保ちます</small>
			</span>
			<input type="checkbox" bind:checked={editorStore.typewriter} />
		</label>
		<label class="toggle">
			<span>
				<strong>今の段落以外を薄く表示</strong>
				<small>対応していないブラウザでは変化しません</small>
			</span>
			<input type="checkbox" bind:checked={editorStore.dimOthers} />
		</label>

		<div class="display-actions">
			<button
				class="ghost"
				onclick={() => {
					showDisplaySheet = false;
					editorStore.focusMode = true;
				}}>集中モード</button
			>
			<button
				class="ghost"
				onclick={() => {
					showDisplaySheet = false;
					formattingTab = 'preview';
					showFormattingModal = true;
				}}>プレビュー設定</button
			>
		</div>
	</div>
</Sheet>

<!-- 校正 -->
<ProofreadSheet
	bind:open={showProofread}
	text={editorStore.content}
	onChange={(next) => {
		if (!readOnly) editorStore.content = next;
	}}
	onJump={jumpToText}
/>

<!-- 検索・置換 -->
{#if currentProjectStore.project}
	<SearchReplace
		projectId={currentProjectStore.project.id}
		show={showSearch}
		onClose={closeSearch}
		onOpenScene={openSceneById}
		{readOnly}
	/>
{/if}

<!-- 目標の設定 -->
<Sheet bind:open={showGoalSheet} title="執筆の目標" size="auto">
	<form
		class="goal-form"
		onsubmit={(e) => {
			e.preventDefault();
			void saveGoal();
		}}
	>
		<div class="seg" role="group" aria-label="目標の種類">
			<button type="button" class:on={goalType === 'daily'} onclick={() => (goalType = 'daily')}>
				1日あたり
			</button>
			<button type="button" class:on={goalType === 'total'} onclick={() => (goalType = 'total')}>
				作品全体
			</button>
		</div>
		<label class="goal-field">
			<span>目標文字数</span>
			<input type="number" inputmode="numeric" min="100" step="100" bind:value={goalTarget} />
		</label>
		<button class="done-btn wide" type="submit">保存</button>
	</form>
</Sheet>

<!-- スマホ: その他の操作 -->
<Sheet bind:open={showActionSheet} title="操作" size="auto">
	<div class="actions">
		{#if goalRatio !== null}
			<button class="goal-line" onclick={() => runAction(openGoalSheet)}>
				<GoalRing ratio={goalRatio} size={20} />
				<span>
					{goal?.type === 'total' ? '全体' : '今日'}
					{goalDone.toLocaleString()} / {goal?.target.toLocaleString()}字 ({Math.round(
						goalRatio * 100
					)}%)
				</span>
				<span class="goal-edit">目標を変更</span>
			</button>
		{/if}
		<button onclick={() => runAction(() => void handleSave())} disabled={!editorStore.isDirty}>
			今すぐ保存
		</button>
		<button onclick={() => runAction(() => (showProofread = true))}>校正</button>
		<button onclick={() => runAction(() => void openSearch())}>検索・置換</button>
		<button onclick={() => runAction(() => (editorStore.focusMode = true))}>集中モード</button>
		<button disabled={readOnly} onclick={() => runAction(() => (showWritingAssistant = true))}
			>執筆支援(字下げ・ルビ)</button
		>
		<button onclick={() => runAction(() => (showExportModal = true))}>エクスポート</button>
		<button onclick={() => runAction(openManuscriptPreview)}>作品全体を通して読む</button>
		<button onclick={() => runAction(() => (showPrintPreview = true))}>印刷プレビュー</button>
		<button disabled={readOnly} onclick={() => runAction(() => (showVersionManager = true))}
			>バージョン履歴</button
		>
		{#if editorStore.currentScene && !readOnly}
			<div class="actions-sep"></div>
			<button onclick={() => runAction(() => handleRenameScene(editorStore.currentScene!))}
				>シーン名を変更</button
			>
			<button onclick={() => runAction(() => void handleDuplicateScene(editorStore.currentScene!))}
				>シーンを複製</button
			>
			<button
				class="danger"
				onclick={() => runAction(() => void handleDeleteScene(editorStore.currentScene!))}
			>
				シーンを削除
			</button>
		{/if}
	</div>
</Sheet>

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
			<Input id="chapterTitle" bind:value={newChapterTitle} placeholder="第1章" required />
		</div>
		<div class="flex jc:flex-end gap:12">
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
			<Input id="sceneTitle" bind:value={newSceneTitle} placeholder="オープニング" required />
		</div>
		<div class="flex jc:flex-end gap:12">
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
		onClose={() => (showWritingAssistant = false)}
		title="執筆支援"
		size="large"
	>
		<WritingAssistant bind:text={editorStore.content} />
	</Modal>
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
		<VersionManager entityType="scene" entityId={editorStore.currentScene.id} />
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
<Modal bind:isOpen={showFormattingModal} title="書式設定" size="large" onClose={cancelFormatting}>
	<div class="flex flex:column gap:24">
		<!-- タブ -->
		<div class="flex gap:4 bg:theme-surface r:8 p:4">
			<button
				class="flex:1 p:10 r:7 font:14 cursor:pointer transition:all|0.15s {formattingTab ===
				'editor'
					? 'bg:theme-background fg:theme-text font-weight:600 b:1px|solid|theme-border'
					: 'bg:transparent fg:theme-text b:1px|solid|transparent hover:bg:theme-background'}"
				onclick={() => (formattingTab = 'editor')}
			>
				エディター設定
			</button>
			<button
				class="flex:1 p:10 r:7 font:14 cursor:pointer transition:all|0.15s {formattingTab ===
				'preview'
					? 'bg:theme-background fg:theme-text font-weight:600 b:1px|solid|theme-border'
					: 'bg:transparent fg:theme-text b:1px|solid|transparent hover:bg:theme-background'}"
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
				<FontSelector value={settingsStore.editorFont} onchange={handleFontChange} />
			</div>

			<!-- フォントサイズ -->
			<div>
				<span class="display:block font-weight:500 m:0|0|8|0 fg:theme-text">
					フォントサイズ: {localFormatting.fontSize}px
				</span>
				<input
					type="range"
					bind:value={localFormatting.fontSize}
					min="12"
					max="24"
					step="1"
					class="w:full"
				/>
				<div class="flex jc:space-between font:12 fg:theme-text-secondary mt:4">
					<span>12px</span>
					<span>24px</span>
				</div>
			</div>

			<!-- 行間 -->
			<div>
				<span class="display:block font-weight:500 m:0|0|8|0 fg:theme-text">
					行間: {(localFormatting.lineHeight ?? 2).toFixed(1)}
				</span>
				<input
					type="range"
					bind:value={localFormatting.lineHeight}
					min="1.0"
					max="3.0"
					step="0.1"
					class="w:full"
				/>
				<div class="flex jc:space-between font:12 fg:theme-text-secondary mt:4">
					<span>1.0</span>
					<span>3.0</span>
				</div>
			</div>

			<!-- 字間 -->
			<div>
				<span class="display:block font-weight:500 m:0|0|8|0 fg:theme-text">
					字間: {(localFormatting.letterSpacing ?? 0).toFixed(2)}em
				</span>
				<input
					type="range"
					bind:value={localFormatting.letterSpacing}
					min="-0.05"
					max="0.2"
					step="0.01"
					class="w:full"
				/>
				<div class="flex jc:space-between font:12 fg:theme-text-secondary mt:4">
					<span>-0.05em</span>
					<span>0.20em</span>
				</div>
			</div>

			<!-- プレビュー -->
			<div class="b:1|solid|theme-border r:8 p:16 bg:editor-background">
				<div class="font:12 font-weight:500 mb:8 fg:theme-text-secondary">プレビュー</div>
				<div
					style="
						font-family: {getFontFamily(settingsStore.editorFont)};
						font-size: {localFormatting.fontSize ?? 16}px;
						line-height: {localFormatting.lineHeight ?? 2};
						letter-spacing: {localFormatting.letterSpacing ?? 0}em;
					"
					class="fg:editor-text"
				>
					吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。
				</div>
			</div>

			<!-- ボタン -->
			<div class="flex jc:flex-end gap:12">
				<Button type="button" variant="secondary" onclick={() => (showFormattingModal = false)}>
					キャンセル
				</Button>
				<Button type="button" onclick={updateFormatting}>保存</Button>
			</div>
		{:else}
			<!-- プレビュー設定 -->
			<PreviewSettings settings={previewSettings} onSettingsChange={updatePreviewSettings} />
		{/if}
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
			<label class="display:block font-weight:500 m:0|0|8|0" for="renameValue">新しい名前</label>
			<Input id="renameValue" bind:value={renameValue} placeholder="名前を入力" required />
		</div>
		<div class="flex jc:flex-end gap:12">
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

	.editor-layout {
		--scene-panel-width: 17.5rem;
		display: grid;
		grid-template-columns: var(--scene-panel-width) minmax(0, 1fr);
		grid-template-rows: 1fr;
		position: relative;
		transition: grid-template-columns 0.22s ease;
	}

	.editor-layout[data-sidebar-open='false'] {
		grid-template-columns: 0 minmax(0, 1fr);
	}

	.editor-layout[data-focus='true'],
	.editor-layout[data-mobile='true'] {
		grid-template-columns: 1fr;
	}

	.editor-sidebar {
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-background);
		border-right: 1px solid var(--color-border);
	}

	.editor-layout[data-sidebar-open='false'] .editor-sidebar {
		border-right-color: transparent;
		visibility: hidden;
		transition: visibility 0s 0.22s;
	}

	.editor-sidebar-scroll {
		flex: 1;
		width: var(--scene-panel-width);
		overflow-y: auto;
		padding: 18px 4px 16px;
	}

	.editor-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		position: relative;
	}

	.editor-workspace {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.editor-panels {
		flex: 1;
		min-width: 0;
		min-height: 0;
	}

	.claude-slot {
		flex: none;
		display: flex;
		min-height: 0;
	}

	/* 開いている間は藍の地で、押した状態だと分かるようにする */
	.tool--claude.on {
		background: var(--selected);
	}

	.sidebar-overlay {
		display: none;
	}

	.mobile-sidebar-open {
		display: none;
	}

	.mobile-sidebar-button {
		display: none;
	}

	/* ===== ツールバー ===== */
	.editor-toolbar {
		flex: none;
		display: flex;
		align-items: center;
		height: 52px;
		padding: 0 12px 0 8px;
		background: var(--color-background);
		border-bottom: 1px solid var(--color-border);
	}

	.editor-toolbar-row {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.editor-title-area {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.editor-heading {
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}

	.editor-crumb {
		font-size: 11px;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.editor-title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.editor-count {
		flex: none;
		padding-left: 10px;
		border-left: 1px solid var(--color-border);
		font-size: 13px;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.editor-count small {
		margin-left: 1px;
		font-size: 11px;
	}

	.editor-toolbar-actions {
		flex: none;
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.tool {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		padding: 0;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.tool:hover {
		background: var(--hover);
		color: var(--color-text);
	}

	.tool.on {
		color: var(--color-primary);
	}

	.tool :global(div),
	.seg-tool :global(div) {
		display: flex;
	}

	.tool :global(svg) {
		width: 19px;
		height: 19px;
		stroke-width: 1.7;
	}

	.seg-tools {
		display: flex;
		gap: 2px;
		margin: 0 4px;
		padding: 2px;
		border-radius: 9px;
		background: var(--color-surface);
	}

	.seg-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.seg-tool:hover {
		color: var(--color-text);
	}

	.seg-tool.on {
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 0 0 1px var(--color-border);
	}

	.seg-tool :global(svg) {
		width: 16px;
		height: 16px;
	}

	.tool-sep {
		flex: none;
		width: 1px;
		height: 18px;
		margin: 0 6px;
		background: var(--color-border);
	}

	/* ===== 原稿 ===== */
	.editor-page {
		max-width: 46rem;
		min-height: 100%;
		margin: 0 auto;
		padding: 56px 56px 120px;
	}

	/* 今の段落以外を薄くする(CSS Custom Highlight API) */
	:global(::highlight(storift-dim)) {
		color: color-mix(in srgb, var(--editor-text) 35%, transparent);
	}

	/* 範囲メモの位置を薄く示す(本文の DOM は変えない) */
	:global(::highlight(storift-memo)) {
		background-color: color-mix(in srgb, var(--color-accent) 16%, transparent);
		text-decoration-line: underline;
		text-decoration-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
	}

	/* ===== 保存状態 ===== */
	.save-state {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.save-state::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-success);
	}

	.save-state[data-state='dirty']::before {
		background: var(--color-warning);
	}

	.save-state[data-state='saving']::before {
		background: var(--color-info);
		animation: pulse 1s ease-in-out infinite;
	}

	.save-state[data-state='error'] {
		color: var(--color-error);
	}

	.save-state[data-state='error']::before {
		background: var(--color-error);
	}

	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}

	/* ===== 章・シーン一覧(サイドバー/シート共通) ===== */
	.scene-list {
		display: flex;
		flex-direction: column;
		padding: 0 12px 12px;
	}

	.scene-list-head {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 14px;
	}

	.scene-filter {
		flex: 1;
		min-width: 0;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 13.5px;
		font-family: inherit;
		transition: border-color 0.15s;
	}

	.scene-filter::placeholder {
		color: var(--color-text-secondary);
	}

	.scene-filter:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
	}

	.add-chapter {
		flex: none;
		height: 36px;
		padding: 0 12px;
		border: none;
		border-radius: 8px;
		background: var(--selected);
		color: var(--color-primary);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.add-chapter:hover {
		background: color-mix(in srgb, var(--color-primary) 16%, transparent);
	}

	.list-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 32px 0;
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.list-empty p {
		margin: 0;
	}

	.chapter {
		padding-bottom: 6px;
	}

	.chapter + .chapter {
		padding-top: 6px;
	}

	.chapter-head,
	.scene-row {
		display: flex;
		align-items: center;
		gap: 2px;
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
	}

	.chapter-toggle {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 4px 0 2px;
		border: none;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.chev {
		flex: none;
		width: 16px;
		color: var(--color-text-secondary);
		transition: transform 0.15s;
	}

	.chev.collapsed {
		transform: rotate(-90deg);
	}

	.chapter-title {
		min-width: 0;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.02em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		margin-left: auto;
		padding-left: 6px;
	}

	.count,
	.scene-count {
		flex: none;
		font-size: 11.5px;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.mini {
		flex: none;
		height: 26px;
		padding: 0 9px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-background);
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 11.5px;
		white-space: nowrap;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.mini:hover {
		color: var(--color-text);
		border-color: color-mix(in srgb, var(--color-text) 25%, transparent);
	}

	.more {
		flex: none;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 16px;
		line-height: 1;
		letter-spacing: -0.05em;
		cursor: pointer;
	}

	.more:hover {
		background: var(--hover);
		color: var(--color-text);
	}

	/* マウス操作では「⋯」を行に重ねた時だけ出し、一覧を静かに保つ */
	@media (hover: hover) {
		.chapter-head .more,
		.scene-row .more {
			opacity: 0;
			transition: opacity 0.12s;
		}

		.chapter-head:hover .more,
		.scene-row:hover .more,
		.scene-row.active .more,
		.more:focus-visible {
			opacity: 1;
		}
	}

	.scene-row {
		margin: 1px 0;
		padding-right: 4px;
		border-radius: 8px;
		transition: background-color 0.12s;
	}

	.scene-row:hover {
		background: var(--hover);
	}

	.scene-row.active {
		background: var(--selected);
	}

	.scene-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 8px 8px 8px 26px;
		border: none;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.scene-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		min-width: 0;
	}

	.presence {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.presence-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		color: var(--color-text-secondary);
	}

	.presence-chip.here {
		border-color: var(--member-color);
		color: var(--color-text);
		font-weight: 600;
		background: color-mix(in srgb, var(--member-color) 14%, transparent);
	}

	.presence-chip-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--member-color);
	}

	.presence-dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}

	.presence-mini {
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.collab-note {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.collab-retry {
		margin-left: 4px;
		padding: 0 6px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: none;
		color: inherit;
		font-size: 11px;
		cursor: pointer;
	}

	.scene-title {
		max-width: 100%;
		font-size: 14px;
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scene-row.active .scene-title {
		color: var(--color-primary);
		font-weight: 600;
	}

	.scene-empty {
		width: 100%;
		padding: 6px 8px 8px 26px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 12.5px;
		text-align: left;
		cursor: pointer;
	}

	.scene-empty .link {
		color: var(--color-primary);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
		text-underline-offset: 3px;
	}

	.scene-list-foot {
		display: flex;
		justify-content: space-between;
		margin-top: 10px;
		padding: 12px 4px 0;
		border-top: 1px solid var(--color-border);
		font-size: 12px;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	/* ===== 集中モード終了ボタン ===== */
	.focus-exit {
		position: absolute;
		top: calc(var(--safe-top) + 8px);
		right: 8px;
		z-index: 5;
		width: 36px;
		height: 36px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-background);
		color: var(--color-text-secondary);
		opacity: 0.55;
		cursor: pointer;
	}

	.focus-exit:hover,
	.focus-exit:focus-visible {
		opacity: 1;
	}

	/* ===== スマホ: 上部バー ===== */
	/*
	 * 本文のレイアウトに影響しないよう、バーは本文の上に重ねる(absolute)。
	 * 出入りは transform/opacity だけで行い、高さや余白は変えない。
	 */
	.m-bar-wrap {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 4;
		padding-top: var(--safe-top);
		padding-left: var(--safe-left);
		padding-right: var(--safe-right);
		background: color-mix(in srgb, var(--color-background) 90%, transparent);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--color-border);
		transform: translateY(0);
		opacity: 1;
		transition:
			transform 0.2s ease-out,
			opacity 0.2s ease-out;
		will-change: transform;
	}

	.m-bar-wrap.m-bar-off {
		transform: translateY(-100%);
		opacity: 0;
		pointer-events: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.m-bar-wrap {
			transition: none;
		}
	}

	.m-bar {
		height: var(--bar-height);
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 4px;
	}

	.m-btn {
		flex: none;
		width: 40px;
		height: 40px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	.m-btn:active {
		background: var(--color-surface);
	}

	.aa {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.m-title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 1px;
		padding: 0 6px;
		border: none;
		background: transparent;
		color: var(--color-text);
		text-align: left;
		cursor: pointer;
	}

	.m-title-main {
		max-width: 100%;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.m-title-sub {
		max-width: 100%;
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		line-height: 1.2;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.ellipsis {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ===== スマホ: 本文下の前後シーン移動 ===== */
	.scene-nav {
		display: flex;
		gap: 8px;
		margin-top: 32px;
		padding-bottom: 16px;
	}

	.scene-nav button {
		flex: 1;
		min-width: 0;
		padding: 12px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.scene-nav button:last-child {
		text-align: right;
	}

	.scene-nav button:disabled {
		opacity: 0.4;
	}

	/* ===== シート内のコンテンツ ===== */
	.display-sheet {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 0 16px 16px;
	}

	.seg {
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.seg button {
		flex: 1;
		height: 34px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text);
		font-size: 13px;
		cursor: pointer;
	}

	.seg button.on {
		background: var(--color-background);
		color: var(--color-text);
		font-weight: 600;
		box-shadow: 0 0 0 1px var(--color-border);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.field-label {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.field-label .value {
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}

	.field input[type='range'] {
		width: 100%;
	}

	.stepper {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.stepper button {
		flex: none;
		width: 40px;
		height: 40px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 18px;
		cursor: pointer;
	}

	.hint {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 4px 0;
	}

	.toggle span {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 14px;
	}

	.toggle small {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.toggle input {
		flex: none;
		width: 22px;
		height: 22px;
	}

	.display-actions {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}

	.display-actions button {
		flex: 1;
		height: 44px;
		padding: 0 14px;
		border-radius: 12px;
		font-size: 14px;
		cursor: pointer;
	}

	.display-actions .ghost {
		border: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-text);
	}

	.done-btn {
		height: 34px;
		padding: 0 14px;
		border: none;
		border-radius: 10px;
		background: var(--color-primary);
		color: #fff;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}

	.actions {
		display: flex;
		flex-direction: column;
		padding: 0 8px 8px;
	}

	.actions button {
		height: 48px;
		padding: 0 12px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--color-text);
		text-align: left;
		font-size: 15px;
		cursor: pointer;
	}

	.actions button:active:not(:disabled) {
		background: var(--color-surface);
	}

	.actions button:disabled {
		opacity: 0.4;
	}

	.actions .danger {
		color: var(--color-error);
	}

	.actions-sep {
		height: 1px;
		margin: 4px 8px;
		background: var(--color-border);
	}

	.goal-btn {
		display: inline-flex;
		align-items: center;
		padding: 4px;
		border: none;
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
	}

	.goal-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 0 16px 16px;
	}

	.goal-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.goal-field input {
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 16px;
	}

	.done-btn.wide {
		width: 100%;
		height: 44px;
	}

	.goal-edit {
		margin-left: auto;
		color: var(--color-primary);
	}

	.goal-line {
		width: 100%;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 12px 10px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	@media (max-width: 1024px) {
		.editor-layout,
		.editor-layout[data-sidebar-open='false'] {
			grid-template-columns: minmax(0, 1fr);
		}

		.editor-sidebar {
			position: absolute;
			top: 0;
			left: 0;
			height: 100%;
			width: var(--scene-panel-width);
			transform: translateX(-100%);
			transition: transform 0.2s ease-in-out;
			z-index: 3;
			box-shadow: var(--shadow-float);
		}

		.editor-layout[data-sidebar-open='true'] .editor-sidebar {
			transform: translateX(0);
		}

		.sidebar-overlay {
			display: block;
			position: absolute;
			inset: 0;
			border: none;
			background: rgb(0 0 0 / 0.25);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.2s ease-in-out;
			z-index: 2;
		}

		.editor-layout[data-sidebar-open='true'] .sidebar-overlay {
			opacity: 1;
			pointer-events: auto;
		}

		.mobile-sidebar-open {
			display: block;
			position: sticky;
			top: 0;
			z-index: 1;
			padding: 8px 12px;
			background: var(--color-background);
			border-bottom: 1px solid var(--color-border);
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
			border: 1px solid var(--color-border);
			background: var(--color-background);
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

		.editor-page {
			padding: 40px 32px 96px;
		}
	}

	@media (max-width: 768px) {
		/* 本文をできるだけ広く使う: 外側の余白をなくし、左右 16px のみ */
		.editor-panel--editor {
			padding: 0 !important;
		}

		.editor-page {
			padding: 16px 16px 24px !important;
			max-width: 100%;
			border-radius: 0 !important;
		}

		/* 上部バーは本文に重なるので、その分の余白を常に確保する(出入りで変わらない) */
		.editor-page.with-m-bar {
			padding-top: calc(var(--safe-top) + var(--bar-height) + 1px + 16px) !important;
		}

		/* タイプライタースクロール時は最終行も画面の途中まで持ち上げられるよう余白を足す */
		.editor-page.typewriter {
			padding-bottom: 45dvh !important;
		}

		.editor-text {
			min-height: 55dvh !important;
		}
	}
</style>
