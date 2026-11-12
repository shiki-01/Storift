<script lang="ts">
	// ツールバーの Monolog. アイコンから開くポップアップ(モバイルでは「操作」シート)の中身。
	// 接続状態・計測中のセッション・接続/終了の操作と、設定画面へのリンク
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { sectionHash } from '$lib/components/settings/sections';
	import Button from '$lib/components/ui/Button.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import type { ExtensionPanelProps } from '../../types';
	import {
		CONNECTION_LABELS,
		formatDeltaChars,
		formatElapsed,
		isConnectedStatus
	} from './panelLogic';
	import { canConnectHere, monologControl, monologState, startConnect } from './service.svelte';

	let { close }: ExtensionPanelProps = $props();

	const connectable = canConnectHere();
	let busy = $state(false);
	let now = $state(Date.now());

	const connected = $derived(isConnectedStatus(monologState.connection));
	// 計測の情報は、計測中の変化(sessionActive)と 1 秒ごとの更新(now)のたびに読み直す
	const session = $derived.by(() => {
		void now;
		return monologState.sessionActive ? monologControl.snapshot() : null;
	});

	// 1 秒更新は、計測中でこのパネルが開いている間だけ(パネルは開いている間だけ描画される)
	$effect(() => {
		if (!monologState.sessionActive) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	async function connect() {
		busy = true;
		try {
			await startConnect();
			if (isDesktop()) {
				toast.info('ブラウザで Monolog. の認可を完了すると、Storift に戻ります');
				close();
			}
		} catch (error) {
			console.error('Failed to start Monolog. authorization:', error);
			toast.error('接続を開始できませんでした');
		} finally {
			busy = false;
		}
	}

	async function endNow() {
		busy = true;
		try {
			const outcome = await monologControl.endNow();
			if (outcome === 'recorded') toast.success('Monolog. に記録しました');
			else if (outcome === 'none') toast.info('記録中の執筆はありません');
		} finally {
			busy = false;
		}
	}

	function openSettings() {
		close();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() の引数にハッシュは渡せないので、解決後に付ける
		void goto(`${resolve('/settings')}${sectionHash('extensions')}`);
	}
</script>

<div class="panel">
	<section class="status-card" aria-label="接続状態">
		<p class="eyebrow">Monolog. 連携</p>
		<div class="status-line">
			<span class="status" data-status={monologState.connection} role="status">
				<span class="dot" aria-hidden="true"></span>{CONNECTION_LABELS[monologState.connection]}
			</span>
			{#if session}<span class="live"><span class="live-dot" aria-hidden="true"></span>計測中</span
				>{/if}
		</div>
		{#if !connectable}
			<p class="note">本番環境でのみ利用できます</p>
		{:else if monologState.connection === 'reauth'}
			<p class="note">接続が切れました。もう一度接続してください。</p>
		{/if}
	</section>

	{#if session}
		<dl class="stats">
			<div class="stat">
				<dt>経過時間</dt>
				<dd class="num">{formatElapsed(now - session.startedAtMs)}</dd>
			</div>
			<div class="stat">
				<dt>増減した文字数</dt>
				<dd class="num">{formatDeltaChars(session.delta)}</dd>
			</div>
		</dl>
	{:else if connected}
		<p class="note">計測していません。執筆を始めると、自動で計測を始めます。</p>
	{/if}

	<div class="actions">
		{#if !connected}
			<Button class="panel-btn" onclick={connect} disabled={busy || !connectable}
				>Monolog. に接続</Button
			>
		{/if}
		<Button
			class="panel-btn"
			variant="secondary"
			onclick={endNow}
			disabled={busy || !connected || !monologState.sessionActive}
		>
			いま終了して記録する
		</Button>
		<Button class="panel-btn" variant="ghost" onclick={openSettings}>設定を開く</Button>
	</div>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.status-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-surface) 50%, var(--color-background));
	}

	.eyebrow {
		margin: 0;
		font-size: 11.5px;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	.status-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		font-weight: 600;
	}

	.dot {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--color-text-secondary);
	}

	.status[data-status='connected'] .dot,
	.status[data-status='unreachable'] .dot {
		background: var(--color-success, var(--color-primary));
	}

	.status[data-status='reauth'] .dot {
		background: var(--color-warning);
	}

	.live {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		padding: 0 9px;
		border-radius: 999px;
		font-size: 12px;
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 12%, var(--color-background));
	}

	:root[data-scheme='dark'] .live {
		color: color-mix(in srgb, var(--color-primary) 60%, var(--color-text));
	}

	.live-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}

	.stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin: 0;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 14px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
	}

	.stat dt {
		font-size: 11.5px;
		color: var(--color-text-secondary);
	}

	.stat dd {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.3;
	}

	.num {
		font-variant-numeric: tabular-nums;
	}

	.note {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.actions :global(.panel-btn) {
		width: 100%;
		min-height: 40px;
	}

	/* スマホのシートでは、タップ領域を 44px 以上にする */
	@media (max-width: 768px) {
		.actions :global(.panel-btn) {
			min-height: 46px;
			font-size: 15px;
		}
	}
</style>
