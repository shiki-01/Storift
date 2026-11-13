<script lang="ts">
	// スクリプト拡張の設定欄(拡張のカードの下)。拡張が ui.set('settings', …) で渡した記述をホストが描画する
	import { scriptRuntime } from '$lib/extensions/script/scriptRuntime.svelte';
	import type { UiEventKind } from '$lib/extensions/script/ui';
	import ScriptUi from './ScriptUi.svelte';

	let { extensionId }: { extensionId: string } = $props();

	const tree = $derived(scriptRuntime.state(extensionId)?.settings ?? null);

	function onevent(id: string, kind: UiEventKind, value?: string | boolean) {
		scriptRuntime.sendUiEvent(extensionId, 'settings', id, kind, value);
	}
</script>

{#if tree}
	<ScriptUi nodes={tree.nodes} {onevent} />
{/if}
