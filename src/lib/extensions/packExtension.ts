/**
 * パックを、拡張(Extension)として扱うための変換。
 * activate でコンテンツを packRuntime に出し、deactivate で引っ込める。コードは実行しない。
 */
import { themeStore } from '$lib/stores/theme.svelte';
import type { ExtensionManifest, ExtensionOrigin } from './manifest';
import type { PackContent } from './pack';
import { packRuntime } from './packRuntime.svelte';
import type { Extension } from './types';

export function createPackExtension(
	manifest: ExtensionManifest,
	content: PackContent,
	origin: Exclude<ExtensionOrigin, 'official'>
): Extension {
	return {
		manifest,
		origin,
		content,
		activate() {
			packRuntime.register(manifest.id, manifest.name, content);
			void themeStore.syncPackThemes();
		},
		deactivate() {
			packRuntime.unregister(manifest.id);
			void themeStore.syncPackThemes();
		}
	};
}
