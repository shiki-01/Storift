<script lang="ts">
	// 設定画面の「バージョン情報」にあるアップデート欄(デスクトップ版のみ)
	import { onMount } from 'svelte';
	import { getVersion } from '@tauri-apps/api/app';
	import { updaterStore } from '$lib/stores/updater.svelte';
	import { formatRelativeTime } from '$lib/utils/dateUtils';
	import { formatByteProgress } from '$lib/utils/formatBytes';
	import ProgressBar from '$lib/components/ui/ProgressBar.svelte';

	let appVersion = $state('');

	onMount(async () => {
		try {
			appVersion = await getVersion();
		} catch {
			// 取れなければ表示しない
		}
	});

	// 受信量が分かれば「12.3 / 45.6 MB」を添える
	let sizeText = $derived(
		updaterStore.receivedBytes > 0 || updaterStore.totalBytes
			? formatByteProgress(updaterStore.receivedBytes, updaterStore.totalBytes)
			: undefined
	);
</script>

<div class="update">
	<p class="selectable">Storift デスクトップ版{appVersion ? ` v${appVersion}` : ''}</p>

	{#if updaterStore.status === 'available'}
		<p class="note">新しいバージョン {updaterStore.version} があります。</p>
		{#if updaterStore.notes}
			<pre class="notes">{updaterStore.notes}</pre>
		{/if}
	{:else if updaterStore.status === 'downloading'}
		<ProgressBar value={updaterStore.progress} label="ダウンロード中" detail={sizeText} />
	{:else if updaterStore.status === 'ready'}
		<p class="note">更新を入れました。再起動すると新しいバージョンになります。</p>
	{:else if updaterStore.status === 'uptodate'}
		<p class="note">最新のバージョンです。</p>
	{:else if updaterStore.status === 'error'}
		<p class="note error selectable">更新に失敗しました: {updaterStore.error}</p>
	{/if}

	<div class="actions">
		{#if updaterStore.status === 'ready'}
			<button class="primary" onclick={() => updaterStore.restart()}>再起動</button>
		{:else if updaterStore.status === 'available'}
			<button class="primary" onclick={() => updaterStore.install()}>更新</button>
		{/if}
		<button onclick={() => updaterStore.check()} disabled={updaterStore.busy}>
			{updaterStore.status === 'checking' ? '確認中…' : '更新を確認'}
		</button>
	</div>

	{#if updaterStore.lastChecked}
		<p class="meta">最終確認: {formatRelativeTime(updaterStore.lastChecked)}</p>
	{/if}

	<label class="auto">
		<input
			type="checkbox"
			checked={updaterStore.autoCheck}
			onchange={(e) => (updaterStore.autoCheck = e.currentTarget.checked)}
		/>
		<span>起動時と一定時間ごとに、新しいバージョンを自動で確認する</span>
	</label>
	<p class="meta">更新は確認のあと、「更新」を押したときにだけ入れます。</p>
</div>

<style>
	.update {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.note {
		font-size: 14px;
		color: var(--color-text);
	}

	.note.error {
		color: var(--color-error);
	}

	.notes {
		max-height: 160px;
		overflow: auto;
		margin: 0;
		padding: 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
		font-family: inherit;
		font-size: 12px;
		white-space: pre-wrap;
	}

	.actions {
		display: flex;
		gap: 8px;
	}

	.actions button {
		height: 34px;
		padding: 0 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 13px;
		cursor: pointer;
	}

	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.actions .primary {
		border-color: transparent;
		background: var(--color-primary);
		color: var(--color-background);
		font-weight: 600;
	}

	.auto {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		cursor: pointer;
	}

	.meta {
		font-size: 12px;
	}
</style>
