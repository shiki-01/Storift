import { projectsDB, chaptersDB, scenesDB, charactersDB, plotsDB, worldbuildingDB } from '$lib/db';
import {
	syncToFirestore,
	syncFromFirestore,
	syncAllFromFirestore,
	deleteFromFirestore,
	setupRealtimeSync,
	monitorOnlineStatus,
	type EntityType
} from '$lib/firebase/sync';
import { autoResolveConflict, detectConflict } from '$lib/firebase/conflict';
import { syncStore } from '$lib/stores/sync.svelte';
import { projectsStore } from '$lib/stores/projects.svelte';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { startNetworkMonitoring, onNetworkStatusChange } from '$lib/utils/offline';
import { debounceAsync } from '$lib/utils/debounce';
import type { Project, Chapter, Scene, Character, Plot, Worldbuilding } from '$lib/types';
import type { Unsubscribe } from 'firebase/firestore';

interface PendingChange {
	type: EntityType;
	id: string;
	action: 'create' | 'update' | 'delete';
}

let pendingChanges: PendingChange[] = [];
let syncInterval: number | null = null;
let isInitialized = false;
let currentProjectUnsubscribers: Unsubscribe[] = [];

// デバウンスされた同期処理（3秒）
const debouncedProcessPendingChanges = debounceAsync(processPendingChanges, 3000);

/**
 * データに変更があるかチェック
 */
function hasChanges(local: any, remote: any): boolean {
	// updatedAtが異なる場合は変更あり
	if (local.updatedAt !== remote.updatedAt) {
		return true;
	}
	
	// _versionが異なる場合は変更あり
	if (local._version !== remote._version) {
		return true;
	}
	
	// 変更なし
	return false;
}

/**
 * 同期システムの初期化
 */
export async function initializeSync(): Promise<void> {
	// 既に初期化済みの場合はスキップ
	if (isInitialized) {
		console.log('⏭️ Sync already initialized, skipping...');
		return;
	}

	const { isFirebaseInitialized } = await import('$lib/firebase');
	
	if (!isFirebaseInitialized()) {
		console.log('ℹ️ Firebase not configured, sync system will not be initialized');
		syncStore.status = 'offline';
		isInitialized = true; // 初期化済みフラグを立てて再実行を防ぐ
		return;
	}

	console.log('🚀 Initializing sync system...');

	// オンライン状態の監視
	monitorOnlineStatus();
	startNetworkMonitoring();

	// ネットワーク状態の変更を監視
	onNetworkStatusChange((status) => {
		if (status === 'online' && pendingChanges.length > 0) {
			processPendingChanges();
		}
	});

	// 定期同期（5分ごと）
	syncInterval = window.setInterval(() => {
		if (navigator.onLine && pendingChanges.length > 0) {
			processPendingChanges();
		}
	}, 5 * 60 * 1000);

	// プロジェクト一覧のリアルタイム同期のみを設定
	// 他のエンティティはプロジェクトを開いた時に設定する
	try {
		setupProjectRealtimeSync();
	} catch (error) {
		console.error('Failed to setup realtime sync:', error);
	}
	
	// 初期化完了フラグを設定
	isInitialized = true;
	
	// 初期化成功 - オンライン状態に設定
	if (navigator.onLine) {
		syncStore.status = 'synced';
	}

	console.log('✅ Sync system initialized');
}

/**
 * 同期システムの停止
 */
export function stopSync(): void {
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
	isInitialized = false;
	console.log('🛑 Sync system stopped');
}

/**
 * 変更を同期キューに追加
 */
export async function queueChange(type: EntityType, id: string, action: 'create' | 'update' | 'delete'): Promise<void> {
	console.log(`📝 Queueing change: ${type}/${id} (${action})`);
	
	// 既存の変更があれば更新
	const existingIndex = pendingChanges.findIndex((c) => c.type === type && c.id === id);
	if (existingIndex >= 0) {
		pendingChanges[existingIndex].action = action;
	} else {
		pendingChanges.push({ type, id, action });
	}

	// Firebaseが初期化されていて、かつオンラインなら即座に同期
	const { isFirebaseInitialized } = await import('$lib/firebase');
	const firebaseReady = isFirebaseInitialized();
	const online = navigator.onLine;
	
	console.log(`🔍 Firebase ready: ${firebaseReady}, Online: ${online}`);
	
	if (online && firebaseReady) {
		console.log(`🚀 Syncing with debounce (3s)...`);
		// デバウンス処理で同期（連続した変更をまとめる）
		await debouncedProcessPendingChanges();
	} else {
		console.log(`⏳ Sync deferred - will sync when conditions are met`);
	}
}

/**
 * ペンディング中の変更を処理
 */
async function processPendingChanges(): Promise<void> {
	if (pendingChanges.length === 0) {
		console.log('📭 No pending changes to sync');
		return;
	}

	// Firebaseが初期化されていない場合はスキップ
	const { isFirebaseInitialized } = await import('$lib/firebase');
	if (!isFirebaseInitialized()) {
		console.warn('⚠️ Firebase not initialized, skipping sync');
		return;
	}

	console.log(`📤 Processing ${pendingChanges.length} pending change(s)...`);
	
	syncStore.isSyncing = true;
	syncStore.status = 'syncing';

	const changes = [...pendingChanges];
	pendingChanges = [];

	try {
		for (const change of changes) {
			await processChange(change);
		}
		console.log('✅ All changes synced successfully');
		syncStore.lastSyncTime = Date.now();
		syncStore.status = 'synced';
		syncStore.error = null;
	} catch (error: any) {
		console.error('❌ Sync error:', error);
		// 失敗した変更を再度キューに追加
		pendingChanges.push(...changes);
		syncStore.error = error.message;
		syncStore.status = 'error';
	} finally {
		syncStore.isSyncing = false;
	}
}

/**
 * 個別の変更を処理
 */
async function processChange(change: PendingChange): Promise<void> {
	const { type, id, action } = change;

	if (action === 'delete') {
		await deleteFromFirestore(type, id);
		return;
	}

	// ローカルからデータを取得
	let localData: any;
	switch (type) {
		case 'projects':
			localData = await projectsDB.getById(id);
			break;
		case 'chapters':
			localData = await chaptersDB.getById(id);
			break;
		case 'scenes':
			localData = await scenesDB.getById(id);
			break;
		case 'characters':
			localData = await charactersDB.getById(id);
			break;
		case 'plots':
			localData = await plotsDB.getById(id);
			break;
		case 'worldbuilding':
			localData = await worldbuildingDB.getById(id);
			break;
		default:
			throw new Error(`Unknown entity type: ${type}`);
	}

	if (!localData) {
		console.warn(`Local data not found for ${type}/${id}`);
		return;
	}

	// リモートデータを取得して競合チェック
	try {
		const remoteData = await syncFromFirestore(type, id);

		if (remoteData && detectConflict(localData, remoteData)) {
			// 競合検出 - 自動解決
			const resolution = autoResolveConflict(localData, remoteData);
			
			if (resolution.resolution === 'remote' && resolution.resolvedData) {
				// リモートを採用 - ローカルを更新
				await updateLocalData(type, resolution.resolvedData);
			}
			// 'local'の場合は何もせず、ローカルをアップロード
		}
	} catch (error) {
		// リモートにデータがない場合は新規作成として扱う
		console.log(`Creating new ${type} in Firestore:`, id);
	}

	// 変更があるかチェック（remoteDataと比較）
	try {
		const remoteData = await syncFromFirestore(type, id);
		if (remoteData && !hasChanges(localData, remoteData)) {
			console.log(`⏭️ No changes detected for ${type}/${id}, skipping upload`);
			return;
		}
	} catch (error) {
		// リモートにデータがない場合は新規作成
	}

	// Firestoreにアップロード
	console.log(`📤 Uploading ${type}/${id} to Firestore...`);
	await syncToFirestore(type, localData);
	console.log(`✅ Successfully uploaded ${type}/${id}`);
}

/**
 * ローカルデータを更新
 */
async function updateLocalData(type: EntityType, data: any): Promise<void> {
	switch (type) {
		case 'projects':
			await projectsDB.update(data.id, data);
			break;
		case 'chapters':
			await chaptersDB.update(data.id, data);
			break;
		case 'scenes':
			await scenesDB.update(data.id, data);
			break;
		case 'characters':
			await charactersDB.update(data.id, data);
			break;
		case 'plots':
			await plotsDB.update(data.id, data);
			break;
		case 'worldbuilding':
			await worldbuildingDB.update(data.id, data);
			break;
	}
}

/**
 * プロジェクトのリアルタイム同期
 */
function setupProjectRealtimeSync(): void {
	setupRealtimeSync(
		'projects',
		async (projects) => {
			console.log(`🔄 Realtime sync: Received ${projects.length} project(s) from Firestore`);
			
			// リモートの変更をローカルに反映
			const localProjects = await projectsDB.getAll();
			const localProjectMap = new Map(localProjects.map((p) => [p.id, p]));

			for (const remoteProject of projects as Project[]) {
				const localProject = localProjectMap.get(remoteProject.id);

				if (!localProject) {
					// 新しいプロジェクト - リモートのIDを保持してローカルに追加
					console.log(`➕ Adding new project from remote: ${remoteProject.id}`);
					try {
						await projectsDB.addFromRemote(remoteProject);
					} catch (error) {
						console.error(`Failed to add project ${remoteProject.id}:`, error);
						// 既に存在する場合は無視
					}
				} else if (detectConflict(localProject, remoteProject)) {
					// 競合 - 自動解決
					console.log(`⚠️ Conflict detected for project: ${remoteProject.id}`);
					const resolution = autoResolveConflict(localProject, remoteProject);
					if (resolution.resolution === 'remote' && resolution.resolvedData) {
						await projectsDB.update(remoteProject.id, resolution.resolvedData);
					}
				} else if (remoteProject.updatedAt > localProject.updatedAt) {
					// リモートの方が新しい - 更新
					console.log(`🔄 Updating project from remote: ${remoteProject.id}`);
					await projectsDB.update(remoteProject.id, remoteProject);
				}
			}

			// ストアを更新
			projectsStore.projects = await projectsDB.getAll();
			console.log(`✅ Realtime sync completed. Total local projects: ${projectsStore.projects.length}`);
		},
		(error) => {
			console.error('Realtime sync error:', error);
			syncStore.error = error.message;
			syncStore.status = 'error';
		}
	);
}

/**
 * 現在のプロジェクトのリアルタイム同期を開始
 * プロジェクトを開いた時に呼び出す
 */
export async function startCurrentProjectSync(projectId: string): Promise<void> {
	console.log(`🚀 Starting realtime sync for project: ${projectId}`);
	
	// 設定で同期が無効化されているか確認
	const { settingsDB } = await import('$lib/db');
	const settings = await settingsDB.get();
	
	if (!settings.syncEnabled) {
		console.log('⏭️ Sync is disabled in settings, skipping project sync');
		return;
	}
	
	// Firebaseが初期化されているか確認
	const { isFirebaseInitialized } = await import('$lib/firebase');
	if (!isFirebaseInitialized()) {
		console.warn('⚠️ Firebase not initialized, skipping project sync');
		return;
	}
	
	// 既存の監視を停止
	stopCurrentProjectSync();
	
	// 章のリアルタイム同期
	const chaptersUnsub = setupRealtimeSync(
		'chapters',
		async (chapters) => {
			console.log(`🔄 Realtime sync: Received ${chapters.length} chapter(s) from Firestore`);
			
			const localChapters = await chaptersDB.getByProjectId(projectId);
			const localChapterMap = new Map(localChapters.map((c) => [c.id, c]));

			for (const remoteChapter of chapters as Chapter[]) {
				const localChapter = localChapterMap.get(remoteChapter.id);

				if (!localChapter) {
					console.log(`➕ Adding new chapter from remote: ${remoteChapter.id}`);
					try {
						await chaptersDB.addFromRemote(remoteChapter);
					} catch (error) {
						console.error(`Failed to add chapter ${remoteChapter.id}:`, error);
					}
				} else if (detectConflict(localChapter, remoteChapter)) {
					console.log(`⚠️ Conflict detected for chapter: ${remoteChapter.id}`);
					const resolution = autoResolveConflict(localChapter, remoteChapter);
					if (resolution.resolution === 'remote' && resolution.resolvedData) {
						await chaptersDB.update(remoteChapter.id, resolution.resolvedData);
					}
				} else if (remoteChapter.updatedAt > localChapter.updatedAt) {
					console.log(`🔄 Updating chapter from remote: ${remoteChapter.id}`);
					await chaptersDB.update(remoteChapter.id, remoteChapter);
				}
			}

			if (currentProjectStore.project?.id === projectId) {
				currentProjectStore.chapters = await chaptersDB.getByProjectId(projectId);
			}
		},
		(error) => {
			console.error('Chapter realtime sync error:', error);
			syncStore.error = error.message;
		},
		projectId
	);
	
	// シーンのリアルタイム同期
	const scenesUnsub = setupRealtimeSync(
		'scenes',
		async (scenes) => {
			console.log(`🔄 Realtime sync: Received ${scenes.length} scene(s) from Firestore`);
			
			const localScenes = await scenesDB.getByProjectId(projectId);
			const localSceneMap = new Map(localScenes.map((s) => [s.id, s]));

			for (const remoteScene of scenes as Scene[]) {
				const localScene = localSceneMap.get(remoteScene.id);

				if (!localScene) {
					console.log(`➕ Adding new scene from remote: ${remoteScene.id}`);
					try {
						await scenesDB.addFromRemote(remoteScene);
					} catch (error) {
						console.error(`Failed to add scene ${remoteScene.id}:`, error);
					}
				} else if (detectConflict(localScene, remoteScene)) {
					console.log(`⚠️ Conflict detected for scene: ${remoteScene.id}`);
					const resolution = autoResolveConflict(localScene, remoteScene);
					if (resolution.resolution === 'remote' && resolution.resolvedData) {
						await scenesDB.update(remoteScene.id, resolution.resolvedData);
					}
				} else if (remoteScene.updatedAt > localScene.updatedAt) {
					console.log(`🔄 Updating scene from remote: ${remoteScene.id}`);
					await scenesDB.update(remoteScene.id, remoteScene);
				}
			}

			if (currentProjectStore.project?.id === projectId) {
				currentProjectStore.scenes = await scenesDB.getByProjectId(projectId);
			}
		},
		(error) => {
			console.error('Scene realtime sync error:', error);
			syncStore.error = error.message;
		},
		projectId
	);
	
	// キャラクターのリアルタイム同期
	const charactersUnsub = setupRealtimeSync(
		'characters',
		async (characters) => {
			console.log(`🔄 Realtime sync: Received ${characters.length} character(s) from Firestore`);
			
			const localCharacters = await charactersDB.getByProjectId(projectId);
			const localCharacterMap = new Map(localCharacters.map((c) => [c.id, c]));

			for (const remoteCharacter of characters as Character[]) {
				const localCharacter = localCharacterMap.get(remoteCharacter.id);

				if (!localCharacter) {
					console.log(`➕ Adding new character from remote: ${remoteCharacter.id}`);
					try {
						await charactersDB.addFromRemote(remoteCharacter);
					} catch (error) {
						console.error(`Failed to add character ${remoteCharacter.id}:`, error);
					}
				} else if (detectConflict(localCharacter, remoteCharacter)) {
					console.log(`⚠️ Conflict detected for character: ${remoteCharacter.id}`);
					const resolution = autoResolveConflict(localCharacter, remoteCharacter);
					if (resolution.resolution === 'remote' && resolution.resolvedData) {
						await charactersDB.update(remoteCharacter.id, resolution.resolvedData);
					}
				} else if (remoteCharacter.updatedAt > localCharacter.updatedAt) {
					console.log(`🔄 Updating character from remote: ${remoteCharacter.id}`);
					await charactersDB.update(remoteCharacter.id, remoteCharacter);
				}
			}
		},
		(error) => {
			console.error('Character realtime sync error:', error);
			syncStore.error = error.message;
		},
		projectId
	);
	
	// プロットのリアルタイム同期
	const plotsUnsub = setupRealtimeSync(
		'plots',
		async (plots) => {
			console.log(`🔄 Realtime sync: Received ${plots.length} plot(s) from Firestore`);
			
			const localPlots = await plotsDB.getByProjectId(projectId);
			const localPlotMap = new Map(localPlots.map((p) => [p.id, p]));

			for (const remotePlot of plots as Plot[]) {
				const localPlot = localPlotMap.get(remotePlot.id);

				if (!localPlot) {
					console.log(`➕ Adding new plot from remote: ${remotePlot.id}`);
					try {
						await plotsDB.addFromRemote(remotePlot);
					} catch (error) {
						console.error(`Failed to add plot ${remotePlot.id}:`, error);
					}
				} else if (detectConflict(localPlot, remotePlot)) {
					console.log(`⚠️ Conflict detected for plot: ${remotePlot.id}`);
					const resolution = autoResolveConflict(localPlot, remotePlot);
					if (resolution.resolution === 'remote' && resolution.resolvedData) {
						await plotsDB.update(remotePlot.id, resolution.resolvedData);
					}
				} else if (remotePlot.updatedAt > localPlot.updatedAt) {
					console.log(`🔄 Updating plot from remote: ${remotePlot.id}`);
					await plotsDB.update(remotePlot.id, remotePlot);
				}
			}
		},
		(error) => {
			console.error('Plot realtime sync error:', error);
			syncStore.error = error.message;
		},
		projectId
	);
	
	// 世界設定のリアルタイム同期
	const worldbuildingUnsub = setupRealtimeSync(
		'worldbuilding',
		async (worldbuildings) => {
			console.log(`🔄 Realtime sync: Received ${worldbuildings.length} worldbuilding(s) from Firestore`);
			
			const localWorldbuildings = await worldbuildingDB.getByProjectId(projectId);
			const localWorldbuildingMap = new Map(localWorldbuildings.map((w) => [w.id, w]));

			for (const remoteWorldbuilding of worldbuildings as Worldbuilding[]) {
				const localWorldbuilding = localWorldbuildingMap.get(remoteWorldbuilding.id);

				if (!localWorldbuilding) {
					console.log(`➕ Adding new worldbuilding from remote: ${remoteWorldbuilding.id}`);
					try {
						await worldbuildingDB.addFromRemote(remoteWorldbuilding);
					} catch (error) {
						console.error(`Failed to add worldbuilding ${remoteWorldbuilding.id}:`, error);
					}
				} else if (detectConflict(localWorldbuilding, remoteWorldbuilding)) {
					console.log(`⚠️ Conflict detected for worldbuilding: ${remoteWorldbuilding.id}`);
					const resolution = autoResolveConflict(localWorldbuilding, remoteWorldbuilding);
					if (resolution.resolution === 'remote' && resolution.resolvedData) {
						await worldbuildingDB.update(remoteWorldbuilding.id, resolution.resolvedData);
					}
				} else if (remoteWorldbuilding.updatedAt > localWorldbuilding.updatedAt) {
					console.log(`🔄 Updating worldbuilding from remote: ${remoteWorldbuilding.id}`);
					await worldbuildingDB.update(remoteWorldbuilding.id, remoteWorldbuilding);
				}
			}
		},
		(error) => {
			console.error('Worldbuilding realtime sync error:', error);
			syncStore.error = error.message;
		},
		projectId
	);
	
	currentProjectUnsubscribers = [chaptersUnsub, scenesUnsub, charactersUnsub, plotsUnsub, worldbuildingUnsub];
	console.log(`✅ Realtime sync started for project: ${projectId}`);
}

/**
 * 現在のプロジェクトのリアルタイム同期を停止
 */
export function stopCurrentProjectSync(): void {
	if (currentProjectUnsubscribers.length > 0) {
		console.log(`🛑 Stopping realtime sync for current project`);
		currentProjectUnsubscribers.forEach((unsub) => unsub());
		currentProjectUnsubscribers = [];
	}
}

/**
 * 現在のプロジェクトの全データを同期
 */
export async function syncCurrentProject(projectId: string): Promise<void> {
	syncStore.isSyncing = true;
	syncStore.status = 'syncing';

	try {
		// プロジェクトを同期
		const project = await projectsDB.getById(projectId);
		if (project) {
			await syncToFirestore('projects', project);
		}

		// 章を同期
		const chapters = await chaptersDB.getByProjectId(projectId);
		for (const chapter of chapters) {
			await syncToFirestore('chapters', chapter);
		}

		// シーンを同期
		const scenes = await scenesDB.getByProjectId(projectId);
		for (const scene of scenes) {
			await syncToFirestore('scenes', scene);
		}

		// キャラクターを同期
		const characters = await charactersDB.getByProjectId(projectId);
		for (const character of characters) {
			await syncToFirestore('characters', character);
		}

		// プロットを同期
		const plots = await plotsDB.getByProjectId(projectId);
		for (const plot of plots) {
			await syncToFirestore('plots', plot);
		}

		// 世界設定を同期
		const worldbuildings = await worldbuildingDB.getByProjectId(projectId);
		for (const worldbuilding of worldbuildings) {
			await syncToFirestore('worldbuilding', worldbuilding);
		}

		syncStore.lastSyncTime = Date.now();
		syncStore.status = 'synced';
		syncStore.error = null;
	} catch (error: any) {
		console.error('Project sync error:', error);
		syncStore.error = error.message;
		syncStore.status = 'error';
		throw error;
	} finally {
		syncStore.isSyncing = false;
	}
}

/**
 * 全データをFirestoreからダウンロード
 */
export async function downloadAllFromFirestore(): Promise<void> {
	console.log('📥 Downloading all data from Firestore...');
	syncStore.isSyncing = true;
	syncStore.status = 'syncing';

	try {
		// プロジェクト
		const projects = await syncAllFromFirestore('projects') as Project[];
		console.log(`📦 Found ${projects.length} project(s) in Firestore`);
		for (const project of projects) {
			const existing = await projectsDB.getById(project.id);
			if (!existing) {
				console.log(`➕ Adding project: ${project.id}`);
				await projectsDB.addFromRemote(project);
			} else {
				console.log(`⏭️ Project already exists: ${project.id}`);
			}
		}

		// 章
		const chapters = await syncAllFromFirestore('chapters') as Chapter[];
		console.log(`📦 Found ${chapters.length} chapter(s) in Firestore`);
		for (const chapter of chapters) {
			const existing = await chaptersDB.getById(chapter.id);
			if (!existing) {
				console.log(`➕ Adding chapter: ${chapter.id}`);
				await chaptersDB.addFromRemote(chapter);
			} else {
				console.log(`⏭️ Chapter already exists: ${chapter.id}`);
			}
		}

		// シーン
		const scenes = await syncAllFromFirestore('scenes') as Scene[];
		console.log(`📦 Found ${scenes.length} scene(s) in Firestore`);
		for (const scene of scenes) {
			const existing = await scenesDB.getById(scene.id);
			if (!existing) {
				console.log(`➕ Adding scene: ${scene.id}`);
				await scenesDB.addFromRemote(scene);
			} else {
				console.log(`⏭️ Scene already exists: ${scene.id}`);
			}
		}

		// キャラクター
		const characters = await syncAllFromFirestore('characters') as Character[];
		console.log(`📦 Found ${characters.length} character(s) in Firestore`);
		for (const character of characters) {
			const existing = await charactersDB.getById(character.id);
			if (!existing) {
				console.log(`➕ Adding character: ${character.id}`);
				await charactersDB.addFromRemote(character);
			} else {
				console.log(`⏭️ Character already exists: ${character.id}`);
			}
		}

		// プロット
		const plots = await syncAllFromFirestore('plots') as Plot[];
		console.log(`📦 Found ${plots.length} plot(s) in Firestore`);
		for (const plot of plots) {
			const existing = await plotsDB.getById(plot.id);
			if (!existing) {
				console.log(`➕ Adding plot: ${plot.id}`);
				await plotsDB.addFromRemote(plot);
			} else {
				console.log(`⏭️ Plot already exists: ${plot.id}`);
			}
		}

		// 世界設定
		const worldbuildings = await syncAllFromFirestore('worldbuilding') as Worldbuilding[];
		console.log(`📦 Found ${worldbuildings.length} worldbuilding(s) in Firestore`);
		for (const worldbuilding of worldbuildings) {
			const existing = await worldbuildingDB.getById(worldbuilding.id);
			if (!existing) {
				console.log(`➕ Adding worldbuilding: ${worldbuilding.id}`);
				await worldbuildingDB.addFromRemote(worldbuilding);
			} else {
				console.log(`⏭️ Worldbuilding already exists: ${worldbuilding.id}`);
			}
		}

		console.log('✅ Download completed successfully');
		syncStore.lastSyncTime = Date.now();
		syncStore.status = 'synced';
		syncStore.error = null;
	} catch (error: any) {
		console.error('❌ Download error:', error);
		syncStore.error = error.message;
		syncStore.status = 'error';
		throw error;
	} finally {
		syncStore.isSyncing = false;
	}
}
