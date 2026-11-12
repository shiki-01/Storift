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
	<h3 class="title">Monolog. 連携</h3>

	<div class="row">
		<span class="label">接続状態</span>
		<span class="status" data-status={monologState.connection} role="status">
			<span class="dot" aria-hidden="true"></span>{CONNECTION_LABELS[monologState.connection]}
		</span>
	</div>
	{#if !connectable}
		<p class="note">本番環境でのみ利用できます</p>
	{:else if monologState.connection === 'reauth'}
		<p class="note">接続が切れました。もう一度接続してください。</p>
	{/if}

	<div class="row">
		<span class="label">計測</span>
		{#if session}
			<span class="value measuring">計測中</span>
		{:else}
			<span class="value">していません</span>
		{/if}
	</div>
	{#if session}
		<div class="row">
			<span class="label">経過時間</span>
			<span class="value num">{formatElapsed(now - session.startedAtMs)}</span>
		</div>
		<div class="row">
			<span class="label">増減した文字数</span>
			<span class="value num">{formatDeltaChars(session.delta)}</span>
		</div>
	{:else if connected}
		<p class="note">執筆を始めると、自動で計測を始めます。</p>
	{/if}

	<div class="actions">
		{#if !connected}
			<Button size="sm" onclick={connect} disabled={busy || !connectable}>Monolog. に接続</Button>
		{/if}
		<Button
			variant="secondary"
			size="sm"
			onclick={endNow}
			disabled={busy || !connected || !monologState.sessionActive}
		>
			いま終了して記録する
		</Button>
		<Button variant="ghost" size="sm" onclick={openSettings}>設定を開く</Button>
	</div>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.title {
		margin: 0 0 2px;
		font-size: 14px;
		font-weight: 600;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
	}

	.label {
		color: var(--color-text-secondary);
	}

	.value.num {
		font-variant-numeric: tabular-nums;
	}

	.value.measuring {
		color: var(--color-primary);
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.dot {
		width: 8px;
		height: 8px;
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

	.note {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
	}
</style>
