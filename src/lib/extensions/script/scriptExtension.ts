/**
 * スクリプトを、拡張(Extension)として扱うための変換。
 * activate で隔離された環境にスクリプトを読み込み、deactivate で取り除く。
 * ツールバーのポップアップと設定欄は、拡張が宣言的な UI 記述で渡したものを、ホストが描画する。
 */
import type { Component } from 'svelte';
import ScriptPanel from '$lib/components/extensions/ScriptPanel.svelte';
import ScriptSettings from '$lib/components/extensions/ScriptSettings.svelte';
import type { ExtensionManifest, ExtensionOrigin } from '../manifest';
import type { Extension, ExtensionPanelProps } from '../types';
import { scriptRuntime } from './scriptRuntime.svelte';

export function createScriptExtension(
	manifest: ExtensionManifest,
	source: string,
	origin: Exclude<ExtensionOrigin, 'official'>
): Extension {
	const id = manifest.id;
	const extension: Extension = {
		manifest,
		origin,
		activate(ctx) {
			scriptRuntime.launch(manifest, source, ctx);
		},
		deactivate() {
			scriptRuntime.shutdown(id);
		}
	};
	if (manifest.permissions.ui) {
		// ポップアップ(ツールバー)と設定欄は、どちらも拡張の ID を固定したコンポーネントで描画する
		const Panel = ((anchor: Parameters<typeof ScriptPanel>[0]) =>
			ScriptPanel(anchor, {
				extensionId: id,
				name: manifest.name
			})) as unknown as Component<ExtensionPanelProps>;
		const Settings = ((anchor: Parameters<typeof ScriptSettings>[0]) =>
			ScriptSettings(anchor, { extensionId: id })) as unknown as Component;
		extension.toolbar = {
			id: 'panel',
			label: manifest.name,
			icon: manifest.icon,
			panel: Panel,
			badge: () => scriptRuntime.badge(id)
		};
		extension.settings = async () => ({ default: Settings });
	}
	return extension;
}
