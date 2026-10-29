<script lang="ts">
	import { diffChars, type EditProposal } from '$lib/desktop/edits';
	import { claudeStore, type EditMode, type EditState } from '$lib/stores/claude.svelte';

	interface Props {
		/** 回答が終わる前は提案だけ(状態なし) */
		edit: EditProposal;
		editState?: EditState;
		mode: EditMode;
	}

	let { edit, editState, mode }: Props = $props();
	let busy = $state(false);

	let ops = $derived(diffChars(edit.old, edit.new));
	let fileName = $derived(edit.file.split('/').slice(-1)[0]?.replace(/\.md$/, '') ?? edit.file);

	const STATUS_LABELS: Record<EditState['status'], string> = {
		pending: '未反映',
		applied: '反映済み',
		rejected: '却下',
		failed: '反映できません',
		reverted: '元に戻しました'
	};

	async function run(action: () => Promise<void> | void) {
		busy = true;
		try {
			await action();
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="edit"
	class:applied={editState?.status === 'applied'}
	class:failed={editState?.status === 'failed'}
>
	<div class="edit-header">
		<span class="file" title={edit.file}>{editState?.sceneTitle ?? fileName}</span>
		{#if editState}
			<span class="badge {editState.status}">{STATUS_LABELS[editState.status]}</span>
		{:else}
			<span class="badge">作成中</span>
		{/if}
	</div>
	<div class="diff">
		{#each ops as op, i (i)}<span class={op.kind}>{op.text}</span>{/each}
	</div>
	{#if editState?.error}
		<div class="error">{editState.error}</div>
	{/if}
	{#if editState && mode !== 'suggest'}
		<div class="buttons">
			{#if editState.status === 'pending' || editState.status === 'failed' || editState.status === 'reverted'}
				<button
					class="primary"
					disabled={busy}
					onclick={() => run(() => claudeStore.applyEdit(editState))}
					>{editState.status === 'pending' ? '反映' : '再度反映'}</button
				>
			{/if}
			{#if editState.status === 'pending'}
				<button disabled={busy} onclick={() => claudeStore.rejectEdit(editState)}>却下</button>
			{/if}
			{#if editState.status === 'applied'}
				<button disabled={busy} onclick={() => run(() => claudeStore.revertEdit(editState))}
					>元に戻す</button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.edit {
		margin: 8px 0;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		overflow: hidden;
	}

	.edit.applied {
		border-color: color-mix(in srgb, var(--color-success) 60%, var(--color-border));
	}

	.edit.failed {
		border-color: color-mix(in srgb, var(--color-error) 60%, var(--color-border));
	}

	.edit-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		font-size: 12px;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-secondary);
	}

	.file {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.badge {
		flex: none;
		padding: 1px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	.badge.applied {
		color: var(--color-success);
	}

	.badge.failed {
		color: var(--color-error);
	}

	.diff {
		padding: 8px 10px;
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.8;
		max-height: 320px;
		overflow-y: auto;
	}

	.del {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		text-decoration: line-through;
	}

	.add {
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 16%, transparent);
	}

	.error {
		padding: 0 10px 8px;
		font-size: 12px;
		color: var(--color-error);
	}

	.buttons {
		display: flex;
		gap: 6px;
		padding: 0 10px 10px;
	}

	button {
		padding: 4px 12px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
		color: inherit;
		background: var(--color-surface);
	}

	button.primary {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: #fff;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
