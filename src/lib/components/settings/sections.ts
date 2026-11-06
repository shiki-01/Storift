/** 設定画面のセクション定義(サイドバー/タブと、URL の hash の対応) */

export type SettingsSectionId =
	| 'appearance'
	| 'editor'
	| 'sync'
	| 'sharing'
	| 'ai'
	| 'data'
	| 'about';

export interface SettingsSection {
	id: SettingsSectionId;
	/** サイドバー/タブと、セクション見出し(h2)に出す名前 */
	label: string;
	/** セクション見出しの下に出す一言 */
	description: string;
	/** 24x24 の線画アイコン(svg の中身だけ) */
	icon: string;
	/** デスクトップ版(Tauri)だけで出すセクション */
	desktopOnly?: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
	{
		id: 'appearance',
		label: '外観',
		description: '画面の配色(テーマ)を選びます。',
		icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17" fill="currentColor"/>'
	},
	{
		id: 'editor',
		label: 'エディタ',
		description: '自動保存、本文の書式、ショートカット、通知を設定します。',
		icon: '<path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4"/><path d="M13.5 6.5l4 4"/>'
	},
	{
		id: 'sync',
		label: '同期',
		description: 'Firebase を使ったクラウド同期と、競合の扱いを設定します。',
		icon: '<path d="M20 12a8 8 0 0 0-14-5.3L4 9"/><path d="M4 4v5h5"/><path d="M4 12a8 8 0 0 0 14 5.3L20 15"/><path d="M20 20v-5h-5"/>'
	},
	{
		id: 'sharing',
		label: '共有',
		description: '共有時の表示名、他の人のカーソル、アクセスの設定です。',
		icon: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.4c1.8.9 3 2.8 3 5.6"/>'
	},
	{
		id: 'ai',
		label: 'AI',
		description: 'Claude Code などの AI 連携を設定します。',
		icon: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
		desktopOnly: true
	},
	{
		id: 'data',
		label: 'データ',
		description: 'バックアップ(エクスポート/インポート)と、データの削除です。',
		icon: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'
	},
	{
		id: 'about',
		label: 'このアプリについて',
		description: 'バージョン、アップデート、チュートリアルです。',
		icon: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'
	}
];

export const DEFAULT_SECTION_ID: SettingsSectionId = 'appearance';

/**
 * 旧バージョンの hash(や、別名で案内されていたもの)から新しいセクション ID への対応。
 * 例: 執筆パネルの設定ボタンは以前 `/settings#claude` を開いていた
 */
export const LEGACY_SECTION_HASHES: Readonly<Record<string, SettingsSectionId>> = {
	claude: 'ai',
	theme: 'appearance',
	format: 'editor',
	shortcuts: 'editor',
	notifications: 'editor',
	access: 'sharing',
	cursor: 'sharing',
	backup: 'data',
	version: 'about'
};

/** 表示するセクションの一覧(デスクトップ専用のものは、デスクトップ版でだけ含める) */
export function visibleSections(desktop: boolean): SettingsSection[] {
	return SETTINGS_SECTIONS.filter((s) => desktop || !s.desktopOnly);
}

/**
 * URL の hash(`#sync` など。先頭の `#` は有っても無くてもよい)から、開くセクションを決める。
 * 旧 hash は新しい ID に読み替える。見つからない/表示できないセクションは先頭のセクションにする
 */
export function resolveSection(hash: string, desktop: boolean): SettingsSection {
	const sections = visibleSections(desktop);
	let key = hash.startsWith('#') ? hash.slice(1) : hash;
	try {
		key = decodeURIComponent(key);
	} catch {
		// 壊れたエスケープはそのまま扱う(どのセクションにも一致しないので先頭になる)
	}
	key = LEGACY_SECTION_HASHES[key] ?? key;
	return sections.find((s) => s.id === key) ?? sections[0];
}

/** セクションを開く URL の hash */
export function sectionHash(id: SettingsSectionId): string {
	return `#${id}`;
}
