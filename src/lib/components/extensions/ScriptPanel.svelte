<script lang="ts">
	// スクリプト拡張のツールバーのポップアップ(モバイルでは下から出るシート)の中身。
	// 拡張が ui.set('panel', …) で渡した記述をホストが描画する。止まっているときは、理由と「再開」を出す
	import Button from '$lib/components/ui/Button.svelte';
	import { STOP_MESSAGES } from '$lib/extensions/script/bridge';
	import { scriptRuntime } from '$lib/extensions/script/scriptRuntime.svelte';
	import type { UiEventKind } from '$lib/extensions/script/ui';
	import ScriptUi from './ScriptUi.svelte';

	let { extensionId, name }: { extensionId: string; name: string } = $props();

	const state = $derived(scriptRuntime.state(extensionId));

	function onevent(id: string, kind: UiEventKind, value?: string | boolean) {
		scriptRuntime.sendUiEvent(extensionId, 'panel', id, kind, value);
	}
</script>

<div class="panel" data-testid={`script-panel-${extensionId}`}>
	<h4 class="title">{name}</h4>
	{#if !state || state.status === 'starting'}
		<p class="note" role="status">起動しています…</p>
	{:else if state.status === 'unsupported'}
		<p class="note warn" role="alert">
			この環境では実行できません(隔離して動かす機能が使えません)。
		</p>
	{:else if state.status === 'stopped'}
		<div class="note warn" role="alert">
			<p>{state.reason ? STOP_MESSAGES[state.reason] : '停止しました'}</p>
			<Button
				size="sm"
				variant="secondary"
				onclick={() => scriptRuntime.restart(extensionId)}
				data-testid={`script-restart-${extensionId}`}>再開</Button
			>
		</div>
	{:else if state.panel}
		<ScriptUi nodes={state.panel.nodes} {onevent} />
	{:else}
		<p class="note">この拡張は、ここに表示する画面をまだ出していません。</p>
	{/if}
	<p class="foot">隔離された環境で実行中の拡張機能です(公式のものではありません)</p>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	/* モバイルの操作シートは、タイトルを自分で出すので、重ねて出さない */
	@media (max-width: 640px) {
		.title {
			display: none;
		}
	}

	.note {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		margin: 0;
		font-size: 13px;
		line-height: 1.65;
		color: var(--color-text-secondary);
	}

	.note p {
		margin: 0;
	}

	.note.warn {
		padding: 10px 12px;
		border: 1px solid color-mix(in srgb, var(--color-warning) 55%, var(--color-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-warning) 9%, var(--color-background));
		color: var(--color-text);
	}

	.foot {
		margin: 4px 0 0;
		padding-top: 10px;
		border-top: 1px solid var(--color-border);
		font-size: 11.5px;
		color: var(--color-text-secondary);
	}
</style>
