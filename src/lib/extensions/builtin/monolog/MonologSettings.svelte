<script lang="ts">
	// 設定「拡張機能」の Monolog. 連携カードに出す、拡張固有の設定: 接続・記録・操作のグループ。
	// 送る項目などのプライバシーの説明は、マニフェストから作るカードの「プライバシー」にある
	import { onMount } from 'svelte';
	import SettingsGroup from '$lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '$lib/components/settings/SettingsRow.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { confirmDialog, toast } from '$lib/stores/toast.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import type { SessionMode } from './session';
	import { monologSettings } from './settings.svelte';
	import {
		canConnectHere,
		monologControl,
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
			await monologControl.finishRecording();
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
			const outcome = await monologControl.endNow();
			if (outcome === 'recorded') toast.success('Monolog. に記録しました');
			else if (outcome === 'none') toast.info('記録中の執筆はありません');
		} finally {
			busy = false;
		}
	}

	const connected = $derived(
		monologState.connection === 'connected' || monologState.connection === 'unreachable'
	);
</script>

<div class="monolog-settings">
	<SettingsGroup
		title="接続"
		description="接続すると、執筆を始めたときに計測を始め、終わったときに記録します。"
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
	</SettingsGroup>

	<SettingsGroup title="記録">
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
	</SettingsGroup>

	<SettingsGroup title="操作">
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
	</SettingsGroup>
</div>

<style>
	.monolog-settings {
		display: flex;
		flex-direction: column;
	}

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
		margin: 4px 0 0;
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
</style>
