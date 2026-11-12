<script lang="ts">
	// 設定「拡張機能」の Monolog. 連携カードの本体: 接続状態・接続/解除・記録の設定・プライバシーの注意
	import { onMount } from 'svelte';
	import SettingsCard from '$lib/components/settings/SettingsCard.svelte';
	import SettingsRow from '$lib/components/settings/SettingsRow.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { confirmDialog, toast } from '$lib/stores/toast.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { PRIVACY_URL } from './config';
	import { endMonologSessionNow } from './index';
	import { IDLE_MINUTES_OPTIONS, type SessionMode } from './session';
	import { monologSettings } from './settings.svelte';
	import {
		canConnectHere,
		disconnect,
		monologState,
		refreshConnection,
		startConnect
	} from './service.svelte';

	const connectable = canConnectHere();
	let busy = $state(false);
	// タグ名は入力中に保存しない(確定したときに保存する)
	let tagDraft = $state(monologSettings.value.tagName);

	const statusLabel: Record<typeof monologState.connection, string> = {
		unknown: '確認中',
		checking: '確認中',
		connected: '接続中',
		disconnected: '未接続',
		reauth: '要再接続',
		unreachable: '接続中(いまは確認できません)'
	};

	onMount(() => {
		void refreshConnection();
	});

	async function connect() {
		busy = true;
		try {
			await startConnect();
			if (isDesktop()) {
				toast.info('ブラウザで Monolog. の認可を完了すると、Storift に戻ります');
			}
		} catch (error) {
			console.error('Failed to start Monolog. authorization:', error);
			toast.error('接続を開始できませんでした');
		} finally {
			busy = false;
		}
	}

	async function handleDisconnect() {
		const ok = await confirmDialog({
			title: '連携を解除',
			message:
				'Monolog. との連携を解除します。この端末に保存したトークンを削除し、Monolog. 側でも無効にします。',
			confirmText: '解除する',
			danger: true
		});
		if (!ok) return;
		busy = true;
		try {
			await endMonologSessionNow();
			const { revoked } = await disconnect();
			if (revoked) toast.success('連携を解除しました');
			else
				toast.info(
					'この端末の接続情報を削除しました(Monolog. 側の無効化は完了できませんでした。Monolog. の設定から解除できます)'
				);
		} finally {
			busy = false;
		}
	}

	async function endNow() {
		busy = true;
		try {
			const outcome = await endMonologSessionNow();
			if (outcome === 'recorded') toast.success('Monolog. に記録しました');
			else if (outcome === 'none') toast.info('記録中の執筆はありません');
		} finally {
			busy = false;
		}
	}

	function openPrivacy(e: MouseEvent) {
		if (!isDesktop()) return;
		e.preventDefault();
		void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(PRIVACY_URL));
	}

	const connected = $derived(
		monologState.connection === 'connected' || monologState.connection === 'unreachable'
	);
</script>

<SettingsCard
	title="Monolog. 連携"
	description="執筆している間の時間を Monolog. に記録します。接続すると、最初の編集で計測を始め、一定時間操作がなければ終了します。"
>
	<SettingsRow label="接続状態">
		<span class="status" data-status={monologState.connection} role="status">
			<span class="dot" aria-hidden="true"></span>{statusLabel[monologState.connection]}
		</span>
		{#if connected}
			<Button variant="secondary" size="sm" onclick={handleDisconnect} disabled={busy}>
				連携を解除
			</Button>
		{:else}
			<Button size="sm" onclick={connect} disabled={busy || !connectable}>Monolog. に接続</Button>
		{/if}
	</SettingsRow>
	{#if !connectable}
		<p class="note" role="status">本番環境でのみ利用できます</p>
	{:else if monologState.connection === 'reauth'}
		<p class="note" role="status">
			Monolog. との接続が切れました。もう一度「Monolog. に接続」してください。
		</p>
	{/if}

	<SettingsRow
		label="記録方式"
		labelFor="monolog-mode"
		description="タイマー方式は、執筆中に Monolog. アプリ側でも計測中として見えます。記録方式は、終了時に 1 件の記録を追加します。"
	>
		<Select
			id="monolog-mode"
			value={monologSettings.value.mode}
			onchange={(v) => monologSettings.update({ mode: v as SessionMode })}
			options={[
				{ value: 'timer', label: 'タイマー方式' },
				{ value: 'record', label: '記録方式' }
			]}
		/>
	</SettingsRow>
	{#if monologSettings.value.mode === 'timer'}
		<p class="note">
			タイマー方式では、終了時刻は最後の編集の時刻ではなく、Monolog.
			のタイマーを実際に停止した時刻になります(無操作と判断するまでの時間が含まれます)。Monolog.
			アプリでタイマーが動いているときは、そのセッションは記録しません。
		</p>
	{/if}

	<SettingsRow
		label="無操作で終了するまでの時間"
		labelFor="monolog-idle"
		description="最後の編集からこの時間操作がなければ、執筆を終了して記録します。"
	>
		<Select
			id="monolog-idle"
			value={String(monologSettings.value.idleMinutes)}
			onchange={(v) => monologSettings.update({ idleMinutes: Number(v) })}
			options={IDLE_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: `${m} 分` }))}
		/>
	</SettingsRow>

	<SettingsRow
		label="タグ名"
		labelFor="monolog-tag"
		description="Monolog. の記録に付けるタグです。"
	>
		<input
			id="monolog-tag"
			class="tag-input"
			type="text"
			maxlength="50"
			bind:value={tagDraft}
			onblur={() => {
				monologSettings.update({ tagName: tagDraft });
				tagDraft = monologSettings.value.tagName;
			}}
			onkeydown={(e) => {
				if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
			}}
		/>
	</SettingsRow>

	<SettingsRow
		label="作品名を Monolog. に送る"
		labelFor="monolog-title"
		description="オンにすると、記録のタイトルが「作品名を執筆」になります。オフのときは「執筆(Storift)」です。"
	>
		<input
			id="monolog-title"
			type="checkbox"
			checked={monologSettings.value.sendProjectTitle}
			onchange={(e) => monologSettings.update({ sendProjectTitle: e.currentTarget.checked })}
		/>
	</SettingsRow>

	<SettingsRow
		label="いま終了して記録する"
		description={monologState.sessionActive
			? 'Monolog. で計測中です。'
			: '計測中の執筆があれば、ここで終了して記録します。'}
	>
		<Button variant="secondary" size="sm" onclick={endNow} disabled={busy || !connected}>
			終了して記録
		</Button>
	</SettingsRow>

	<div class="privacy selectable">
		<p>
			Monolog. に送る項目は、開始・終了時刻、所要時間、タイトル、メモ(増減した文字数)、タグです。<strong
				>本文は送りません。</strong
			>接続情報(トークン)はこの端末にだけ保存し、同期・バックアップ・書き出しには含めません。
		</p>
		<p>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 外部サイトへのリンク -->
			<a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" onclick={openPrivacy}
				>プライバシーポリシー</a
			>
		</p>
	</div>
</SettingsCard>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text-secondary);
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
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.tag-input {
		width: 10rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
	}

	.privacy {
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.privacy p {
		margin: 0 0 4px;
	}

	.privacy a {
		color: var(--color-primary);
	}
</style>
