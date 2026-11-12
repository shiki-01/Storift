import { isDesktop } from '$lib/desktop/platform';
import { monologExtension } from './builtin/monolog';
import type { Extension, ExtensionManifest, ExtensionPlatform } from './types';

/** 組み込みの拡張。新しい拡張はここに足す */
export const EXTENSIONS: readonly Extension[] = [monologExtension];

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
