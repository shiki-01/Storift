/**
 * 有効なパックが貢献しているコンテンツ(テーマ・校正の辞書・入力補助キー・書き出しのプリセット)の置き場。
 *
 * パックの拡張(packExtension.ts)が activate / deactivate で出し入れし、各機能(校正・入力補助バー・
 * 書き出し・テーマ)がここを読む。リアクティブなので、有効/無効の切り替えがすぐ画面に反映される。
 */
import { SvelteMap } from 'svelte/reactivity';
import type { PackAssistKeySet, PackContent, PackExportPreset, PackTheme } from './pack';
import type { PackRuleSource } from './packProofread';

interface ActivePack {
	packId: string;
	packName: string;
	content: PackContent;
}

export interface PackThemeEntry {
	/** アプリ内で一意なテーマ ID(`pack:<パックの ID>:<テーマの ID>`) */
	themeId: string;
	packId: string;
	packName: string;
	theme: PackTheme;
}

export interface PackKeySetEntry {
	packId: string;
	packName: string;
	set: PackAssistKeySet;
}

export interface PackPresetEntry {
	/** 選択肢の値(`<パックの ID>:<プリセットの ID>`) */
	key: string;
	packId: string;
	packName: string;
	preset: PackExportPreset;
}

/** パックのテーマのアプリ内 ID */
export function packThemeId(packId: string, themeId: string): string {
	return `pack:${packId}:${themeId}`;
}

/** テーマ ID がパックのものか、パックの ID を返す */
export function packIdOfTheme(themeId: string): string | null {
	const match = /^pack:([^:]+):/.exec(themeId);
	return match ? match[1] : null;
}

class PackRuntime {
	private packs = new SvelteMap<string, ActivePack>();

	register(packId: string, packName: string, content: PackContent): void {
		this.packs.set(packId, { packId, packName, content });
	}

	unregister(packId: string): void {
		this.packs.delete(packId);
	}

	get themes(): PackThemeEntry[] {
		return [...this.packs.values()].flatMap((p) =>
			p.content.themes.map((theme) => ({
				themeId: packThemeId(p.packId, theme.id),
				packId: p.packId,
				packName: p.packName,
				theme
			}))
		);
	}

	get ruleSources(): PackRuleSource[] {
		return [...this.packs.values()].flatMap((p) =>
			p.content.proofreadRules.map((set) => ({
				packId: p.packId,
				packName: p.packName,
				setName: set.name,
				rules: set.rules
			}))
		);
	}

	get keySets(): PackKeySetEntry[] {
		return [...this.packs.values()].flatMap((p) =>
			p.content.assistKeys.map((set) => ({ packId: p.packId, packName: p.packName, set }))
		);
	}

	get exportPresets(): PackPresetEntry[] {
		return [...this.packs.values()].flatMap((p) =>
			p.content.exportPresets.map((preset) => ({
				key: `${p.packId}:${preset.id}`,
				packId: p.packId,
				packName: p.packName,
				preset
			}))
		);
	}

	findPreset(key: string): PackExportPreset | undefined {
		return this.exportPresets.find((e) => e.key === key)?.preset;
	}
}

export const packRuntime = new PackRuntime();
