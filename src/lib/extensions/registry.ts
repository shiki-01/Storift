import { isDesktop } from '$lib/desktop/platform';
import { discordExtension } from './builtin/discord';
import { monologExtension } from './builtin/monolog';
import type { Extension, ExtensionManifest, ExtensionPlatform } from './types';

/**
 * アプリに同梱する拡張(公式)。新しい拡張はここに足す。
 * マニフェストは extensions/<id>/manifest.json(各拡張の index.ts が読み込んで検証する)
 */
export const EXTENSIONS: readonly Extension[] = [monologExtension, discordExtension];

export function currentPlatform(): ExtensionPlatform {
	return isDesktop() ? 'desktop' : 'web';
}

/** その拡張が、指定のプラットフォームで動くか */
export function isSupported(manifest: ExtensionManifest, platform: ExtensionPlatform): boolean {
	return manifest.platforms.includes(platform);
}

export function findExtension(id: string): Extension | undefined {
	return EXTENSIONS.find((e) => e.manifest.id === id);
}

/** ツールバー項目の設定上の ID(`ext:<拡張 ID>`) */
export const EXTENSION_TOOLBAR_PREFIX = 'ext:';

export function toolbarItemId(extensionId: string): string {
	return `${EXTENSION_TOOLBAR_PREFIX}${extensionId}`;
}
