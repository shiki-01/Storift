import type { Chapter, Scene } from '$lib/types';

export interface ContextMenuState {
	visible: boolean;
	x: number;
	y: number;
	items: ContextMenuItem[];
}

export interface ContextMenuItem {
	label: string;
	icon?: string;
	action: () => void;
	disabled?: boolean;
	divider?: boolean;
	shortcut?: string;
	danger?: boolean;
}

/**
 * エディターページ用のコンテキストメニューアイテムを生成
 */
export function createEditorContextMenu(params: {
	scene: Scene | null;
	chapter: Chapter | null;
	hasSelection: boolean;
	onSave: () => void;
	onCopy: () => void;
	onCut: () => void;
	onPaste: () => void;
	onSelectAll: () => void;
	onRename: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onExport: () => void;
	onPrint: () => void;
	onVersionHistory: () => void;
}): ContextMenuItem[] {
	const items: ContextMenuItem[] = [];

	// 選択範囲がある場合の操作
	if (params.hasSelection) {
		items.push(
			{ label: 'コピー', icon: 'clipboard-text', action: params.onCopy, shortcut: 'Ctrl+C' },
			{ label: 'カット', icon: 'clipboard-text', action: params.onCut, shortcut: 'Ctrl+X' }
		);
	}

	items.push({ label: '貼り付け', icon: 'files', action: params.onPaste, shortcut: 'Ctrl+V' });

	if (params.hasSelection) {
		items.push({ divider: true } as ContextMenuItem);
		items.push({ label: 'すべて選択', icon: 'list', action: params.onSelectAll, shortcut: 'Ctrl+A' });
	}

	// シーン固有の操作
	if (params.scene) {
		items.push(
			{ divider: true } as ContextMenuItem,
			{ label: '保存', icon: 'device-sd-card', action: params.onSave, shortcut: 'Ctrl+S' },
			{ label: '名前を変更', icon: 'pencil', action: params.onRename },
			{ label: '複製', icon: 'files', action: params.onDuplicate }
		);
	}

	// エクスポート・印刷
	items.push(
		{ divider: true } as ContextMenuItem,
		{ label: 'エクスポート', icon: 'package-export', action: params.onExport },
		{ label: '印刷プレビュー', icon: 'printer', action: params.onPrint }
	);

	// バージョン履歴
	if (params.scene) {
		items.push({ label: 'バージョン履歴', icon: 'history', action: params.onVersionHistory });
	}

	// 削除
	if (params.scene) {
		items.push({ divider: true } as ContextMenuItem, {
			label: '削除',
			icon: 'trash',
			action: params.onDelete,
			danger: true
		});
	}

	return items;
}

/**
 * チャプターリスト用のコンテキストメニューアイテムを生成
 */
export function createChapterContextMenu(params: {
	chapter: Chapter;
	onRename: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	onAddScene: () => void;
	canMoveUp: boolean;
	canMoveDown: boolean;
}): ContextMenuItem[] {
	const items: ContextMenuItem[] = [
		{ label: 'シーンを追加', icon: 'playlist-add', action: params.onAddScene },
		{ divider: true } as ContextMenuItem,
		{ label: '名前を変更', icon: 'pencil', action: params.onRename },
		{ label: '複製', icon: 'files', action: params.onDuplicate }
	];

	// 並び替え
	if (params.onMoveUp || params.onMoveDown) {
		items.push({ divider: true } as ContextMenuItem);
		if (params.onMoveUp) {
			items.push({
				label: '上に移動',
				icon: 'pencil',
				action: params.onMoveUp,
				disabled: !params.canMoveUp
			});
		}
		if (params.onMoveDown) {
			items.push({
				label: '下に移動',
				icon: 'pencil',
				action: params.onMoveDown,
				disabled: !params.canMoveDown
			});
		}
	}

	items.push({ divider: true } as ContextMenuItem, {
		label: '削除',
		icon: 'trash',
		action: params.onDelete,
		danger: true
	});

	return items;
}

/**
 * シーンリスト用のコンテキストメニューアイテムを生成
 */
export function createSceneContextMenu(params: {
	scene: Scene;
	onOpen: () => void;
	onRename: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	onMoveToChapter?: () => void;
	canMoveUp: boolean;
	canMoveDown: boolean;
}): ContextMenuItem[] {
	const items: ContextMenuItem[] = [
		{ label: '開く', icon: 'book-2', action: params.onOpen },
		{ divider: true } as ContextMenuItem,
		{ label: '名前を変更', icon: 'pencil', action: params.onRename },
		{ label: '複製', icon: 'files', action: params.onDuplicate }
	];

	// 並び替え
	if (params.onMoveUp || params.onMoveDown) {
		items.push({ divider: true } as ContextMenuItem);
		if (params.onMoveUp) {
			items.push({
				label: '上に移動',
				icon: 'pencil',
				action: params.onMoveUp,
				disabled: !params.canMoveUp
			});
		}
		if (params.onMoveDown) {
			items.push({
				label: '下に移動',
				icon: 'pencil',
				action: params.onMoveDown,
				disabled: !params.canMoveDown
			});
		}
	}

	// チャプター間移動
	if (params.onMoveToChapter) {
		items.push({ label: 'チャプターを移動', icon: 'files', action: params.onMoveToChapter });
	}

	items.push({ divider: true } as ContextMenuItem, {
		label: '削除',
		icon: 'trash',
		action: params.onDelete,
		danger: true
	});

	return items;
}

/**
 * プロジェクトリスト用のコンテキストメニューアイテムを生成
 */
export function createProjectContextMenu(params: {
	onOpen: () => void;
	onRename: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onExport: () => void;
	onArchive?: () => void;
}): ContextMenuItem[] {
	const items: ContextMenuItem[] = [
		{ label: '開く', icon: 'book-2', action: params.onOpen },
		{ divider: true } as ContextMenuItem,
		{ label: '名前を変更', icon: 'pencil', action: params.onRename },
		{ label: '複製', icon: 'files', action: params.onDuplicate },
		{ label: 'エクスポート', icon: 'package-export', action: params.onExport }
	];

	if (params.onArchive) {
		items.push({ label: 'アーカイブ', icon: 'device-sd-card', action: params.onArchive });
	}

	items.push({ divider: true } as ContextMenuItem, {
		label: '削除',
		icon: 'trash',
		action: params.onDelete,
		danger: true
	});

	return items;
}

/**
 * キャラクターリスト用のコンテキストメニューアイテムを生成
 */
export function createCharacterContextMenu(params: {
	onEdit: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onViewRelations?: () => void;
}): ContextMenuItem[] {
	const items: ContextMenuItem[] = [
		{ label: '編集', icon: 'pencil', action: params.onEdit },
		{ label: '複製', icon: 'files', action: params.onDuplicate }
	];

	if (params.onViewRelations) {
		items.push({ label: '関係性を表示', icon: 'files', action: params.onViewRelations });
	}

	items.push({ divider: true } as ContextMenuItem, {
		label: '削除',
		icon: 'trash',
		action: params.onDelete,
		danger: true
	});

	return items;
}

/**
 * プロットリスト用のコンテキストメニューアイテムを生成
 */
export function createPlotContextMenu(params: {
	onEdit: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onLinkToScene?: () => void;
}): ContextMenuItem[] {
	const items: ContextMenuItem[] = [
		{ label: '編集', icon: 'pencil', action: params.onEdit },
		{ label: '複製', icon: 'files', action: params.onDuplicate }
	];

	if (params.onLinkToScene) {
		items.push({ label: 'シーンにリンク', icon: 'files', action: params.onLinkToScene });
	}

	items.push({ divider: true } as ContextMenuItem, {
		label: '削除',
		icon: 'trash',
		action: params.onDelete,
		danger: true
	});

	return items;
}
